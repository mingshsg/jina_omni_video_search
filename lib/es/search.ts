import type { AppConfig } from '../config';
import { getConfig } from '../config';
import { createEmbeddingProvider } from '../embed/provider';
import { getEsClient } from './client';

export type SearchModality = 'visual' | 'audio' | 'both';
export type ModalityBadge = 'visual' | 'audio' | 'both';
/** Hit ordering. `rrf` is fused rank; `visual` / `audio` use knn similarity. */
export type SearchSortBy = 'rrf' | 'visual' | 'audio';

export interface SearchParams {
  query: string;
  modality: SearchModality;
  variantId: string;
  videoId?: string | null;
  size?: number;
  sortBy?: SearchSortBy;
}

export interface SearchHit {
  chunk_id: string;
  video_id: string;
  variant_id: string;
  title: string;
  start_ms: number;
  end_ms: number;
  start_label: string;
  end_label: string;
  /**
   * Ranking score for the primary list: RRF fused score when modality=both,
   * otherwise the single-branch knn `_score`. Always a number for compatibility.
   */
  score: number;
  /** Visual knn `_score` (cosine-related similarity). Null if not in that window / N/A. */
  score_visual: number | null;
  /** Audio knn `_score` (cosine-related similarity). Null if not in that window / N/A. */
  score_audio: number | null;
  /** 1-based rank within the visual knn window, or null. */
  rank_visual: number | null;
  /** 1-based rank within the audio knn window, or null. */
  rank_audio: number | null;
  modality_badge: ModalityBadge;
  thumb_url: string;
}

export interface SearchResult {
  hits: SearchHit[];
  /** Effective RRF / knn window used (always >= size). */
  rank_window_size: number;
  size: number;
  modality: SearchModality;
  sort_by: SearchSortBy;
  variant_id: string;
  video_id: string | null;
  /** How modality badges were recovered (documented in api-contract). */
  badge_strategy: 'rrf_plus_parallel_knn' | 'single_knn';
  took_ms: number;
}

const SOURCE_FIELDS = [
  'video_id',
  'variant_id',
  'chunk_index',
  'start_ms',
  'end_ms',
  'start_label',
  'end_label',
  'video_title',
  'thumb_path',
] as const;

const MAX_SIZE = 100;
const DEFAULT_SIZE = 20;

/** Clamp requested top-k to a safe server range. */
export function clampSearchSize(size: number | undefined): number {
  const n = size === undefined ? DEFAULT_SIZE : Math.trunc(size);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, MAX_SIZE);
}

/**
 * Effective RRF / knn window: config SEARCH_RANK_WINDOW_SIZE, raised to >= size.
 * Elasticsearch requires rank_window_size >= size; default 10 is too small.
 */
export function effectiveRankWindowSize(cfg: AppConfig, size: number): number {
  return Math.max(cfg.SEARCH_RANK_WINDOW_SIZE, size);
}

function buildFilters(
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

type QueryVectorMode =
  | { kind: 'builder'; inferenceId: string; input: string }
  | { kind: 'vector'; vector: number[] };

async function resolveQueryVectorMode(
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

function applyQueryVector(
  knn: Record<string, unknown>,
  mode: QueryVectorMode,
): void {
  if (mode.kind === 'builder') {
    knn.query_vector_builder = {
      embedding: {
        inference_id: mode.inferenceId,
        input: mode.input,
      },
    };
  } else {
    knn.query_vector = mode.vector;
  }
}

function knnRetrieverBody(
  field: 'embedding_video' | 'embedding_audio',
  k: number,
  filters: Record<string, unknown>[],
  mode: QueryVectorMode,
): Record<string, unknown> {
  const knn: Record<string, unknown> = {
    field,
    k,
    num_candidates: Math.min(Math.max(k * 2, 50), 10_000),
    filter: { bool: { filter: filters } },
  };
  applyQueryVector(knn, mode);
  return knn;
}

function weightedKnnChild(
  field: 'embedding_video' | 'embedding_audio',
  k: number,
  filters: Record<string, unknown>[],
  mode: QueryVectorMode,
  weight: number,
): Record<string, unknown> {
  return {
    retriever: {
      knn: knnRetrieverBody(field, k, filters, mode),
    },
    weight,
  };
}

function thumbUrl(
  videoId: string,
  variantId: string,
  chunkIndex: number,
): string {
  return `/api/thumb/${encodeURIComponent(videoId)}/${encodeURIComponent(variantId)}/${chunkIndex}`;
}

type EsSearchHit = {
  _id?: string;
  _score?: number | null;
  _source?: Record<string, unknown>;
};

function numericScore(value: number | undefined | null): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function mapHit(
  id: string,
  score: number | undefined | null,
  src: Record<string, unknown> | undefined,
  badge: ModalityBadge,
  scoreVisual: number | null,
  scoreAudio: number | null,
  rankVisual: number | null,
  rankAudio: number | null,
): SearchHit {
  const videoId = String(src?.video_id ?? '');
  const variantId = String(src?.variant_id ?? '');
  const chunkIndex = Number(src?.chunk_index ?? 0);
  return {
    chunk_id: id,
    video_id: videoId,
    variant_id: variantId,
    title: String(src?.video_title ?? ''),
    start_ms: Number(src?.start_ms ?? 0),
    end_ms: Number(src?.end_ms ?? 0),
    start_label: String(src?.start_label ?? ''),
    end_label: String(src?.end_label ?? ''),
    score: typeof score === 'number' ? score : 0,
    score_visual: scoreVisual,
    score_audio: scoreAudio,
    rank_visual: rankVisual,
    rank_audio: rankAudio,
    modality_badge: badge,
    thumb_url: thumbUrl(videoId, variantId, chunkIndex),
  };
}

/** Derive badge from membership in per-modality knn windows (FR-21). */
export function badgeFromRanks(
  visualRank: number | undefined,
  audioRank: number | undefined,
): ModalityBadge {
  const v = visualRank !== undefined;
  const a = audioRank !== undefined;
  if (v && a) return 'both';
  if (v) return 'visual';
  if (a) return 'audio';
  // Defensive: RRF hits always come from a child window; should not happen.
  return 'visual';
}

type IdMaps = {
  rank: Map<string, number>;
  score: Map<string, number>;
  source: Map<string, Record<string, unknown>>;
};

function idMaps(hits: EsSearchHit[]): IdMaps {
  const rank = new Map<string, number>();
  const score = new Map<string, number>();
  const source = new Map<string, Record<string, unknown>>();
  hits.forEach((h, i) => {
    if (!h._id) return;
    rank.set(h._id, i + 1);
    const s = numericScore(h._score);
    if (s !== null) score.set(h._id, s);
    if (h._source) source.set(h._id, h._source);
  });
  return { rank, score, source };
}

function mergeSources(
  ...maps: Array<Map<string, Record<string, unknown>>>
): Map<string, Record<string, unknown>> {
  const out = new Map<string, Record<string, unknown>>();
  for (const map of maps) {
    for (const [id, src] of map) {
      if (!out.has(id)) out.set(id, src);
    }
  }
  return out;
}

/**
 * Descending compare for optional knn scores; missing values sort last.
 * Ties break on `fallback` (typically RRF `score`) descending.
 */
export function compareOptionalScoresDesc(
  a: number | null,
  b: number | null,
  fallbackA: number,
  fallbackB: number,
): number {
  if (a === null && b === null) return fallbackB - fallbackA;
  if (a === null) return 1;
  if (b === null) return -1;
  if (b !== a) return b - a;
  return fallbackB - fallbackA;
}

function pickPrimaryHits(
  sortBy: SearchSortBy,
  rrfHits: EsSearchHit[],
  visualHits: EsSearchHit[],
  audioHits: EsSearchHit[],
): EsSearchHit[] {
  switch (sortBy) {
    case 'rrf':
      return rrfHits;
    case 'visual':
      return visualHits;
    case 'audio':
      return audioHits;
    default: {
      const _exhaustive: never = sortBy;
      return _exhaustive;
    }
  }
}

function assembleHits(
  primary: EsSearchHit[],
  size: number,
  visual: IdMaps,
  audio: IdMaps,
  rrfScores: Map<string, number>,
  sources: Map<string, Record<string, unknown>>,
  modality: SearchModality,
): SearchHit[] {
  return primary.slice(0, size).map((h) => {
    const id = String(h._id ?? '');
    const src =
      (h._source as Record<string, unknown> | undefined) ?? sources.get(id);
    const visualRank = visual.rank.get(id);
    const audioRank = audio.rank.get(id);
    const scoreVisual = visual.score.get(id) ?? null;
    const scoreAudio = audio.score.get(id) ?? null;
    let badge: ModalityBadge;
    let score: number;
    switch (modality) {
      case 'both':
        badge = badgeFromRanks(visualRank, audioRank);
        // Never fall back to knn `_score` here — that would mix similarity
        // into the RRF field when sort_by is visual/audio.
        score = rrfScores.get(id) ?? 0;
        break;
      case 'visual':
        badge = 'visual';
        score = scoreVisual ?? numericScore(h._score) ?? 0;
        break;
      case 'audio':
        badge = 'audio';
        score = scoreAudio ?? numericScore(h._score) ?? 0;
        break;
      default: {
        const _exhaustive: never = modality;
        return _exhaustive;
      }
    }
    return mapHit(
      id,
      score,
      src,
      badge,
      scoreVisual,
      scoreAudio,
      visualRank ?? null,
      audioRank ?? null,
    );
  });
}

function emptyIdMaps(): IdMaps {
  return {
    rank: new Map(),
    score: new Map(),
    source: new Map(),
  };
}

function toEsHits(
  hits: Array<{
    _id?: string;
    _score?: number | null;
    _source?: unknown;
  }>,
): EsSearchHit[] {
  return hits.map((h) => ({
    _id: h._id,
    _score: h._score,
    _source: h._source as Record<string, unknown> | undefined,
  }));
}

/**
 * Dual-modality (or single) retrieval with ES RRF over knn children.
 *
 * Badge recovery (FR-21): when modality=both, run Elasticsearch RRF for fused
 * ranking, then a parallel pair of knn searches (same window / filters) to
 * recover which child windows contain each returned `_id`. Dual hit → `both`.
 *
 * `score` is the RRF fused score when modality=both (0 if the hit was not in
 * the RRF window — e.g. sort_by=visual/audio). `score_visual` / `score_audio`
 * are knn similarity scores from the parallel branches (null if absent / N/A).
 * sort_by=visual|audio uses that branch's knn hit list as the primary ranking.
 */
export async function searchChunks(
  params: SearchParams,
  cfg?: AppConfig,
): Promise<SearchResult> {
  const config = cfg ?? getConfig();
  const client = getEsClient();
  const size = clampSearchSize(params.size);
  const rankWindow = effectiveRankWindowSize(config, size);
  const filters = buildFilters(params.variantId, params.videoId);
  const index = config.ES_INDEX_CHUNKS;
  const mode = await resolveQueryVectorMode(config, params.query);
  const sortBy: SearchSortBy = params.sortBy ?? 'rrf';
  const t0 = performance.now();

  if (params.modality !== 'both') {
    const field =
      params.modality === 'visual' ? 'embedding_video' : 'embedding_audio';
    const resp = await client.search({
      index,
      size,
      _source: [...SOURCE_FIELDS],
      retriever: {
        knn: knnRetrieverBody(field, rankWindow, filters, mode),
      },
    } as Parameters<typeof client.search>[0]);
    const knnHits = toEsHits(resp.hits?.hits ?? []);
    const knnMaps = idMaps(knnHits);
    const visual = params.modality === 'visual' ? knnMaps : emptyIdMaps();
    const audio = params.modality === 'audio' ? knnMaps : emptyIdMaps();
    const hits = assembleHits(
      knnHits,
      size,
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
      variant_id: params.variantId,
      video_id: params.videoId ?? null,
      badge_strategy: 'single_knn',
      took_ms: Math.round(performance.now() - t0),
    };
  }

  // --- modality=both: RRF ranking + parallel knn attribution / scores ---
  // Fetch rankWindow from all three so visual/audio sort can use knn order
  // while still attaching RRF scores when the hit is in the fused window.
  const rrfBody = {
    index,
    size: rankWindow,
    _source: [...SOURCE_FIELDS],
    retriever: {
      rrf: {
        retrievers: [
          weightedKnnChild(
            'embedding_video',
            rankWindow,
            filters,
            mode,
            config.SEARCH_WEIGHT_VIDEO,
          ),
          weightedKnnChild(
            'embedding_audio',
            rankWindow,
            filters,
            mode,
            config.SEARCH_WEIGHT_AUDIO,
          ),
        ],
        rank_constant: config.SEARCH_RANK_CONSTANT,
        rank_window_size: rankWindow,
      },
    },
  };

  const attrBody = (field: 'embedding_video' | 'embedding_audio') => ({
    index,
    size: rankWindow,
    _source: [...SOURCE_FIELDS],
    retriever: {
      knn: knnRetrieverBody(field, rankWindow, filters, mode),
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

  const rrfHits = toEsHits(rrfResp.hits?.hits ?? []);
  const visualHits = toEsHits(visualResp.hits?.hits ?? []);
  const audioHits = toEsHits(audioResp.hits?.hits ?? []);
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
            numericScore(a._score),
            numericScore(b._score),
            0,
            0,
          ),
        );
  const hits = assembleHits(
    ordered,
    size,
    visual,
    audio,
    rrfMapped.score,
    sources,
    'both',
  );

  return {
    hits,
    rank_window_size: rankWindow,
    size,
    modality: 'both',
    sort_by: sortBy,
    variant_id: params.variantId,
    video_id: params.videoId ?? null,
    badge_strategy: 'rrf_plus_parallel_knn',
    took_ms: Math.round(performance.now() - t0),
  };
}
