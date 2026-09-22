import type { PrepareFiniteMediaResult } from '../media/prepare-finite-media';
import { computeImmutableFingerprint } from './fingerprint';
import type {
  LiveChunkDocument,
  LiveSessionDocument,
  StageClockSample,
} from './types';
import type { LiveWorkItem } from './queue';
import { mintOpaqueMediaRef } from './spool-paths';

const LIVE_CHUNK_SCHEMA_VERSION = 1 as const;

export interface LiveWindowEmbedContext {
  session: LiveSessionDocument;
  workerBootId: string;
  /** PTS coverage of the remuxed window when known. */
  start_pts_ms?: number;
  end_pts_ms?: number;
  media_sha256?: string;
  discontinuity_before?: boolean;
  window_start_at?: string;
  clip_ref?: string;
  thumb_ref?: string;
}

function clockSample(
  bootId: string,
  utc: string,
  monoNs: number,
  uncertaintyMs = 0,
): StageClockSample {
  return {
    worker_boot_id: bootId,
    monotonic_ns: monoNs,
    utc,
    uncertainty_ms: uncertaintyMs,
  };
}

/**
 * Build a complete immutable live chunk document from prepare + session context.
 * Embeddings and modality presence are already atomic from prepareFiniteMedia.
 */
export function buildLiveChunkDocument(args: {
  item: LiveWorkItem;
  prepared: PrepareFiniteMediaResult;
  ctx: LiveWindowEmbedContext;
  attempt: number;
  queueWaitMs: number;
  inferenceStartedAt: string;
  inferenceFinishedAt: string;
  indexRequestedAt: string;
  windowReadyAt: string;
}): LiveChunkDocument {
  const { item, prepared, ctx } = args;
  const session = ctx.session;
  const nowMono = Number(process.hrtime.bigint() % BigInt(Number.MAX_SAFE_INTEGER));
  const startPts = ctx.start_pts_ms ?? 0;
  const endPts = ctx.end_pts_ms ?? startPts + item.duration_ms;
  const windowStart =
    ctx.window_start_at ??
    new Date(Date.parse(item.window_end_at) - item.duration_ms).toISOString();

  const clipRef =
    ctx.clip_ref ?? mintOpaqueMediaRef(session.session_id, 'clip');
  const thumbRef =
    ctx.thumb_ref ?? mintOpaqueMediaRef(session.session_id, 'thumb');

  const mediaSha = ctx.media_sha256?.trim();
  if (!mediaSha || mediaSha === 'sha256:unknown') {
    throw new Error(
      `media_sha256 required for live chunk ${item.chunk_id} (got ${ctx.media_sha256 ?? 'missing'})`,
    );
  }

  const base = {
    chunk_id: item.chunk_id,
    source_id: session.source_id,
    session_id: session.session_id,
    stream_epoch: item.stream_epoch,
    sequence_no: item.sequence_no,
    variant_id: session.variant_id,
    window_start_at: windowStart,
    window_end_at: item.window_end_at,
    start_pts_ms: startPts,
    end_pts_ms: endPts,
    duration_ms: item.duration_ms,
    media_sha256: mediaSha,
    embedding_video: prepared.embedding_video,
    embedding_audio: prepared.embedding_audio,
    provider: session.embedding.provider,
    model: session.embedding.model,
    task: session.embedding.task,
    normalized_by: session.embedding.normalized_by,
    schema_version: LIVE_CHUNK_SCHEMA_VERSION,
  };

  const immutable_fingerprint = computeImmutableFingerprint(base);

  const doc: LiveChunkDocument = {
    '@timestamp': item.window_end_at,
    event_ingested: args.indexRequestedAt,
    ...base,
    start_offset_ms: startPts,
    end_offset_ms: endPts,
    clock: {
      mode: 'receive_anchor',
      epoch_pts_origin_ms: 0,
      epoch_anchor_utc: item.receive_anchor_utc,
      uncertainty_ms: 0,
    },
    discontinuity_before: ctx.discontinuity_before ?? false,
    immutable_fingerprint,
    video_proxy: {
      bytes: prepared.videoMeta.bytes,
      width: prepared.videoMeta.width,
      height: prepared.videoMeta.height,
      frames: prepared.videoMeta.frames,
      crf: prepared.videoMeta.crf,
      strategy: prepared.videoMeta.strategy,
    },
    audio_proxy: prepared.audioMeta
      ? {
          bytes: prepared.audioMeta.bytes,
          bitrate: prepared.audioMeta.bitrate,
          codec: prepared.audioMeta.codec,
        }
      : undefined,
    media: {
      clip_ref: clipRef,
      thumb_ref: thumbRef,
      clip_expires_at: null,
      thumb_expires_at: null,
    },
    processing: {
      window_ready_at: args.windowReadyAt,
      inference_started_at: args.inferenceStartedAt,
      inference_finished_at: args.inferenceFinishedAt,
      index_requested_at: args.indexRequestedAt,
      worker_boot_id: ctx.workerBootId,
      attempt: args.attempt,
      queue_wait_ms: args.queueWaitMs,
      proxy_duration_ms: prepared.proxy_duration_ms,
      inference_duration_ms: prepared.inference_duration_ms,
      stage_clock: {
        window_closed: clockSample(
          ctx.workerBootId,
          item.receive_anchor_utc,
          item.receive_anchor_monotonic_ns ?? nowMono,
        ),
        inference_started: clockSample(
          ctx.workerBootId,
          args.inferenceStartedAt,
          nowMono,
        ),
        inference_finished: clockSample(
          ctx.workerBootId,
          args.inferenceFinishedAt,
          nowMono,
        ),
        index_requested: clockSample(
          ctx.workerBootId,
          args.indexRequestedAt,
          nowMono,
        ),
      },
    },
  };

  return doc;
}
