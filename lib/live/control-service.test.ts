import { beforeEach, describe, expect, it } from 'vitest';
import { resetConfig } from '../config';
import { loadLiveConfig, resetLiveConfig } from './config';
import { createMemoryLiveEsClient } from './memory-es';
import { LiveSourceRepository } from './source-repository';
import { LiveSessionRepository } from './session-repository';
import { LiveWorkerRepository } from './worker-repository';
import { LiveControlService } from './control-service';
import { LiveApiError } from './errors';
import { LIVE_WORKER_DOC_ID } from './types';
import type { LiveSourceDocument } from './types';

function readySource(id = 'src-ready'): LiveSourceDocument {
  const now = new Date().toISOString();
  return {
    source_id: id,
    name: 'Lobby',
    protocol: 'rtsp',
    connection_ref: 'LIVE_SOURCE_LOBBY_CAMERA_URL',
    transport: 'tcp',
    enabled: true,
    validation_state: 'ready',
    source_revision: 1,
    endpoint_redacted: 'rtsp://127.0.0.1:8554/fixture',
    endpoint_fingerprint: 'fp1',
    allowed_host: '127.0.0.1',
    allowed_port: 8554,
    created_at: now,
    updated_at: now,
  };
}

describe('LiveControlService', () => {
  beforeEach(() => {
    resetLiveConfig();
    resetConfig();
    process.env.ELASTICSEARCH_URL =
      process.env.ELASTICSEARCH_URL ?? 'https://example.test';
    process.env.ELASTICSEARCH_API_KEY =
      process.env.ELASTICSEARCH_API_KEY ?? 'test-key';
    process.env.EMBED_PROVIDER = process.env.EMBED_PROVIDER ?? 'eis';
    process.env.EMBED_INFERENCE_ID =
      process.env.EMBED_INFERENCE_ID ?? '.jina-embeddings-v5-omni-small';
    process.env.EMBED_MODEL =
      process.env.EMBED_MODEL ?? 'jina-embeddings-v5-omni-small';
    process.env.EMBED_TASK_PASSAGE =
      process.env.EMBED_TASK_PASSAGE ?? 'retrieval.passage';
    process.env.EMBED_DIMS = process.env.EMBED_DIMS ?? '1024';
    process.env.SCHEMA_VERSION = process.env.SCHEMA_VERSION ?? '1';
    process.env.EIS_MAX_BINARY_BYTES =
      process.env.EIS_MAX_BINARY_BYTES ?? '1048576';
  });

  function harness() {
    const cfg = loadLiveConfig({});
    const { client } = createMemoryLiveEsClient();
    const sources = new LiveSourceRepository(client, cfg);
    const sessions = new LiveSessionRepository(client, cfg);
    const workers = new LiveWorkerRepository(client, cfg);
    const service = new LiveControlService(sources, sessions, workers, cfg);
    return { cfg, client, sources, sessions, workers, service };
  }

  async function publishFreshWorker(
    workers: LiveWorkerRepository,
  ): Promise<void> {
    await workers.publishHeartbeat({
      worker_id: 'w1',
      started_at: new Date().toISOString(),
      heartbeat_at: new Date().toISOString(),
      spool_lock_held: true,
      version: '0.1.0',
      image_digest: 'unpinned',
      capabilities_hash: 'abc',
    });
  }

  it('creates source as pending_validation without secrets', async () => {
    const { service } = harness();
    const source = await service.createSource({
      name: 'Lobby camera',
      protocol: 'rtsp',
      connection_ref: 'LIVE_SOURCE_LOBBY_CAMERA_URL',
      transport: 'tcp',
    });
    expect(source.validation_state).toBe('pending_validation');
    expect(JSON.stringify(source)).not.toMatch(/password/i);
  });

  it('rejects session create when worker heartbeat is stale', async () => {
    const { service, sources } = harness();
    await sources.create(readySource());
    await expect(
      service.createSession({
        source_id: 'src-ready',
        idempotency_key: 'k1',
      }),
    ).rejects.toMatchObject({ code: 'LIVE_WORKER_UNAVAILABLE' });
  });

  it('creates session with deterministic id and is idempotent', async () => {
    const { service, sources, workers, sessions } = harness();
    await sources.create(readySource());
    await publishFreshWorker(workers);

    const a = await service.createSession({
      source_id: 'src-ready',
      idempotency_key: 'start-1',
    });
    const b = await service.createSession({
      source_id: 'src-ready',
      idempotency_key: 'start-1',
    });
    expect(a.status).toBe(202);
    expect(b.body).toEqual(a.body);
    const sessionId = (a.body.session as { session_id: string }).session_id;
    const stored = await sessions.get(sessionId);
    expect(stored?.source.desired_state).toBe('running');
    expect(stored?.source.retention.mode).toBe('until_explicit_delete');
    expect(stored?.id).toMatch(/^ls_/);
    expect(stored?.source.embedding.dims).toBe(
      Number(process.env.EMBED_DIMS ?? '1024'),
    );
  });

  it('M7/A-18: session embedding dims follow EMBED_DIMS', async () => {
    process.env.EMBED_DIMS = '768';
    resetConfig();
    const { service, sources, workers, sessions } = harness();
    await sources.create(readySource('src-dims'));
    await publishFreshWorker(workers);
    const created = await service.createSession({
      source_id: 'src-dims',
      idempotency_key: 'dims-1',
    });
    const sessionId = (created.body.session as { session_id: string }).session_id;
    const stored = await sessions.get(sessionId);
    expect(stored?.source.embedding.dims).toBe(768);
    process.env.EMBED_DIMS = '1024';
    resetConfig();
  });

  it('force_new returns replacement pending while prior is nonterminal', async () => {
    const { service, sources, workers } = harness();
    await sources.create(readySource());
    await publishFreshWorker(workers);
    await service.createSession({
      source_id: 'src-ready',
      idempotency_key: 'a',
    });
    await expect(
      service.createSession({
        source_id: 'src-ready',
        idempotency_key: 'b',
        force_new: true,
      }),
    ).rejects.toBeInstanceOf(LiveApiError);
    await expect(
      service.createSession({
        source_id: 'src-ready',
        idempotency_key: 'b',
        force_new: true,
      }),
    ).rejects.toMatchObject({ code: 'LIVE_SESSION_REPLACEMENT_PENDING' });
  });

  it('stop sets desired_state=stopped; start conflicts after stop', async () => {
    const { service, sources, workers } = harness();
    await sources.create(readySource());
    await publishFreshWorker(workers);
    const created = await service.createSession({
      source_id: 'src-ready',
      idempotency_key: 'stop-test',
    });
    const sessionId = (created.body.session as { session_id: string })
      .session_id;
    const stopped = await service.stopSession(sessionId);
    expect(stopped.desired_state).toBe('stopped');
    // Mark observed terminal so start conflict path is clear
    await expect(service.startSession(sessionId)).rejects.toMatchObject({
      code: 'LIVE_SESSION_CONFLICT',
    });
  });

  it('terminal session + same idempotency key conflicts; claim clears on terminal stop (H4)', async () => {
    const { service, sources, sessions, workers } = harness();
    await sources.create(readySource('src-h4'));
    await publishFreshWorker(workers);

    const created = await service.createSession({
      source_id: 'src-h4',
      idempotency_key: 'same-key',
    });
    const sessionId = (created.body.session as { session_id: string })
      .session_id;
    expect((await sources.get('src-h4'))?.source.active_session_id).toBe(
      sessionId,
    );

    await service.stopSession(sessionId);
    // Simulate worker reaching terminal observed state
    await sessions.updateObservedFields(sessionId, {
      observed_state: 'stopped',
      timestamps: {
        created_at: new Date().toISOString(),
        command_requested_at: new Date().toISOString(),
        stopped_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    });
    // stop again (idempotent) clears claim once terminal
    await service.stopSession(sessionId);
    expect(
      (await sources.get('src-h4'))?.source.active_session_id,
    ).toBeUndefined();

    await expect(
      service.createSession({
        source_id: 'src-h4',
        idempotency_key: 'same-key',
      }),
    ).rejects.toMatchObject({ code: 'LIVE_SESSION_CONFLICT' });

    // H4 residual: claim acquired then conflict must be cleared.
    expect(
      (await sources.get('src-h4'))?.source.active_session_id,
    ).toBeUndefined();

    const next = await service.createSession({
      source_id: 'src-h4',
      idempotency_key: 'new-key',
    });
    expect(next.status).toBe(202);
    const nextId = (next.body.session as { session_id: string }).session_id;
    expect(nextId).not.toBe(sessionId);
    expect((await sources.get('src-h4'))?.source.active_session_id).toBe(nextId);
  });

  it('rejects invalid connection_ref names', async () => {
    const { service } = harness();
    await expect(
      service.createSource({
        name: 'x',
        protocol: 'rtsp',
        connection_ref: 'NOT_A_VALID_REF',
      }),
    ).rejects.toMatchObject({ code: 'LIVE_INVALID_REQUEST' });
  });

  it('rejects patch transport incompatible with the source protocol', async () => {
    const { service, sources } = harness();
    const created = await sources.create(readySource('src-patch-transport'));
    await expect(
      service.patchSource(created.source.source_id, { transport: 'caller' }),
    ).rejects.toMatchObject({ code: 'LIVE_INVALID_REQUEST' });
    await expect(
      service.patchSource(created.source.source_id, { transport: 'udp' }),
    ).rejects.toMatchObject({ code: 'LIVE_INVALID_REQUEST' });
  });

  it('deletes source when no active session', async () => {
    const { service, sources } = harness();
    await sources.create(readySource('src-del'));
    const result = await service.deleteSource('src-del');
    expect(result).toEqual({ deleted: true, source_id: 'src-del' });
    expect(await sources.get('src-del')).toBeNull();
  });

  it('refuses delete while active session is nonterminal', async () => {
    const { service, sources, workers, sessions } = harness();
    await sources.create(readySource('src-busy'));
    await publishFreshWorker(workers);
    const created = await service.createSession({
      source_id: 'src-busy',
      idempotency_key: 'busy-1',
    });
    const sessionId = (created.body.session as { session_id: string }).session_id;
    expect(await sessions.get(sessionId)).not.toBeNull();
    await expect(service.deleteSource('src-busy')).rejects.toMatchObject({
      code: 'LIVE_SESSION_CONFLICT',
    });
    expect(await sources.get('src-busy')).not.toBeNull();
  });

  it('deletes source after session is stopped and terminal', async () => {
    const { service, sources, workers, sessions } = harness();
    await sources.create(readySource('src-stop-del'));
    await publishFreshWorker(workers);
    const created = await service.createSession({
      source_id: 'src-stop-del',
      idempotency_key: 'stop-del-1',
    });
    const sessionId = (created.body.session as { session_id: string }).session_id;
    await service.stopSession(sessionId);
    // Simulate worker reaching terminal observed state, then clear claim.
    await sessions.updateObservedFields(sessionId, {
      observed_state: 'stopped',
      timestamps: {
        created_at: new Date().toISOString(),
        command_requested_at: new Date().toISOString(),
        stopped_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    });
    await service.stopSession(sessionId);
    const result = await service.deleteSource('src-stop-del');
    expect(result.deleted).toBe(true);
    expect(await sources.get('src-stop-del')).toBeNull();
  });

  it('worker doc id remains singleton', () => {
    expect(LIVE_WORKER_DOC_ID).toBe('singleton');
  });
});
