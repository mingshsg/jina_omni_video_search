import { getConfig } from '../config';
import type { AssetMeta } from '../metadata/validate';
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
  /** Editorial metadata — owned by PATCH /meta, never by ingest. */
  meta?: AssetMeta;
}

/** Ingest-owned fields only (partial update; arrays replaced wholesale). */
export type IngestOwnedAssetFields = Omit<
  Pick<
    VideoAssetDocument,
    | 'title'
    | 'source_mode'
    | 'source_origin_path'
    | 'source_fingerprint'
    | 'media_path'
    | 'duration_ms'
    | 'width'
    | 'height'
    | 'fps'
    | 'has_audio'
    | 'size_bytes'
    | 'container'
    | 'video_codec'
    | 'playback_path'
    | 'variants'
    | 'status'
    | 'job'
    | 'updated_at'
  >,
  never
> & {
  /** Explicit null clears a previous error on partial update. */
  error?: string | null;
};

export function ingestOwnedFieldsFromDoc(
  doc: VideoAssetDocument,
): IngestOwnedAssetFields {
  return {
    title: doc.title,
    source_mode: doc.source_mode,
    source_origin_path: doc.source_origin_path,
    source_fingerprint: doc.source_fingerprint,
    media_path: doc.media_path,
    duration_ms: doc.duration_ms,
    width: doc.width,
    height: doc.height,
    fps: doc.fps,
    has_audio: doc.has_audio,
    size_bytes: doc.size_bytes,
    container: doc.container,
    video_codec: doc.video_codec,
    playback_path: doc.playback_path,
    variants: doc.variants,
    status: doc.status,
    job: doc.job,
    error: doc.error ?? null,
    updated_at: doc.updated_at,
  };
}

function esStatusCode(err: unknown): number | undefined {
  if (
    typeof err === 'object' &&
    err !== null &&
    'meta' in err &&
    typeof (err as { meta?: { statusCode?: number } }).meta?.statusCode ===
      'number'
  ) {
    return (err as { meta: { statusCode: number } }).meta.statusCode;
  }
  return undefined;
}

function esErrorType(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null || !('meta' in err)) {
    return undefined;
  }
  return (err as { meta?: { body?: { error?: { type?: string } } } }).meta?.body
    ?.error?.type;
}

/**
 * Create asset document only if absent. Does not replace existing docs
 * (preserves editorial `meta`).
 */
export async function createAssetIfAbsent(
  doc: VideoAssetDocument,
): Promise<'created' | 'exists'> {
  const client = getEsClient();
  const cfg = getConfig();
  try {
    await client.create({
      index: cfg.ES_INDEX_ASSETS,
      id: doc.video_id,
      document: doc,
      refresh: 'wait_for',
    });
    return 'created';
  } catch (err: unknown) {
    const status = esStatusCode(err);
    const type = esErrorType(err);
    if (
      status === 409 ||
      type === 'version_conflict_engine_exception' ||
      type === 'resource_already_exists_exception'
    ) {
      return 'exists';
    }
    throw err;
  }
}

/**
 * Partial update of ingest-owned fields. Never touches `meta`.
 * Arrays (e.g. variants) are replaced wholesale. Bounded retry_on_conflict
 * for transport version races with the metadata editor.
 */
export async function patchIngestOwnedFields(
  videoId: string,
  fields: IngestOwnedAssetFields,
): Promise<void> {
  const client = getEsClient();
  const cfg = getConfig();
  await client.update({
    index: cfg.ES_INDEX_ASSETS,
    id: videoId,
    refresh: 'wait_for',
    retry_on_conflict: 3,
    doc: fields,
  });
}

/**
 * Persist ingest state without clobbering editorial metadata.
 * First write creates the document; later writes are partial updates.
 */
export async function persistIngestAsset(
  doc: VideoAssetDocument,
): Promise<void> {
  const created = await createAssetIfAbsent(doc);
  if (created === 'exists') {
    await patchIngestOwnedFields(
      doc.video_id,
      ingestOwnedFieldsFromDoc(doc),
    );
  }
}

/**
 * Upsert a video-assets document by `_id = video_id`.
 * Replaces the whole document — prefer {@link persistIngestAsset} for ingest.
 * Kept for scripts/tests that intentionally rewrite the full doc.
 */
export async function upsertAsset(doc: VideoAssetDocument): Promise<void> {
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
    if (esStatusCode(err) === 404) return null;
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
