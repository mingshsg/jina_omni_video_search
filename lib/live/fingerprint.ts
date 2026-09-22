import { createHash } from 'node:crypto';
import type { LiveChunkDocument, LiveEventDocument } from './types';

/**
 * Immutable live chunk fingerprint — identity for create/409 acknowledgment.
 * Excludes processing timestamps that change across recovery retries.
 */

export function liveChunkFingerprintPayload(
  doc: Pick<
    LiveChunkDocument,
    | 'chunk_id'
    | 'source_id'
    | 'session_id'
    | 'stream_epoch'
    | 'sequence_no'
    | 'variant_id'
    | 'window_start_at'
    | 'window_end_at'
    | 'start_pts_ms'
    | 'end_pts_ms'
    | 'duration_ms'
    | 'media_sha256'
    | 'embedding_video'
    | 'embedding_audio'
    | 'provider'
    | 'model'
    | 'task'
    | 'normalized_by'
    | 'schema_version'
  >,
): string {
  return JSON.stringify({
    chunk_id: doc.chunk_id,
    source_id: doc.source_id,
    session_id: doc.session_id,
    stream_epoch: doc.stream_epoch,
    sequence_no: doc.sequence_no,
    variant_id: doc.variant_id,
    window_start_at: doc.window_start_at,
    window_end_at: doc.window_end_at,
    start_pts_ms: doc.start_pts_ms,
    end_pts_ms: doc.end_pts_ms,
    duration_ms: doc.duration_ms,
    media_sha256: doc.media_sha256,
    embedding_video: doc.embedding_video,
    embedding_audio: doc.embedding_audio ?? null,
    provider: doc.provider,
    model: doc.model,
    task: doc.task,
    normalized_by: doc.normalized_by,
    schema_version: doc.schema_version,
  });
}

export function computeImmutableFingerprint(
  doc: Parameters<typeof liveChunkFingerprintPayload>[0],
): string {
  return `sha256:${createHash('sha256')
    .update(liveChunkFingerprintPayload(doc))
    .digest('hex')}`;
}

/** Seed fingerprint for event_intent — binds reserved identity (L3). */
export function computeEventIntentSeedFingerprint(input: {
  event_id: string;
  session_id: string;
  chunk_id: string;
  revision: number;
  event_type: 'searchable';
}): string {
  return `sha256:${createHash('sha256')
    .update(
      JSON.stringify({
        event_id: input.event_id,
        session_id: input.session_id,
        chunk_id: input.chunk_id,
        revision: input.revision,
        type: input.event_type,
      }),
    )
    .digest('hex')}`;
}

export function computeEventFingerprint(
  doc: Pick<
    LiveEventDocument,
    | 'event_id'
    | 'session_id'
    | 'source_id'
    | 'revision'
    | 'type'
    | 'chunk_id'
    | 'searchable_at'
    | 'payload'
  >,
): string {
  const payload = JSON.stringify({
    event_id: doc.event_id,
    session_id: doc.session_id,
    source_id: doc.source_id,
    revision: doc.revision,
    type: doc.type,
    chunk_id: doc.chunk_id ?? null,
    searchable_at: doc.searchable_at ?? null,
    payload: doc.payload,
  });
  return `sha256:${createHash('sha256').update(payload).digest('hex')}`;
}

export function eventIdFor(sessionId: string, revision: number): string {
  return `${sessionId}_${revision}`;
}
