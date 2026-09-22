import { describe, expect, it } from 'vitest';
import { loadLiveConfig } from './config';
import { createMemoryLiveEsClient } from './memory-es';
import { deriveSessionId } from './session-id';
import { LiveSessionRepository } from './session-repository';
import { LiveSourceRepository } from './source-repository';
import type { LiveSessionDocument, LiveSourceDocument } from './types';

const cfg = loadLiveConfig({});

function readySource(id = 'src_a'): LiveSourceDocument {
  return {
    source_id: id,
    name: 'cam',
    protocol: 'rtsp',
    source_revision: 1,
    connection_ref: 'LIVE_SOURCE_DEMO_URL',
    transport: 'tcp',
    enabled: true,
    validation_state: 'ready',
    endpoint_redacted: 'rtsp://127.0.0.1:8554/live',
    endpoint_fingerprint: 'fp',
    allowed_host: '127.0.0.1',
    allowed_port: 8554,
    created_at: '2026-09-10T00:00:00.000Z',
    updated_at: '2026-09-10T00:00:00.000Z',
  };
}

function sessionDoc(
  sessionId: string,
  sourceId: string,
  key: string,
): LiveSessionDocument {
  return {
    session_id: sessionId,
    source_id: sourceId,
    idempotency_key: key,
    desired_state: 'running',
    observed_state: 'created',
    reserved_revision: 0,
    published_revision: 0,
    stream_epoch: 0,
    last_sequence_no_in_current_epoch: 0,
    source_snapshot: {
      source_revision: 1,
      protocol: 'rtsp',
      transport: 'tcp',
      connection_ref: 'LIVE_SOURCE_DEMO_URL',
      endpoint_fingerprint: 'fp',
      allowed_host: '127.0.0.1',
      allowed_port: 8554,
    },
    variant_id: 'v1',
    retention: { mode: 'until_explicit_delete' },
    window: { fragment_ms: 2000, window_ms: 8000, overlap_ms: 2000 },
    embedding: {
      provider: 'eis',
      model: 'm',
      task: 'retrieval.passage',
      dims: 1024,
      normalized_by: 'provider',
    },
    timestamps: {
      created_at: '2026-09-10T00:00:00.000Z',
      command_requested_at: '2026-09-10T00:00:00.000Z',
      updated_at: '2026-09-10T00:00:00.000Z',
    },
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
  };
}

describe('LiveSourceRepository claims', () => {
  it('reconciles concurrent creates to one session claim', async () => {
    const { client } = createMemoryLiveEsClient();
    const sources = new LiveSourceRepository(client, cfg);
    await sources.create(readySource('src_a'));

    const sessionId = deriveSessionId('src_a', 'idem-1');
    const [a, b] = await Promise.all([
      sources.claimActiveSession('src_a', sessionId),
      sources.claimActiveSession('src_a', sessionId),
    ]);

    expect([a.status, b.status].sort()).toEqual([
      'already_claimed',
      'claimed',
    ].sort());
    const after = await sources.get('src_a');
    expect(after?.source.active_session_id).toBe(sessionId);
  });

  it('rejects a different session while a claim is held', async () => {
    const { client } = createMemoryLiveEsClient();
    const sources = new LiveSourceRepository(client, cfg);
    await sources.create(readySource('src_b'));
    const first = deriveSessionId('src_b', 'a');
    const second = deriveSessionId('src_b', 'b');
    await sources.claimActiveSession('src_b', first);
    const conflict = await sources.claimActiveSession('src_b', second);
    expect(conflict.status).toBe('conflict');
    if (conflict.status === 'conflict') {
      expect(conflict.activeSessionId).toBe(first);
    }
  });

  it('clears only a matching terminal claim', async () => {
    const { client } = createMemoryLiveEsClient();
    const sources = new LiveSourceRepository(client, cfg);
    await sources.create(readySource('src_c'));
    const sessionId = deriveSessionId('src_c', 'x');
    await sources.claimActiveSession('src_c', sessionId);
    await sources.clearActiveSessionClaim('src_c', 'other');
    expect((await sources.get('src_c'))?.source.active_session_id).toBe(
      sessionId,
    );
    await sources.clearActiveSessionClaim('src_c', sessionId);
    expect(
      (await sources.get('src_c'))?.source.active_session_id,
    ).toBeUndefined();
  });
});

describe('session create + claim reconciliation', () => {
  it('create-indexes once when claim exists but first create was interrupted', async () => {
    const { client } = createMemoryLiveEsClient();
    const sources = new LiveSourceRepository(client, cfg);
    const sessions = new LiveSessionRepository(client, cfg);
    await sources.create(readySource('src_d'));

    const key = 'retry-key';
    const sessionId = deriveSessionId('src_d', key);
    const claim = await sources.claimActiveSession('src_d', sessionId);
    expect(claim.status).toBe('claimed');

    // Simulate interrupted create: claim held, no session yet.
    expect(await sessions.get(sessionId)).toBeNull();

    const first = await sessions.create(sessionDoc(sessionId, 'src_d', key));
    expect(first.status).toBe('created');
    const second = await sessions.create(sessionDoc(sessionId, 'src_d', key));
    expect(second.status).toBe('exists');
    expect(second.session.source.idempotency_key).toBe(key);
  });

  it('listAll / listDesiredRunning request seq_no_primary_term (real ES)', async () => {
    const { client } = createMemoryLiveEsClient();
    const searches: Array<Record<string, unknown>> = [];
    const wrapped = {
      ...client,
      search: async (params: Record<string, unknown>) => {
        searches.push(params);
        return client.search(params as never);
      },
    } as typeof client;
    const sources = new LiveSourceRepository(wrapped, cfg);
    const sessions = new LiveSessionRepository(wrapped, cfg);
    await sources.create(readySource('src_list'));
    await sessions.create(sessionDoc('ls_list', 'src_list', 'k'));
    const listed = await sources.listAll();
    expect(listed).toHaveLength(1);
    expect(listed[0]!._seq_no).toBeTypeOf('number');
    await sessions.listDesiredRunning();
    expect(
      searches.every((p) => p.seq_no_primary_term === true),
    ).toBe(true);
  });
});

describe('desired vs observed ownership via repositories', () => {
  it('API cannot overwrite observed_state through updateDesiredState', async () => {
    const { client } = createMemoryLiveEsClient();
    const sessions = new LiveSessionRepository(client, cfg);
    const doc = sessionDoc('ls_own', 'src_e', 'k');
    await sessions.create(doc);
    await expect(
      sessions.updateDesiredState('ls_own', {
        desired_state: 'stopped',
        observed_state: 'stopped',
      } as never),
    ).rejects.toThrow(/foreign fields|observed_state/i);
  });

  it('worker cannot overwrite desired_state through updateObservedFields', async () => {
    const { client } = createMemoryLiveEsClient();
    const sessions = new LiveSessionRepository(client, cfg);
    await sessions.create(sessionDoc('ls_own2', 'src_f', 'k'));
    await expect(
      sessions.updateObservedFields('ls_own2', {
        observed_state: 'connecting',
        desired_state: 'stopped',
      } as never),
    ).rejects.toThrow(/foreign fields|desired_state/i);
  });
});
