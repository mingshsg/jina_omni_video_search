import { getConfig } from '../config';
import { getEsClient } from './client';

/** Nested variant record stored on a video-assets document. */
export interface AssetVariantDoc {
  variant_id: string;
  chunk_preset: string;
  chunk_window_ms: number;
  chunk_overlap_ms: number;
  chunk_min_ms: number;
  provider: string;
  model: string;
  task: string;
  dims: number;
  normalized_by: string;
  schema_version: string;
  proxy_settings: {
    video_frames: number;
    max_long_edge: number;
    resolution_ladder: number[];
    crf_ladder: number[];
  };
  chunk_count: number;
  status: string;
  error?: string;
}

/** Job progress object on video-assets (matches mapping). */
export interface AssetJobDoc {
  job_id: string;
  stage: string;
  progress_pct: number;
  windows_total: number;
  windows_done: number;
  started_at?: string;
  updated_at: string;
  completed_at?: string;
}

/** Full video-assets document. */
export interface VideoAssetDocument {
  video_id: string;
  title: string;
  source_mode: string;
  source_origin_path?: string;
  source_fingerprint?: string;
  media_path: string;
  duration_ms: number;
  width: number;
  height: number;
  fps: number;
  has_audio: boolean;
  size_bytes: number;
  container: string;
  video_codec: string;
  playback_path?: string;
  variants: AssetVariantDoc[];
  status: string;
  job: AssetJobDoc;
  error?: string;
  created_at: string;
  updated_at: string;
}

/**
 * Upsert a video-assets document by `_id = video_id`.
 * Replaces the whole document (callers merge variants in memory first).
 */
export async function upsertAsset(
  doc: VideoAssetDocument,
): Promise<void> {
  const client = getEsClient();
  const cfg = getConfig();
  await client.index({
    index: cfg.ES_INDEX_ASSETS,
    id: doc.video_id,
    document: doc,
    refresh: 'wait_for',
  });
}

export async function getAsset(
  videoId: string,
): Promise<VideoAssetDocument | null> {
  const client = getEsClient();
  const cfg = getConfig();
  try {
    const res = await client.get<VideoAssetDocument>({
      index: cfg.ES_INDEX_ASSETS,
      id: videoId,
    });
    return res._source ?? null;
  } catch (err: unknown) {
    const status =
      typeof err === 'object' &&
      err !== null &&
      'meta' in err &&
      typeof (err as { meta?: { statusCode?: number } }).meta?.statusCode ===
        'number'
        ? (err as { meta: { statusCode: number } }).meta.statusCode
        : undefined;
    if (status === 404) return null;
    throw err;
  }
}

/** Find asset whose job.job_id matches (for SSE / retry lookup). */
export async function findAssetByJobId(
  jobId: string,
): Promise<VideoAssetDocument | null> {
  const client = getEsClient();
  const cfg = getConfig();
  const res = await client.search<VideoAssetDocument>({
    index: cfg.ES_INDEX_ASSETS,
    size: 1,
    query: {
      term: { 'job.job_id': jobId },
    },
  });
  const hit = res.hits.hits[0];
  return hit?._source ?? null;
}
