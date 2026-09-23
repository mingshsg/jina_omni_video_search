import type { AppConfig } from '../config';
import { getConfig } from '../config';
import { createEmbeddingProvider } from '../embed/provider';
import {
  buildChunkFilters,
  enumerateEligibleAssetIds,
  hasActiveFilters,
  type NormalizedSearchFilters,
} from '../metadata/search-filters';
import { getEsClient } from './client';
import type { HybridQueryDslExplain } from './hybrid-search';
import {
  assembleHits,
  clampSearchSize,
  collapseEsHitsById,
  compareOptionalScoresDesc,
  effectiveRankWindowSize,
  emptyIdMaps,
  FILE_SOURCE_FIELDS,
  idMaps,
  knnRetrieverBody,
  mapFileHit,
  mergeSources,
  pickPrimaryHits,
  toEsHits,
  weightedKnnChild,
  type EsSearchHit,
  type HitMapper,
  type IdMaps,
  type QueryVectorMode,
  type SearchHit,
  type SearchModality,
  type SearchSortBy,
} from './search-core';

export type {
  SearchHit,
  SearchModality,
  SearchSortBy,
  ModalityBadge,
  QueryVectorMode,
  EsSearchHit,
} from './search-core';

export {
  clampSearchSize,
  effectiveRankWindowSize,
  badgeFromRanks,
  compareOptionalScoresDesc,
  knnRetrieverBody,
  applyQueryVector,
  collapseEsHitsById,
  FILE_SOURCE_FIELDS,
} from './search-core';

export interface SearchParams {
  query: string;
  modality: SearchModality;
  variantId: string;
  videoId?: string | null;
  size?: number;
  sortBy?: SearchSortBy;
  /** Facet filters — when present, ready-ID allow-list is applied. */
  filters?: NormalizedSearchFilters | null;
  /**
   * When true (Phase 3 hybrid), always apply the ready-ID allow-list even
   * without facets. Phase 2 only sets this false / omits it.
   */
  requireReadyAllowList?: boolean;
  /** Opt-in hybrid text+vector ranking (Phase 3). Default off. */
  hybrid?: { use_text?: boolean };
  /** Parsed residual for query embedding (Phase 3.5). */
  vectorQuery?: string;
  /** Parsed free_text for BM25 (Phase 3.5). */
  bm25Query?: string;
  sceneTermsPresent?: boolean;
  extractedBoosts?: import('./hybrid-fusion').ExtractedFacetBoosts | null;
  /** Speculative / precomputed query vector (Phase 3.6). */
  queryVector?: number[];
  speculativeEmbed?: Promise<{ vector: number[]; took_ms: number } | null>;
  priorEmbedCalls?: number;
}

export interface ImageSearchParams {
  image: Buffer;
  variantId: string;
  videoId?: string | null;
  size?: number;
  filters?: NormalizedSearchFilters | null;
}

export interface SearchResult {
  hits: SearchHit[];
  rank_window_size: number;
  size: number;
  modality: SearchModality;
  sort_by: SearchSortBy;
  variant_id: string;
  video_id: string | null;
  badge_strategy:
    | 'rrf_plus_parallel_knn'
    | 'single_knn'
    | 'hybrid_app_rrf';
  took_ms: number;
  filter_meta?: {
    eligible_assets: number;
    enumeration_ms: number;
    filters_applied: boolean;
  };
  text_channel_status?: 'ok' | 'empty' | 'failed' | 'disabled';
  ranking_strategy?: string;
  branch?: Record<string, unknown>;
  parse?: Record<string, unknown> | null;
  boost_effects?: {
    applied: import('./hybrid-fusion').ExtractedFacetBoosts;
    rejected: Array<{ field: string; value: string; reason: string }>;
  };
  query_dsl?: HybridQueryDslExplain | null;
}

export interface ImageSearchResult {
  hits: SearchHit[];
  rank_window_size: number;
  size: number;
  modality: 'visual';
  sort_by: 'visual';
  variant_id: string;
  video_id: string | null;
  badge_strategy: 'single_knn';
  took_ms: number;
  image_bytes: number;
  filter_meta?: SearchResult['filter_meta'];
}

/**
 * Pluggable search execution (file + live).
 * File routes keep defaults; live forces query_vector + custom filters/mapper.
 */
export interface ExecuteChunkSearchParams {
  index: string;
  modality: SearchModality;
  sortBy?: SearchSortBy;
  size?: number;
  filters: Record<string, unknown>[];
  sourceFields: readonly string[];
  /** When set, skip text embedding / query_vector_builder. */
  queryVectorMode: QueryVectorMode;
  /** Map ES hit → API hit. Defaults to file mapHit. */
  mapHitFn?: HitMapper;
  /**
   * Collapse duplicate logical ids (live chunk_id) before rank attribution.
   * Fetches a wider window then collapses each branch.
   */
  collapseByChunkId?: boolean;
}

export interface ExecuteChunkSearchResult {
  hits: SearchHit[];
  rank_window_size: number;
  size: number;
  modality: SearchModality;
  sort_by: SearchSortBy;
  badge_strategy: 'rrf_plus_parallel_knn' | 'single_knn';
  took_ms: number;
}

function buildFileFilters(
  variantId: string,
  videoId?: string | null,
  eligibleVideoIds?: string[] | null,
): Record<string, unknown>[] {
  return buildChunkFilters({ variantId, videoId, eligibleVideoIds });
}

/**
 * Resolve ready-ID allow-list when facets (or hybrid) require it.
 * Returns null when the legacy unfiltered path should be kept.
 * Returns [] when eligibility is empty (caller must short-circuit).
 */
async function resolveEligibleIds(params: {
  variantId: string;
  videoId?: string | null;
  filters?: NormalizedSearchFilters | null;
  requireReadyAllowList?: boolean;
}): Promise<{
  ids: string[] | null;
  enumeration_ms: number;
  filters_applied: boolean;
} | null> {
  const needAllowList =
    Boolean(params.requireReadyAllowList) || hasActiveFilters(params.filters);
  if (!needAllowList) {
    return null;
  }
  const enumerated = await enumerateEligibleAssetIds({
    variantId: params.variantId,
    filters: params.filters ?? null,
    videoId: params.videoId,
  });
  return {
    ids: enumerated.videoIds,
    enumeration_ms: enumerated.took_ms,
    filters_applied: true,
  };
}

export async function resolveQueryVectorMode(
  cfg: AppConfig,
  query: string,
): Promise<QueryVectorMode> {
  if (cfg.EMBED_PROVIDER === 'eis') {
    return {
      kind: 'builder',
      inferenceId: cfg.EMBED_INFERENCE_ID,
      input: query,
    };
  }
  const provider = createEmbeddingProvider(cfg);
  const result = await provider.embedText(query, 'query');
  return { kind: 'vector', vector: result.embedding };
}

/** Force app-side text embedding (live path — one inference for all knn branches). */
export async function embedTextQueryVector(
  cfg: AppConfig,
  query: string,
): Promise<number[]> {
  const provider = createEmbeddingProvider(cfg);
  const result = await provider.embedText(query, 'query');
  return result.embedding;
}

function maybeCollapse(hits: EsSearchHit[], enabled: boolean): EsSearchHit[] {
  return enabled ? collapseEsHitsById(hits) : hits;
}

/**
 * Index-agnostic modality search used by file and live callers.
 */
export async function executeChunkSearch(
  params: ExecuteChunkSearchParams,
  cfg?: AppConfig,
): Promise<ExecuteChunkSearchResult> {
  const config = cfg ?? getConfig();
  const client = getEsClient();
  const size = clampSearchSize(params.size);
  const rankWindow = effectiveRankWindowSize(config, size);
  const filters = params.filters;
  const index = params.index;
  const mode = params.queryVectorMode;
  const sortBy: SearchSortBy =
    params.sortBy ?? (params.modality === 'both' ? 'rrf' : params.modality);
  const mapFn = params.mapHitFn ?? mapFileHit;
  const sourceFields = [...params.sourceFields];
  const collapse = Boolean(params.collapseByChunkId);
  // Wider fetch for collapse-by-id; RRF requires rank_window_size >= size.
  const fetchSize = collapse ? Math.min(rankWindow * 2, 200) : rankWindow;
  const rrfRankWindow = Math.max(rankWindow, fetchSize);
  const t0 = performance.now();

  const assemble = (
    primary: EsSearchHit[],
    visual: IdMaps,
    audio: IdMaps,
    rrfScores: Map<string, number>,
    sources: Map<string, Record<string, unknown>>,
    modality: SearchModality,
  ): SearchHit[] =>
    assembleHits(
      primary,
      size,
      visual,
      audio,
      rrfScores,
      sources,
      modality,
      mapFn,
    );

  if (params.modality !== 'both') {
    const field =
      params.modality === 'visual' ? 'embedding_video' : 'embedding_audio';
    const resp = await client.search({
      index,
      size: collapse ? fetchSize : size,
      _source: sourceFields,
      retriever: {
        knn: knnRetrieverBody(field, rankWindow, filters, mode),
      },
    } as Parameters<typeof client.search>[0]);
    const knnHits = maybeCollapse(
      toEsHits(resp.hits?.hits ?? []),
      collapse,
    );
    const knnMaps = idMaps(knnHits);
    const visual = params.modality === 'visual' ? knnMaps : emptyIdMaps();
    const audio = params.modality === 'audio' ? knnMaps : emptyIdMaps();
    const hits = assemble(
      knnHits,
      visual,
      audio,
      new Map(),
      knnMaps.source,
      params.modality,
    );
    return {
      hits,
      rank_window_size: rankWindow,
      size,
      modality: params.modality,
      sort_by: sortBy,
      badge_strategy: 'single_knn',
      took_ms: Math.round(performance.now() - t0),
    };
  }

  const rrfBody = {
    index,
    size: fetchSize,
    _source: sourceFields,
    retriever: {
      rrf: {
        retrievers: [
          weightedKnnChild(
            'embedding_video',
            rrfRankWindow,
            filters,
            mode,
            config.SEARCH_WEIGHT_VIDEO,
          ),
          weightedKnnChild(
            'embedding_audio',
            rrfRankWindow,
            filters,
            mode,
            config.SEARCH_WEIGHT_AUDIO,
          ),
        ],
        rank_constant: config.SEARCH_RANK_CONSTANT,
        rank_window_size: rrfRankWindow,
      },
    },
  };

  const attrBody = (field: 'embedding_video' | 'embedding_audio') => ({
    index,
    size: fetchSize,
    _source: sourceFields,
    retriever: {
      knn: knnRetrieverBody(field, rrfRankWindow, filters, mode),
    },
  });

  const [rrfResp, visualResp, audioResp] = await Promise.all([
    client.search(rrfBody as Parameters<typeof client.search>[0]),
    client.search(
      attrBody('embedding_video') as Parameters<typeof client.search>[0],
    ),
    client.search(
      attrBody('embedding_audio') as Parameters<typeof client.search>[0],
    ),
  ]);

  const rrfHits = maybeCollapse(toEsHits(rrfResp.hits?.hits ?? []), collapse);
  const visualHits = maybeCollapse(
    toEsHits(visualResp.hits?.hits ?? []),
    collapse,
  );
  const audioHits = maybeCollapse(
    toEsHits(audioResp.hits?.hits ?? []),
    collapse,
  );
  const rrfMapped = idMaps(rrfHits);
  const visual = idMaps(visualHits);
  const audio = idMaps(audioHits);
  const sources = mergeSources(rrfMapped.source, visual.source, audio.source);
  const primary = pickPrimaryHits(sortBy, rrfHits, visualHits, audioHits);
  const ordered =
    sortBy === 'rrf'
      ? primary
      : primary.slice().sort((a, b) =>
          compareOptionalScoresDesc(
            typeof a._score === 'number' ? a._score : null,
            typeof b._score === 'number' ? b._score : null,
            0,
            0,
          ),
        );
  const hits = assemble(ordered, visual, audio, rrfMapped.score, sources, 'both');

  return {
    hits,
    rank_window_size: rrfRankWindow,
    size,
    modality: 'both',
    sort_by: sortBy,
    badge_strategy: 'rrf_plus_parallel_knn',
    took_ms: Math.round(performance.now() - t0),
  };
}

export async function searchChunks(
  params: SearchParams,
  cfg?: AppConfig,
): Promise<SearchResult> {
  const config = cfg ?? getConfig();
  const useHybrid = Boolean(params.hybrid?.use_text);

  if (useHybrid) {
    if (params.sortBy && params.sortBy !== 'hybrid') {
      throw new Error(
        'sort_by must be hybrid (or omitted) when hybrid.use_text=true',
      );
    }
    const { searchChunksHybrid } = await import('./hybrid-search');
    const hybrid = await searchChunksHybrid(
      {
        query: params.query,
        modality: params.modality,
        variantId: params.variantId,
        videoId: params.videoId,
        size: params.size,
        filters: params.filters,
        vectorQuery: params.vectorQuery,
        bm25Query: params.bm25Query,
        sceneTermsPresent: params.sceneTermsPresent,
        extractedBoosts: params.extractedBoosts,
        queryVector: params.queryVector,
        speculativeEmbed: params.speculativeEmbed,
        priorEmbedCalls: params.priorEmbedCalls,
      },
      config,
    );
    return {
      hits: hybrid.hits,
      rank_window_size: hybrid.rank_window_size,
      size: hybrid.size,
      modality: hybrid.modality,
      sort_by: 'hybrid',
      variant_id: hybrid.variant_id,
      video_id: hybrid.video_id,
      badge_strategy: hybrid.badge_strategy,
      took_ms: hybrid.took_ms,
      filter_meta: hybrid.filter_meta,
      text_channel_status: hybrid.text_channel_status,
      ranking_strategy: hybrid.ranking_strategy,
      branch: hybrid.branch as Record<string, unknown> | undefined,
      boost_effects: hybrid.boost_effects,
      query_dsl: hybrid.query_dsl,
    };
  }

  if (params.sortBy === 'hybrid') {
    throw new Error('sort_by=hybrid requires hybrid.use_text=true');
  }

  const eligibility = await resolveEligibleIds({
    variantId: params.variantId,
    videoId: params.videoId,
    filters: params.filters,
    requireReadyAllowList: params.requireReadyAllowList,
  });

  if (eligibility && eligibility.ids !== null && eligibility.ids.length === 0) {
    return {
      hits: [],
      rank_window_size: effectiveRankWindowSize(
        config,
        clampSearchSize(params.size),
      ),
      size: clampSearchSize(params.size),
      modality: params.modality,
      sort_by:
        params.sortBy ??
        (params.modality === 'both' ? 'rrf' : params.modality),
      variant_id: params.variantId,
      video_id: params.videoId ?? null,
      badge_strategy:
        params.modality === 'both' ? 'rrf_plus_parallel_knn' : 'single_knn',
      took_ms: eligibility.enumeration_ms,
      filter_meta: {
        eligible_assets: 0,
        enumeration_ms: eligibility.enumeration_ms,
        filters_applied: true,
      },
    };
  }

  const mode = await resolveQueryVectorMode(config, params.query);
  const result = await executeChunkSearch(
    {
      index: config.ES_INDEX_CHUNKS,
      modality: params.modality,
      sortBy: params.sortBy,
      size: params.size,
      filters: buildFileFilters(
        params.variantId,
        params.videoId,
        eligibility?.ids ?? null,
      ),
      sourceFields: FILE_SOURCE_FIELDS,
      queryVectorMode: mode,
    },
    config,
  );
  return {
    ...result,
    variant_id: params.variantId,
    video_id: params.videoId ?? null,
    took_ms: result.took_ms + (eligibility?.enumeration_ms ?? 0),
    filter_meta: eligibility
      ? {
          eligible_assets: eligibility.ids?.length ?? 0,
          enumeration_ms: eligibility.enumeration_ms,
          filters_applied: eligibility.filters_applied,
        }
      : undefined,
  };
}

export async function searchChunksByImage(
  params: ImageSearchParams,
  cfg?: AppConfig,
): Promise<ImageSearchResult> {
  const config = cfg ?? getConfig();
  const eligibility = await resolveEligibleIds({
    variantId: params.variantId,
    videoId: params.videoId,
    filters: params.filters,
  });

  if (eligibility && eligibility.ids !== null && eligibility.ids.length === 0) {
    return {
      hits: [],
      rank_window_size: effectiveRankWindowSize(
        config,
        clampSearchSize(params.size),
      ),
      size: clampSearchSize(params.size),
      modality: 'visual',
      sort_by: 'visual',
      variant_id: params.variantId,
      video_id: params.videoId ?? null,
      badge_strategy: 'single_knn',
      took_ms: eligibility.enumeration_ms,
      image_bytes: params.image.length,
      filter_meta: {
        eligible_assets: 0,
        enumeration_ms: eligibility.enumeration_ms,
        filters_applied: true,
      },
    };
  }

  const provider = createEmbeddingProvider(config);
  const embedded = await provider.embedImage(params.image, 'query');
  const mode: QueryVectorMode = {
    kind: 'vector',
    vector: embedded.embedding,
  };
  const result = await executeChunkSearch(
    {
      index: config.ES_INDEX_CHUNKS,
      modality: 'visual',
      sortBy: 'visual',
      size: params.size,
      filters: buildFileFilters(
        params.variantId,
        params.videoId,
        eligibility?.ids ?? null,
      ),
      sourceFields: FILE_SOURCE_FIELDS,
      queryVectorMode: mode,
    },
    config,
  );
  return {
    hits: result.hits,
    rank_window_size: result.rank_window_size,
    size: result.size,
    modality: 'visual',
    sort_by: 'visual',
    variant_id: params.variantId,
    video_id: params.videoId ?? null,
    badge_strategy: 'single_knn',
    took_ms: result.took_ms + (eligibility?.enumeration_ms ?? 0),
    image_bytes: params.image.length,
    filter_meta: eligibility
      ? {
          eligible_assets: eligibility.ids?.length ?? 0,
          enumeration_ms: eligibility.enumeration_ms,
          filters_applied: eligibility.filters_applied,
        }
      : undefined,
  };
}
