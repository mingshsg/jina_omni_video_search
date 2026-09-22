import type { AppConfig } from '../config';
import { getConfig } from '../config';
import { createEmbeddingProvider } from '../embed/provider';
import { getEsClient } from './client';
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
}

export interface ImageSearchParams {
  image: Buffer;
  variantId: string;
  videoId?: string | null;
  size?: number;
}

export interface SearchResult {
  hits: SearchHit[];
  rank_window_size: number;
  size: number;
  modality: SearchModality;
  sort_by: SearchSortBy;
  variant_id: string;
  video_id: string | null;
  badge_strategy: 'rrf_plus_parallel_knn' | 'single_knn';
  took_ms: number;
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
): Record<string, unknown>[] {
  const filters: Record<string, unknown>[] = [
    { term: { variant_id: variantId } },
  ];
  if (videoId) {
    filters.push({ term: { video_id: videoId } });
  }
  return filters;
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
  const mode = await resolveQueryVectorMode(config, params.query);
  const result = await executeChunkSearch(
    {
      index: config.ES_INDEX_CHUNKS,
      modality: params.modality,
      sortBy: params.sortBy,
      size: params.size,
      filters: buildFileFilters(params.variantId, params.videoId),
      sourceFields: FILE_SOURCE_FIELDS,
      queryVectorMode: mode,
    },
    config,
  );
  return {
    ...result,
    variant_id: params.variantId,
    video_id: params.videoId ?? null,
  };
}

export async function searchChunksByImage(
  params: ImageSearchParams,
  cfg?: AppConfig,
): Promise<ImageSearchResult> {
  const config = cfg ?? getConfig();
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
      filters: buildFileFilters(params.variantId, params.videoId),
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
    took_ms: result.took_ms,
    image_bytes: params.image.length,
  };
}
