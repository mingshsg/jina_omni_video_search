import { describe, expect, it } from 'vitest';
import { buildLiveChunkDocument } from './live-chunk-builder';
import type { LiveSessionDocument } from './types';
import { makeWorkItem } from './processor';

function session(): LiveSessionDocument {
  const now = new Date().toISOString();
  return {
    session_id: 'ls_b',
    source_id: 'src1',
    idempotency_key: 'k',
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
    timestamps: { created_at: now, command_requested_at: now, updated_at: now },
    source_snapshot: {
      source_revision: 1,
      protocol: 'rtsp',
      transport: 'tcp',
      connection_ref: 'LIVE_SOURCE_X',
      endpoint_fingerprint: 'fp',
      allowed_host: '127.0.0.1',
      allowed_port: 8554,
    },
    variant_id: 'v',
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

describe('buildLiveChunkDocument', () => {
  it('M3/A-15: rejects missing or unknown media_sha256', () => {
    const item = makeWorkItem({
      chunk_id: 'ls_b_1_3',
      session_id: 'ls_b',
      sequence_no: 3,
    });
    const prepared = {
      embedding_video: [0.1, 0.2],
      embedding_audio: undefined,
      videoMeta: {
        bytes: 1,
        width: 320,
        height: 180,
        frames: 8,
        crf: 23,
        strategy: 'ladder' as const,
      },
      audioMeta: undefined,
      proxy_duration_ms: 1,
      inference_duration_ms: 1,
    };
    const now = new Date().toISOString();
    expect(() =>
      buildLiveChunkDocument({
        item,
        prepared,
        ctx: { session: session(), workerBootId: 'boot' },
        attempt: 1,
        queueWaitMs: 0,
        inferenceStartedAt: now,
        inferenceFinishedAt: now,
        indexRequestedAt: now,
        windowReadyAt: now,
      }),
    ).toThrow(/media_sha256 required/);

    expect(() =>
      buildLiveChunkDocument({
        item,
        prepared,
        ctx: {
          session: session(),
          workerBootId: 'boot',
          media_sha256: 'sha256:unknown',
        },
        attempt: 1,
        queueWaitMs: 0,
        inferenceStartedAt: now,
        inferenceFinishedAt: now,
        indexRequestedAt: now,
        windowReadyAt: now,
      }),
    ).toThrow(/media_sha256 required/);
  });

  it('binds a real media digest into the chunk', () => {
    const item = makeWorkItem({
      chunk_id: 'ls_b_1_4',
      session_id: 'ls_b',
      sequence_no: 4,
    });
    const prepared = {
      embedding_video: [0.1, 0.2],
      embedding_audio: undefined,
      videoMeta: {
        bytes: 1,
        width: 320,
        height: 180,
        frames: 8,
        crf: 23,
        strategy: 'ladder' as const,
      },
      audioMeta: undefined,
      proxy_duration_ms: 1,
      inference_duration_ms: 1,
    };
    const now = new Date().toISOString();
    const doc = buildLiveChunkDocument({
      item,
      prepared,
      ctx: {
        session: session(),
        workerBootId: 'boot',
        media_sha256: 'sha256:deadbeef',
      },
      attempt: 1,
      queueWaitMs: 0,
      inferenceStartedAt: now,
      inferenceFinishedAt: now,
      indexRequestedAt: now,
      windowReadyAt: now,
    });
    expect(doc.media_sha256).toBe('sha256:deadbeef');
    expect(doc.immutable_fingerprint).toMatch(/^sha256:/);
  });
});
