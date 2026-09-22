import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadLiveConfig } from './config';
import { SessionRuntime } from './session-supervisor';
import { ProcessSupervisor } from './process-supervisor';
import type { LiveSessionDocument } from './types';
import type { ValidatedConnectDescriptor } from './source-adapter';

function sessionDoc(id: string): LiveSessionDocument {
  const now = new Date().toISOString();
  return {
    session_id: id,
    source_id: 'src1',
    idempotency_key: 'k1',
    desired_state: 'running',
    observed_state: 'created',
    reserved_revision: 0,
    published_revision: 0,
    stream_epoch: 1,
    last_sequence_no_in_current_epoch: 0,
    health: {
      queue_depth: 0,
      queue_high_water: 0,
      indexing_batches_in_flight: 0,
      spool_bytes: 0,
      reconnect_count: 0,
      windows_searchable: 0,
      windows_failed: 0,
      windows_dropped: 0,
    },
    timestamps: {
      created_at: now,
      command_requested_at: now,
      updated_at: now,
    },
    source_snapshot: {
      source_revision: 1,
      protocol: 'rtsp',
      transport: 'tcp',
      connection_ref: 'LIVE_SOURCE_FIXTURE_URL',
      endpoint_fingerprint: 'fp',
      allowed_host: '127.0.0.1',
      allowed_port: 8554,
    },
    variant_id: 'var',
    retention: { mode: 'until_explicit_delete' },
    window: { fragment_ms: 2000, window_ms: 8000, overlap_ms: 2000 },
    embedding: {
      provider: 'eis',
      model: 'm',
      task: 'passage',
      dims: 1024,
      normalized_by: 'provider',
    },
  };
}

function mockSource(
  url = 'rtsp://127.0.0.1:8554/fixture',
): ValidatedConnectDescriptor {
  return {
    destination: {
      parsed: {
        scheme: 'rtsp',
        hostname: '127.0.0.1',
        port: 8554,
        pathname: '/fixture',
        redactedOriginPath: url,
      },
      resolvedAddresses: ['127.0.0.1'],
      bindAddress: '127.0.0.1',
      bindUrl: url,
      allowedHost: '127.0.0.1',
      allowedPort: 8554,
    },
    snapshot: sessionDoc('ls_x').source_snapshot,
    bindInputUrl: url,
    authenticatedInputUrl: url,
    transport: 'tcp',
    endpoint_redacted: url,
    endpoint_fingerprint: 'fp',
  };
}

describe('SessionRuntime reconnect (H1 / A-07)', () => {
  it(
    're-starts capture after unexpected ffmpeg exit with epoch bump',
    async () => {
    const spool = fs.mkdtempSync(path.join(os.tmpdir(), 'live-reconnect-'));
    const cfg = loadLiveConfig({
      LIVE_SPOOL_DIR: spool,
      LIVE_RECONNECT_MAX_MS: '50',
    });
    const observed: string[] = [];
    let startCount = 0;
    let resolveCount = 0;
    let secondStop: (() => void) | null = null;
    const captureArgvs: string[][] = [];

    const exitSupervisor = () =>
      ({
        run: async () => {
          startCount += 1;
          if (startCount === 1) {
            return {
              state: 'failed' as const,
              code: 1,
              signal: null,
              timedOut: false,
              stopped: false,
              stderrTail: 'connection refused',
            };
          }
          await new Promise<void>((resolve) => {
            secondStop = resolve;
          });
          return {
            state: 'stopped' as const,
            code: 0,
            signal: 'SIGTERM' as NodeJS.Signals,
            timedOut: false,
            stopped: true,
            stderrTail: '',
          };
        },
        stop: async () => {
          secondStop?.();
        },
        getState: () => 'running' as const,
        getStderrTail: () => '',
      }) as unknown as ProcessSupervisor;

    const runtime = new SessionRuntime(cfg, sessionDoc('ls_reconnect'), 'w1', {
      updateObserved: async (_id, patch) => {
        if (patch.observed_state) observed.push(patch.observed_state);
      },
      resolveSource: async () => {
        resolveCount += 1;
        return mockSource();
      },
      spawnCapture: ({ argv }) => {
        captureArgvs.push([...argv]);
        return exitSupervisor();
      },
      sleep: async () => undefined,
      processorHooks: {
        processWindow: async () => ({
          ok: false,
          service_time_ms: 0,
          category: 'deadline' as const,
          error: 'noop',
        }),
        onIndexBatchAck: async () => undefined,
      },
    });

    await runtime.startCapture(mockSource());

    const deadline = Date.now() + 15_000;
    while (startCount < 2 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(startCount).toBeGreaterThanOrEqual(2);
    expect(resolveCount).toBeGreaterThanOrEqual(1);
    expect(runtime.snapshot().stream_epoch).toBeGreaterThanOrEqual(2);
    expect(observed).toContain('degraded');
    expect(observed).toContain('connecting');

    // A-07 / V-07: each epoch uses an isolated fragment directory + start_number.
    expect(captureArgvs.length).toBeGreaterThanOrEqual(2);
    const firstPlaylist = captureArgvs[0]!.find((a) => a.endsWith('live.m3u8'));
    const secondPlaylist = captureArgvs[1]!.find((a) => a.endsWith('live.m3u8'));
    expect(firstPlaylist).toMatch(/fragments[/\\]e1[/\\]live\.m3u8$/);
    expect(secondPlaylist).toMatch(/fragments[/\\]e2[/\\]live\.m3u8$/);
    expect(firstPlaylist).not.toBe(secondPlaylist);
    expect(captureArgvs[0]).toContain('-start_number');
    expect(captureArgvs[1]).toContain('-start_number');

    // A-10: HLS playlist is bounded (not hls_list_size 0).
    const listIdx = captureArgvs[0]!.indexOf('-hls_list_size');
    expect(listIdx).toBeGreaterThanOrEqual(0);
    expect(Number(captureArgvs[0]![listIdx + 1])).toBeGreaterThan(0);

    // A-17: LIVE_READ_TIMEOUT_MS flows into ffconcat timeout (µs).
    const script = fs.readFileSync(
      path.join(spool, 'sessions', 'ls_reconnect', 'private', 'ffmpeg-input.ffconcat'),
      'utf8',
    );
    expect(script).toMatch(/option timeout 15000000/);

    await runtime.stop('stop_requested');
    fs.rmSync(spool, { recursive: true, force: true });
    },
    20_000,
  );
});
