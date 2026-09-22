import { getConfig } from '../config';
import { getEsClient } from './client';
import type { VideoAssetDocument } from './index-assets';

export interface LibraryAssetSummary {
  video_id: string;
  title: string;
  source_mode: string;
  duration_ms: number;
  width: number;
  height: number;
  has_audio: boolean;
  status: string;
  error?: string;
  job_id?: string;
  job_stage?: string;
  progress_pct?: number;
  created_at: string;
  updated_at: string;
  variants: Array<{
    variant_id: string;
    chunk_preset: string;
    chunk_window_ms: number;
    chunk_overlap_ms: number;
    chunk_count: number;
    status: string;
    provider: string;
    model: string;
    error?: string;
  }>;
}

function toSummary(doc: VideoAssetDocument): LibraryAssetSummary {
  return {
    video_id: doc.video_id,
    title: doc.title,
    source_mode: doc.source_mode,
    duration_ms: doc.duration_ms,
    width: doc.width,
    height: doc.height,
    has_audio: doc.has_audio,
    status: doc.status,
    error: doc.error,
    job_id: doc.job?.job_id,
    job_stage: doc.job?.stage,
    progress_pct: doc.job?.progress_pct,
    created_at: doc.created_at,
    updated_at: doc.updated_at,
    variants: (doc.variants ?? []).map((v) => ({
      variant_id: v.variant_id,
      chunk_preset: v.chunk_preset,
      chunk_window_ms: v.chunk_window_ms,
      chunk_overlap_ms: v.chunk_overlap_ms,
      chunk_count: v.chunk_count,
      status: v.status,
      provider: v.provider,
      model: v.model,
      error: v.error,
    })),
  };
}

/** List video-assets newest-first (library page). */
export async function listAssets(
  size = 100,
): Promise<LibraryAssetSummary[]> {
  const client = getEsClient();
  const cfg = getConfig();
  const res = await client.search<VideoAssetDocument>({
    index: cfg.ES_INDEX_ASSETS,
    size: Math.min(Math.max(size, 1), 500),
    sort: [{ updated_at: { order: 'desc' } }],
    query: { match_all: {} },
  });
  return res.hits.hits
    .map((h) => h._source)
    .filter((s): s is VideoAssetDocument => Boolean(s))
    .map(toSummary);
}

/**
 * Remove asset + all its chunks from Elasticsearch.
 * Does **not** delete files on disk (NFR-5).
 */
export async function removeAssetFromIndex(
  videoId: string,
): Promise<{ deleted_asset: boolean; deleted_chunks: number }> {
  const client = getEsClient();
  const cfg = getConfig();

  const chunks = await client.deleteByQuery({
    index: cfg.ES_INDEX_CHUNKS,
    refresh: true,
    query: { term: { video_id: videoId } },
  });

  let deletedAsset = false;
  try {
    await client.delete({
      index: cfg.ES_INDEX_ASSETS,
      id: videoId,
      refresh: 'wait_for',
    });
    deletedAsset = true;
  } catch (err: unknown) {
    const status =
      typeof err === 'object' &&
      err !== null &&
      'meta' in err &&
      typeof (err as { meta?: { statusCode?: number } }).meta?.statusCode ===
        'number'
        ? (err as { meta: { statusCode: number } }).meta.statusCode
        : undefined;
    if (status !== 404) throw err;
  }

  return {
    deleted_asset: deletedAsset,
    deleted_chunks: typeof chunks.deleted === 'number' ? chunks.deleted : 0,
  };
}

export const LIBRARY_BATCH_DELETE_MAX = 200;

export type BatchRemoveAssetResult = {
  video_id: string;
  ok: boolean;
  deleted_asset: boolean;
  deleted_chunks: number;
  error?: string;
};

/**
 * Remove many assets (+ chunks) from Elasticsearch.
 * Does **not** delete files on disk (NFR-5). Per-id failures are reported;
 * other ids still proceed.
 */
export async function removeAssetsFromIndex(
  videoIds: string[],
): Promise<{
  requested: number;
  removed: number;
  failed: number;
  results: BatchRemoveAssetResult[];
}> {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const raw of videoIds) {
    const id = typeof raw === 'string' ? raw.trim() : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }

  const results: BatchRemoveAssetResult[] = [];
  let removed = 0;
  let failed = 0;

  for (const videoId of ids) {
    try {
      const result = await removeAssetFromIndex(videoId);
      if (result.deleted_asset || result.deleted_chunks > 0) {
        removed += 1;
        results.push({
          video_id: videoId,
          ok: true,
          deleted_asset: result.deleted_asset,
          deleted_chunks: result.deleted_chunks,
        });
      } else {
        failed += 1;
        results.push({
          video_id: videoId,
          ok: false,
          deleted_asset: false,
          deleted_chunks: 0,
          error: 'not_found',
        });
      }
    } catch (err) {
      failed += 1;
      const message = err instanceof Error ? err.message : 'Remove failed';
      results.push({
        video_id: videoId,
        ok: false,
        deleted_asset: false,
        deleted_chunks: 0,
        error: message.replace(/ApiKey\s+\S+/gi, 'ApiKey [redacted]'),
      });
    }
  }

  return { requested: ids.length, removed, failed, results };
}
