import { describe, expect, it } from 'vitest';
import { createMemoryLiveEsClient } from './memory-es';
import { LiveSessionRepository } from './session-repository';
import { LiveSourceRepository } from './source-repository';
import { LiveWorkerLoop } from './worker-loop';
import { loadLiveConfig } from './config';
import type { LiveSessionDocument, LiveSourceDocument } from './types';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function sessionDoc(
  id: string,
  overrides: Partial<LiveSessionDocument> = {},
): LiveSessionDocument {
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
    ...overrides,
  };
}

describe('LiveWorkerLoop (no capture)', () => {
  it('bootstraps recovery and starts at most one session without capture', async () => {
    const spool = fs.mkdtempSync(path.join(os.tmpdir(), 'live-loop-'));
    const cfg = loadLiveConfig({ LIVE_SPOOL_DIR: spool });
    const { client } = createMemoryLiveEsClient();
    const sessions = new LiveSessionRepository(client, cfg);
    const sources = new LiveSourceRepository(client, cfg);

    await sessions.create(sessionDoc('ls_one'));
    await sessions.create(
      sessionDoc('ls_two', { idempotency_key: 'k2', source_id: 'src2' }),
    );

    const loop = new LiveWorkerLoop({
      cfg,
      workerId: 'w1',
      sessions,
      sources,
      enableCapture: false,
      pollIntervalMs: 60_000,
    });

    await loop.bootstrap();
    await loop.pollOnce();
    expect(loop.activeSessionIds).toEqual(['ls_one']);
    await loop.pollOnce();
    expect(loop.activeSessionIds).toHaveLength(1);

    await sessions.updateDesiredState('ls_one', { desired_state: 'stopped' });
    await sessions.updateDesiredState('ls_two', { desired_state: 'stopped' });
    await loop.pollOnce();
    // stop drains runtime; no other desired-running session
    expect(loop.activeSessionIds).toHaveLength(0);

    await loop.drain();
    fs.rmSync(spool, { recursive: true, force: true });
  });

  it('clears terminal source claims on bootstrap', async () => {
    const spool = fs.mkdtempSync(path.join(os.tmpdir(), 'live-claim-'));
    const cfg = loadLiveConfig({ LIVE_SPOOL_DIR: spool });
    const { client } = createMemoryLiveEsClient();
    const sessions = new LiveSessionRepository(client, cfg);
    const sources = new LiveSourceRepository(client, cfg);

    const now = new Date().toISOString();
    const source: LiveSourceDocument = {
      source_id: 'src1',
      name: 's',
      protocol: 'rtsp',
      connection_ref: 'LIVE_SOURCE_FIXTURE_URL',
      enabled: true,
      validation_state: 'ready',
      source_revision: 1,
      active_session_id: 'ls_dead',
      created_at: now,
      updated_at: now,
    };
    await sources.create(source);
    await sessions.create(
      sessionDoc('ls_dead', { observed_state: 'stopped', desired_state: 'stopped' }),
    );

    const loop = new LiveWorkerLoop({
      cfg,
      workerId: 'w1',
      sessions,
      sources,
      enableCapture: false,
    });
    const { claimsCleared } = await loop.bootstrap();
    expect(claimsCleared).toBe(1);
    const after = await sources.get('src1');
    expect(after?.source.active_session_id).toBeUndefined();
    fs.rmSync(spool, { recursive: true, force: true });
  });

  it('stop drain clears active session claim (H4)', async () => {
    const spool = fs.mkdtempSync(path.join(os.tmpdir(), 'live-stop-claim-'));
    const cfg = loadLiveConfig({ LIVE_SPOOL_DIR: spool });
    const { client } = createMemoryLiveEsClient();
    const sessions = new LiveSessionRepository(client, cfg);
    const sources = new LiveSourceRepository(client, cfg);

    const now = new Date().toISOString();
    await sources.create({
      source_id: 'src1',
      name: 's',
      protocol: 'rtsp',
      connection_ref: 'LIVE_SOURCE_FIXTURE_URL',
      enabled: true,
      validation_state: 'ready',
      source_revision: 1,
      active_session_id: 'ls_one',
      created_at: now,
      updated_at: now,
    });
    await sessions.create(sessionDoc('ls_one'));

    const loop = new LiveWorkerLoop({
      cfg,
      workerId: 'w1',
      sessions,
      sources,
      enableCapture: false,
      pollIntervalMs: 60_000,
    });
    await loop.pollOnce();
    expect(loop.activeSessionIds).toEqual(['ls_one']);

    await sessions.updateDesiredState('ls_one', { desired_state: 'stopped' });
    await loop.pollOnce();
    expect(loop.activeSessionIds).toHaveLength(0);
    expect((await sources.get('src1'))?.source.active_session_id).toBeUndefined();

    await loop.drain();
    fs.rmSync(spool, { recursive: true, force: true });
  });

  it('validates pending sources to ready then allows session create path (A-01/V-01)', async () => {
    const spool = fs.mkdtempSync(path.join(os.tmpdir(), 'live-validate-'));
    const cfg = loadLiveConfig({ LIVE_SPOOL_DIR: spool });
    const { client } = createMemoryLiveEsClient();
    const sessions = new LiveSessionRepository(client, cfg);
    const sources = new LiveSourceRepository(client, cfg);

    const now = new Date().toISOString();
    await sources.create({
      source_id: 'src-pending',
      name: 'pending',
      protocol: 'rtsp',
      connection_ref: 'LIVE_SOURCE_FIXTURE_URL',
      transport: 'tcp',
      enabled: true,
      validation_state: 'pending_validation',
      source_revision: 1,
      created_at: now,
      updated_at: now,
    });

    const loop = new LiveWorkerLoop({
      cfg,
      workerId: 'w1',
      sessions,
      sources,
      enableCapture: false,
      validatePendingSource: async ({ source }) => {
        expect(source.validation_state).toBe('pending_validation');
        return {
          endpoint_redacted: 'rtsp://127.0.0.1:8554/fixture',
          endpoint_fingerprint: 'fp-validated',
          allowed_host: '127.0.0.1',
          allowed_port: 8554,
        };
      },
    });

    const result = await loop.validatePendingSources();
    expect(result).toEqual({ validated: 1, ready: 1, invalid: 0 });
    const after = await sources.get('src-pending');
    expect(after?.source.validation_state).toBe('ready');
    expect(after?.source.endpoint_fingerprint).toBe('fp-validated');
    expect(after?.source.allowed_host).toBe('127.0.0.1');
    expect(after?.source.allowed_port).toBe(8554);
    expect(after?.source.validation_error).toBeNull();

    // Second poll should be a no-op once ready.
    const again = await loop.validatePendingSources();
    expect(again.validated).toBe(0);

    fs.rmSync(spool, { recursive: true, force: true });
  });

  it('marks pending sources invalid when validation fails (A-01)', async () => {
    const spool = fs.mkdtempSync(path.join(os.tmpdir(), 'live-invalid-'));
    const cfg = loadLiveConfig({ LIVE_SPOOL_DIR: spool });
    const { client } = createMemoryLiveEsClient();
    const sources = new LiveSourceRepository(client, cfg);
    const sessions = new LiveSessionRepository(client, cfg);

    const now = new Date().toISOString();
    await sources.create({
      source_id: 'src-bad',
      name: 'bad',
      protocol: 'rtsp',
      connection_ref: 'LIVE_SOURCE_MISSING_URL',
      enabled: true,
      validation_state: 'pending_validation',
      source_revision: 1,
      created_at: now,
      updated_at: now,
    });

    const loop = new LiveWorkerLoop({
      cfg,
      workerId: 'w1',
      sessions,
      sources,
      enableCapture: false,
      validatePendingSource: async () => {
        throw new Error('secret missing');
      },
    });

    const result = await loop.validatePendingSources();
    expect(result.invalid).toBe(1);
    const after = await sources.get('src-bad');
    expect(after?.source.validation_state).toBe('invalid');
    expect(after?.source.validation_error?.code).toBe('LIVE_SOURCE_INVALID');

    fs.rmSync(spool, { recursive: true, force: true });
  });
});
