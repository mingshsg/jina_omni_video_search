/**
 * Phase 2 smoke: validate RTSP adapter against local MediaMTX fixture.
 * Requires: docker compose -f docker-compose.live.yml up -d
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadLiveConfig, resetLiveConfig } from '../lib/live/config';
import { RtspSourceAdapter } from '../lib/live/adapters/rtsp';
import { ProcessSupervisor } from '../lib/live/process-supervisor';
import type { LiveSourceSnapshot } from '../lib/live/types';

async function once(
  adapter: RtspSourceAdapter,
  snapshot: LiveSourceSnapshot,
  label: string,
): Promise<void> {
  const desc = await adapter.resolve(snapshot, {
    url: 'rtsp://127.0.0.1:8554/fixture',
  });
  const scriptPath = path.join(
    os.tmpdir(),
    `live-rtsp-smoke-${label}-${Date.now()}.ffconcat`,
  );
  const args = [
    ...adapter.buildFfmpegGlobalArgs(desc),
    ...adapter.buildFfmpegInput(desc, scriptPath),
    '-t',
    '2',
    '-f',
    'null',
    '-',
  ];
  try {
    const supervisor = new ProcessSupervisor({
      args,
      redact: [desc.authenticatedInputUrl],
      connectTimeoutMs: 15_000,
    });
    const result = await supervisor.run();
    const kind = adapter.classifyExit(result);
    console.log(
      JSON.stringify({
        label,
        state: result.state,
        classify: kind,
        code: result.code,
        bindUrl: desc.destination.bindUrl,
        fingerprint: desc.endpoint_fingerprint.slice(0, 12),
      }),
    );
    if (result.code !== 0 && kind === 'fatal') {
      throw new Error(`${label} failed: ${result.stderrTail}`);
    }
  } finally {
    try {
      fs.unlinkSync(scriptPath);
    } catch {
      // ignore
    }
  }
}

async function main(): Promise<void> {
  resetLiveConfig();
  const cfg = loadLiveConfig({
    LIVE_ALLOWED_HOSTS: 'localhost,127.0.0.1',
    LIVE_ALLOWED_PORTS: '554,8554',
  });
  const adapter = new RtspSourceAdapter(cfg);
  const snapshot: LiveSourceSnapshot = {
    source_revision: 1,
    protocol: 'rtsp',
    transport: 'tcp',
    connection_ref: 'LIVE_SOURCE_FIXTURE_URL',
    endpoint_fingerprint: '',
    allowed_host: '127.0.0.1',
    allowed_port: 8554,
  };

  await once(adapter, snapshot, 'connect');
  await once(adapter, snapshot, 'reconnect');
  console.log(JSON.stringify({ ok: true, message: 'MediaMTX RTSP connect/reconnect smoke passed' }));
}

main().catch((err: unknown) => {
  console.error(
    JSON.stringify({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }),
  );
  process.exit(1);
});
