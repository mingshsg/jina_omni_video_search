import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadLiveConfig } from './config';
import { createMemoryLiveEsClient } from './memory-es';
import { LiveChunkRepository } from './chunk-repository';
import { LiveEventRepository } from './event-repository';
import { LiveSessionRepository } from './session-repository';
import { LiveIndexer } from './indexer';
import { computeImmutableFingerprint } from './fingerprint';
import { ensureSessionSpoolLayout } from './spool-paths';
import type { LiveChunkDocument, LiveSessionDocument } from './types';
import { pendingReplayChunkIds, readManifestRecords } from './fragment-manifest';

function sessionDoc(id: string): LiveSessionDocument {
  const now = new Date().toISOString();
  return {
    session_id: id,
    source_id: 'src1',
    idempotency_key: 'k1',
    desired_state: 'running',
    observed_state: 'live',
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
    variant_id: 'var1',
    retention: { mode: 'until_explicit_delete' },
    window: { fragment_ms: 2000, window_ms: 8000, overlap_ms: 2000 },
    embedding: {
      provider: 'eis',
      model: 'jina-embeddings-v5-omni-small',
      task: 'retrieval.passage',
      dims: 1024,
      normalized_by: 'provider',
    },
  };
}

function chunkDoc(
  sessionId: string,
  seq: number,
  embedding = Array.from({ length: 4 }, (_, i) => i / 10),
): LiveChunkDocument {
  const now = new Date().toISOString();
  const chunk_id = `${sessionId}_1_${seq}`;
  const base = {
    chunk_id,
    source_id: 'src1',
    session_id: sessionId,
    stream_epoch: 1,
    sequence_no: seq,
    variant_id: 'var1',
    window_start_at: now,
    window_end_at: now,
    start_pts_ms: 0,
    end_pts_ms: 8000,
    duration_ms: 8000,
    media_sha256: 'sha256:abc',
    embedding_video: embedding,
    provider: 'eis',
    model: 'jina-embeddings-v5-omni-small',
    task: 'retrieval.passage',
    normalized_by: 'provider',
    schema_version: 1,
  };
  const immutable_fingerprint = computeImmutableFingerprint(base);
  return {
    '@timestamp': now,
    event_ingested: now,
    ...base,
    start_offset_ms: 0,
    end_offset_ms: 8000,
    clock: {
      mode: 'receive_anchor',
      epoch_pts_origin_ms: 0,
      epoch_anchor_utc: now,
      uncertainty_ms: 0,
    },
    discontinuity_before: false,
    immutable_fingerprint,
    video_proxy: {
      bytes: 1,
      width: 320,
      height: 180,
      frames: 16,
      crf: 23,
      strategy: 'ladder',
    },
    media: {
      clip_ref: 'livemedia_clip_aaaaaaaaaaaa_bbbbbbbbbbbbbbbbbbbbbbbb',
      thumb_ref: 'livemedia_thumb_aaaaaaaaaaaa_cccccccccccccccccccccccc',
      clip_expires_at: null,
      thumb_expires_at: null,
    },
    processing: {
      window_ready_at: now,
      inference_started_at: now,
      inference_finished_at: now,
      index_requested_at: now,
      worker_boot_id: 'boot_x',
      attempt: 1,
      queue_wait_ms: 0,
      proxy_duration_ms: 1,
      inference_duration_ms: 1,
      stage_clock: {
        window_closed: {
          worker_boot_id: 'boot_x',
          monotonic_ns: 1,
          utc: now,
          uncertainty_ms: 0,
        },
        inference_started: {
          worker_boot_id: 'boot_x',
          monotonic_ns: 1,
          utc: now,
          uncertainty_ms: 0,
        },
        inference_finished: {
          worker_boot_id: 'boot_x',
          monotonic_ns: 1,
          utc: now,
          uncertainty_ms: 0,
        },
        index_requested: {
          worker_boot_id: 'boot_x',
          monotonic_ns: 1,
          utc: now,
          uncertainty_ms: 0,
        },
      },
    },
  };
}

describe('LiveIndexer micro-batch + fingerprint ack', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const d of dirs.splice(0)) {
      try {
        fs.rmSync(d, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });

  it('bulk-creates chunks, searchable events, and index_ack; duplicate is fingerprint-safe', async () => {
    const spool = fs.mkdtempSync(path.join(os.tmpdir(), 'live-idx-'));
    dirs.push(spool);
    const cfg = loadLiveConfig({ LIVE_SPOOL_DIR: spool });
    const { client } = createMemoryLiveEsClient();
    const sessions = new LiveSessionRepository(client, cfg);
    const chunks = new LiveChunkRepository(client, cfg);
    const events = new LiveEventRepository(client, cfg);
    const indexer = new LiveIndexer(cfg, chunks, events, sessions);

    const sessionId = 'ls_idx';
    const sessionDir = path.join(spool, 'sessions', sessionId);
    ensureSessionSpoolLayout(sessionDir);
    await sessions.create(sessionDoc(sessionId));

    const doc1 = chunkDoc(sessionId, 1);
    const doc2 = chunkDoc(sessionId, 2);

    await indexer.indexAckBatch([
      {
        chunk_id: doc1.chunk_id,
        session_id: sessionId,
        stream_epoch: 1,
        sequence_no: 1,
        enqueued_at: new Date().toISOString(),
        state: 'processing',
        draft: { chunk: doc1, session_dir: sessionDir },
      },
      {
        chunk_id: doc2.chunk_id,
        session_id: sessionId,
        stream_epoch: 1,
        sequence_no: 2,
        enqueued_at: new Date().toISOString(),
        state: 'processing',
        draft: { chunk: doc2, session_dir: sessionDir },
      },
    ]);

    expect(await chunks.findByChunkId(doc1.chunk_id)).not.toBeNull();
    expect(await chunks.findByChunkId(doc2.chunk_id)).not.toBeNull();

    const after = await sessions.get(sessionId);
    expect(after?.source.reserved_revision).toBe(2);
    expect(after?.source.published_revision).toBe(2);
    expect(after?.source.health.windows_searchable).toBe(2);

    // Duplicate replay with same fingerprint acknowledges
    const again = await chunks.create(doc1);
    expect(again).toBe('duplicate');

    const records = readManifestRecords(path.join(sessionDir, 'manifest.jsonl'));
    expect(records.some((r) => r.type === 'event_intent')).toBe(true);
    expect(records.some((r) => r.type === 'index_ack')).toBe(true);
    expect(pendingReplayChunkIds(records)).toEqual([]);
  });

  it('rejects duplicate create when fingerprint mismatches', async () => {
    const spool = fs.mkdtempSync(path.join(os.tmpdir(), 'live-fp-'));
    dirs.push(spool);
    const cfg = loadLiveConfig({ LIVE_SPOOL_DIR: spool });
    const { client } = createMemoryLiveEsClient();
    const chunks = new LiveChunkRepository(client, cfg);
    const doc = chunkDoc('ls_fp', 1);
    expect(await chunks.create(doc)).toBe('created');
    const evil = {
      ...doc,
      embedding_video: [9, 9, 9, 9],
      immutable_fingerprint: 'sha256:different',
    };
    await expect(chunks.create(evil)).rejects.toThrow(/fingerprint mismatch/);
  });

  it('M1/A-13: concurrent revision reservations get distinct CAS revisions', async () => {
    const spool = fs.mkdtempSync(path.join(os.tmpdir(), 'live-cas-'));
    dirs.push(spool);
    const cfg = loadLiveConfig({ LIVE_SPOOL_DIR: spool });
    const { client } = createMemoryLiveEsClient();
    const sessions = new LiveSessionRepository(client, cfg);
    const sessionId = 'ls_cas';
    await sessions.create(sessionDoc(sessionId));

    const results = await Promise.all([
      sessions.reserveNextRevision(sessionId),
      sessions.reserveNextRevision(sessionId),
      sessions.reserveNextRevision(sessionId),
    ]);
    const revisions = results.map((r) => r.revision).sort((a, b) => a - b);
    expect(revisions).toEqual([1, 2, 3]);
    const after = await sessions.get(sessionId);
    expect(after?.source.reserved_revision).toBe(3);
  });
});
