import type { AppConfig } from '../config';
import { getConfig } from '../config';
import {
  executeChunkSearch,
  type SearchHit,
  type SearchModality,
  type SearchSortBy,
} from '../es/search';
import type { ModalityBadge } from '../es/search-core';
import { getLiveConfig, type LiveConfig } from './config';
import {
  resolveLiveImageQueryVector,
  resolveLiveTextQueryVector,
  type QueryCacheHitKind,
} from './query-cache';
import { LiveApiError } from './errors';
import {
  buildLiveSearchFilters,
  parseLiveSearchModality,
  parseLiveSearchSortBy,
} from './search-filters';
import {
  createFollowSearchHandle,
  type FollowSearchHandle,
} from './follow-search';
import { LiveSessionRepository } from './session-repository';

export const LIVE_SOURCE_FIELDS = [
  'chunk_id',
  'source_id',
  'session_id',
  'stream_epoch',
  'sequence_no',
  'variant_id',
  'window_start_at',
  'window_end_at',
  'event_ingested',
  'start_pts_ms',
  'end_pts_ms',
  'start_offset_ms',
  'end_offset_ms',
  'duration_ms',
  'media',
] as const;

export interface LiveSearchHit extends SearchHit {
  source_id: string;
  session_id: string;
  stream_epoch: number;
  sequence_no: number;
  window_start_at: string;
  window_end_at: string;
  event_ingested: string;
  clip_url: string;
}

export interface LiveSearchRequest {
  query?: string;
  image?: Buffer;
  imageWidth?: number;
  imageHeight?: number;
  variantId: string;
  sourceIds?: string[];
  sessionIds?: string[];
  from?: string | null;
  to?: string | null;
  modality?: string;
  sortBy?: string;
  size?: number;
  follow?: boolean;
}

export interface LiveSearchResponse {
  hits: LiveSearchHit[];
  query_id: string | null;
  query_vector_cache: QueryCacheHitKind;
  follow_expires_at: string | null;
  session_cursors: Record<string, number> | null;
  meta: {
    size: number;
    rank_window_size: number;
    modality: SearchModality;
    sort_by: SearchSortBy;
    variant_id: string;
    badge_strategy: 'rrf_plus_parallel_knn' | 'single_knn';
    took_ms: number;
    image_bytes?: number;
  };
}

function liveThumbUrl(chunkId: string): string {
  return `/api/live/chunks/${encodeURIComponent(chunkId)}/thumb`;
}

function liveClipUrl(chunkId: string): string {
  return `/api/live/chunks/${encodeURIComponent(chunkId)}/media`;
}

export function mapLiveHit(
  id: string,
  score: number | undefined | null,
  src: Record<string, unknown> | undefined,
  badge: ModalityBadge,
  scoreVisual: number | null,
  scoreAudio: number | null,
  rankVisual: number | null,
  rankAudio: number | null,
): LiveSearchHit {
  const chunkId = String(src?.chunk_id ?? id);
  const startMs = Number(src?.start_offset_ms ?? src?.start_pts_ms ?? 0);
  const endMs = Number(src?.end_offset_ms ?? src?.end_pts_ms ?? startMs);
  return {
    chunk_id: chunkId,
    video_id: String(src?.session_id ?? ''),
    variant_id: String(src?.variant_id ?? ''),
    title: '',
    start_ms: startMs,
    end_ms: endMs,
    start_label: String(src?.window_start_at ?? ''),
    end_label: String(src?.window_end_at ?? ''),
    score: typeof score === 'number' ? score : 0,
    score_visual: scoreVisual,
    score_audio: scoreAudio,
    rank_visual: rankVisual,
    rank_audio: rankAudio,
    modality_badge: badge,
    thumb_url: liveThumbUrl(chunkId),
    source_id: String(src?.source_id ?? ''),
    session_id: String(src?.session_id ?? ''),
    stream_epoch: Number(src?.stream_epoch ?? 0),
    sequence_no: Number(src?.sequence_no ?? 0),
    window_start_at: String(src?.window_start_at ?? ''),
    window_end_at: String(src?.window_end_at ?? ''),
    event_ingested: String(src?.event_ingested ?? ''),
    clip_url: liveClipUrl(chunkId),
  };
}

async function captureSessionCursors(
  sessionIds: string[],
): Promise<Record<string, number>> {
  const sessions = new LiveSessionRepository();
  const cursors: Record<string, number> = {};
  await Promise.all(
    sessionIds.map(async (sessionId) => {
      const doc = await sessions.get(sessionId);
      cursors[sessionId] = doc?.source.published_revision ?? 0;
    }),
  );
  return cursors;
}

/**
 * Run live text or image search with shared query_vector + live filters.
 * When follow=true, captures session cursors before the initial retrieval.
 */
export async function runLiveSearch(
  req: LiveSearchRequest,
  deps?: {
    appCfg?: AppConfig;
    liveCfg?: LiveConfig;
    nowMs?: number;
    execute?: typeof executeChunkSearch;
  },
): Promise<LiveSearchResponse> {
  const appCfg = deps?.appCfg ?? getConfig();
  const liveCfg = deps?.liveCfg ?? getLiveConfig();
  const nowMs = deps?.nowMs ?? Date.now();
  const follow = Boolean(req.follow);
  const isImage = Boolean(req.image);

  const modality: SearchModality = isImage
    ? 'visual'
    : parseLiveSearchModality(req.modality);
  const sortBy: SearchSortBy = isImage
    ? 'visual'
    : parseLiveSearchSortBy(req.sortBy, modality);

  const filters = buildLiveSearchFilters(
    {
      variantId: req.variantId,
      sourceIds: req.sourceIds,
      sessionIds: req.sessionIds,
      from: req.from,
      to: req.to,
      follow,
    },
    liveCfg,
  );

  const sessionIds = (req.sessionIds ?? []).map((s) => s.trim()).filter(Boolean);
  let sessionCursors: Record<string, number> | null = null;
  if (follow) {
    sessionCursors = await captureSessionCursors(sessionIds);
  }

  let vector: number[];
  let cache: QueryCacheHitKind;
  let cacheKey: string;

  if (isImage) {
    const resolved = await resolveLiveImageQueryVector({
      image: req.image!,
      width: req.imageWidth ?? 0,
      height: req.imageHeight ?? 0,
      appCfg,
      liveCfg,
      nowMs,
    });
    vector = resolved.vector;
    cache = resolved.cache;
    cacheKey = resolved.key;
  } else {
    const query = (req.query ?? '').trim();
    if (!query) {
      throw new LiveApiError('LIVE_INVALID_REQUEST', {
        message: 'query is required',
      });
    }
    const resolved = await resolveLiveTextQueryVector({
      query,
      appCfg,
      liveCfg,
      nowMs,
    });
    vector = resolved.vector;
    cache = resolved.cache;
    cacheKey = resolved.key;
  }

  const execute = deps?.execute ?? executeChunkSearch;
  const result = await execute(
    {
      index: liveCfg.ES_DATA_STREAM_LIVE_CHUNKS,
      modality,
      sortBy,
      size: req.size,
      filters,
      sourceFields: LIVE_SOURCE_FIELDS,
      queryVectorMode: { kind: 'vector', vector },
      mapHitFn: mapLiveHit,
      collapseByChunkId: true,
    },
    appCfg,
  );

  const hits = result.hits as LiveSearchHit[];
  let queryId: string | null = null;
  let followExpiresAt: string | null = null;

  if (follow && sessionCursors) {
    const handle = createFollowSearchHandle({
      cacheKey,
      vector,
      filters,
      modality,
      sortBy,
      size: result.size,
      variantId: req.variantId,
      sourceIds: req.sourceIds ?? [],
      sessionIds,
      sessionCursors,
      initialChunkIds: hits.map((h) => h.chunk_id),
      expiresAtMs: nowMs + liveCfg.LIVE_QUERY_CACHE_TTL_MS,
      isImage,
      imageBytes: req.image?.length,
    });
    queryId = handle.queryId;
    followExpiresAt = new Date(handle.expiresAtMs).toISOString();
  }

  return {
    hits,
    query_id: queryId,
    query_vector_cache: cache,
    follow_expires_at: followExpiresAt,
    session_cursors: sessionCursors,
    meta: {
      size: result.size,
      rank_window_size: result.rank_window_size,
      modality: result.modality,
      sort_by: result.sort_by,
      variant_id: req.variantId,
      badge_strategy: result.badge_strategy,
      took_ms: result.took_ms,
      ...(isImage ? { image_bytes: req.image?.length } : {}),
    },
  };
}

/** Re-run search for an existing follow handle (cached vector, no new inference). */
export async function rerunLiveSearchWithVector(args: {
  handle: FollowSearchHandle;
  appCfg?: AppConfig;
  liveCfg?: LiveConfig;
  execute?: typeof executeChunkSearch;
}): Promise<LiveSearchHit[]> {
  const appCfg = args.appCfg ?? getConfig();
  const liveCfg = args.liveCfg ?? getLiveConfig();
  const execute = args.execute ?? executeChunkSearch;
  const result = await execute(
    {
      index: liveCfg.ES_DATA_STREAM_LIVE_CHUNKS,
      modality: args.handle.modality,
      sortBy: args.handle.sortBy,
      size: args.handle.size,
      filters: args.handle.filters,
      sourceFields: LIVE_SOURCE_FIELDS,
      queryVectorMode: { kind: 'vector', vector: args.handle.vector },
      mapHitFn: mapLiveHit,
      collapseByChunkId: true,
    },
    appCfg,
  );
  return result.hits as LiveSearchHit[];
}
