/**
 * Hybrid text + vector retrieval (Phase 3).
 * Opt-in via hybrid.use_text; default path stays pure vector.
 */
import type { AppConfig } from '../config';
import { getConfig } from '../config';
import { createEmbeddingProvider } from '../embed/provider';
import {
  actorKeysForQuery,
  findContainedAliases,
} from '../metadata/people';
import type { NormalizedSearchFilters } from '../metadata/search-filters';
import {
  buildChunkFilters,
  enumerateEligibleAssetIds,
} from '../metadata/search-filters';
import { getEsClient } from './client';
import {
  deriveExtractedBoostEffects,
  fuseHybridCandidates,
  guaranteedFloorCount,
  hybridBranchWindow,
  selectLexicalAssets,
  HYBRID_SCENELESS_VECTOR_SCALE,
  type AssetFacetSnapshot,
  type ExtractedFacetBoosts,
  type FusionCandidate,
  type LexicalAssetHit,
} from './hybrid-fusion';
import {
  clampSearchSize,
  FILE_SOURCE_FIELDS,
  knnRetrieverBody,
  mapFileHit,
  type QueryVectorMode,
  type SearchHit,
  type SearchModality,
} from './search-core';

async function embedQueryVector(
  cfg: AppConfig,
  query: string,
): Promise<{ vector: number[]; took_ms: number }> {
  const t0 = performance.now();
  const provider = createEmbeddingProvider(cfg);
  const result = await provider.embedText(query, 'query');
  return {
    vector: result.embedding,
    took_ms: Math.round(performance.now() - t0),
  };
}

export interface HybridSearchParams {
  query: string;
  modality: SearchModality;
  variantId: string;
  videoId?: string | null;
  size?: number;
  filters?: NormalizedSearchFilters | null;
  /** Override text used for app-side query embedding (parsed residual). */
  vectorQuery?: string;
  /** Override text used for BM25 (parsed free_text). */
  bm25Query?: string;
  /** When false, down-weight vector channels (name-/facet-only parse). */
  sceneTermsPresent?: boolean;
  /** Extracted facets still applied as boosts (hard filters excluded). */
  extractedBoosts?: ExtractedFacetBoosts | null;
  /** Precomputed query embedding (speculative parallel embed). */
  queryVector?: number[];
  /**
   * Speculative embed started in parallel with parse. Awaited only after
   * eligibility is known and residual matches the full query.
   */
  speculativeEmbed?: Promise<{ vector: number[]; took_ms: number } | null>;
  /** Embed calls already issued before hybrid (e.g. speculative launch). */
  priorEmbedCalls?: number;
}

export interface HybridBranchMeta {
  global_visual: number;
  global_audio: number;
  lexical_assets: number;
  lexical_chunks: number;
  semantic_assets: number;
  embed_ms: number;
  embed_calls: number;
  bm25_ms: number;
  knn_global_ms: number;
  knn_lexical_ms: number;
  knn_semantic_ms: number;
  fusion_ms: number;
  /** Successful ES HTTP round-trips (msearch counts as 1). */
  es_http_requests: number;
  /** Individual ES search bodies attempted (msearch entries counted separately). */
  es_subsearches: number;
  /** Includes failed attempts. */
  es_attempts: number;
}

/** Safe ES-style explain for hybrid channels (truncated allow-lists; no vectors/secrets). */
export type HybridQueryDslExplain = {
  status: 'applied' | 'not_applied' | 'empty_eligible';
  reason?: string;
  bm25_query?: string;
  vector_query?: string;
  extracted_boosts?: ExtractedFacetBoosts | null;
  asset_bm25?: {
    index: string;
    size: number;
    query: Record<string, unknown>;
  };
  knn_global?: {
    index: string;
    fields: Array<'embedding_video' | 'embedding_audio'>;
    k: number;
    num_candidates: number;
    filter: Record<string, unknown>;
    /** Always omitted — never echo embedding values. */
    query_vector: 'omitted';
  };
};

export interface HybridSearchResult {
  hits: SearchHit[];
  rank_window_size: number;
  size: number;
  modality: SearchModality;
  sort_by: 'hybrid';
  variant_id: string;
  video_id: string | null;
  badge_strategy: 'hybrid_app_rrf';
  took_ms: number;
  text_channel_status: 'ok' | 'empty' | 'failed';
  ranking_strategy: 'hybrid_rrf';
  filter_meta?: {
    eligible_assets: number;
    enumeration_ms: number;
    filters_applied: boolean;
  };
  branch?: HybridBranchMeta;
  /** Scoring effects of extracted boosts (only when boosts were requested). */
  boost_effects?: {
    applied: ExtractedFacetBoosts;
    rejected: Array<{ field: string; value: string; reason: string }>;
  };
  /** Truncated asset BM25 + knn filter DSL for UI/API inspection. */
  query_dsl?: HybridQueryDslExplain;
}

/** Max video_id / _id values echoed in explain DSL (rest → count only). */
export const QUERY_DSL_ID_SAMPLE = 8;

export function truncateIdList(
  ids: string[],
  max: number = QUERY_DSL_ID_SAMPLE,
): { count: number; sample: string[]; truncated: boolean } {
  const list = ids.map(String);
  return {
    count: list.length,
    sample: list.slice(0, Math.max(0, max)),
    truncated: list.length > max,
  };
}

/**
 * Safe explain payload for asset BM25 + knn filter (no query vectors, no secrets).
 * Large allow-lists are truncated to `QUERY_DSL_ID_SAMPLE` with a count.
 */
export function buildHybridQueryDslExplain(params: {
  assetsIndex: string;
  chunksIndex: string;
  bm25Query: string;
  vectorQuery: string;
  bm25Size: number;
  eligibleIds: string[];
  variantId: string;
  videoId?: string | null;
  modality: SearchModality;
  knnK: number;
  extractedBoosts?: ExtractedFacetBoosts | null;
}): HybridQueryDslExplain {
  const eligible = truncateIdList(params.eligibleIds);
  const knnFields: Array<'embedding_video' | 'embedding_audio'> = [];
  if (params.modality !== 'audio') knnFields.push('embedding_video');
  if (params.modality !== 'visual') knnFields.push('embedding_audio');

  const filterClauses: Record<string, unknown>[] = [
    { term: { variant_id: params.variantId } },
  ];
  if (params.videoId) {
    filterClauses.push({ term: { video_id: params.videoId } });
  }
  if (params.eligibleIds.length > 0) {
    filterClauses.push({
      terms: {
        video_id: {
          count: eligible.count,
          sample: eligible.sample,
          truncated: eligible.truncated,
        },
      },
    });
  }

  const knnK = params.knnK;
  const numCandidates = Math.min(Math.max(knnK * 2, 50), 10_000);

  return {
    status: 'applied',
    bm25_query: params.bm25Query,
    vector_query: params.vectorQuery,
    extracted_boosts: params.extractedBoosts ?? null,
    asset_bm25: {
      index: params.assetsIndex,
      size: params.bm25Size,
      query: {
        bool: {
          filter: [
            {
              ids: {
                values_count: eligible.count,
                values_sample: eligible.sample,
                truncated: eligible.truncated,
              },
            },
          ],
          should: buildBm25Should(params.bm25Query),
          minimum_should_match: 1,
        },
      },
    },
    knn_global: {
      index: params.chunksIndex,
      fields: knnFields,
      k: knnK,
      num_candidates: numCandidates,
      filter: { bool: { filter: filterClauses } },
      query_vector: 'omitted',
    },
  };
}

/** Exported for unit tests — structured BM25 should clauses. */
export function buildBm25Should(query: string): Record<string, unknown>[] {
  const keys = actorKeysForQuery(query);
  const contained = findContainedAliases(query);
  const should: Record<string, unknown>[] = [];

  if (keys.length > 0) {
    should.push({
      terms: {
        'meta.actor_keys': keys,
        boost: 8,
      },
    });
  }

  // Phrase match on each contained catalog alias (name+scene queries).
  for (const match of contained) {
    should.push({
      match_phrase: {
        'meta.search_text': { query: match.alias, boost: 4 },
      },
    });
    should.push({
      match_phrase: {
        'meta.search_text.cjk': { query: match.alias, boost: 4 },
      },
    });
  }

  // Whole-query phrase (exact name-only queries) + loose field matches.
  should.push(
    {
      match_phrase: {
        'meta.search_text': { query, boost: 3 },
      },
    },
    {
      match_phrase: {
        'meta.search_text.cjk': { query, boost: 3 },
      },
    },
    {
      match: {
        title: { query, boost: 2 },
      },
    },
    {
      match: {
        'meta.work_title.en': { query, boost: 2 },
      },
    },
    {
      match: {
        'meta.work_title.zh': { query, boost: 2 },
      },
    },
    {
      match: {
        'meta.work_title.native.name': { query, boost: 2 },
      },
    },
    {
      match: {
        'meta.description': { query, boost: 1 },
      },
    },
    {
      match: {
        'meta.abstract': { query, boost: 1 },
      },
    },
  );

  return should;
}

async function searchLexicalAssets(params: {
  query: string;
  eligibleIds: string[];
  size: number;
}): Promise<{
  assets: LexicalAssetHit[];
  took_ms: number;
}> {
  const client = getEsClient();
  const cfg = getConfig();
  const t0 = performance.now();
  if (params.eligibleIds.length === 0 || params.size === 0) {
    return { assets: [], took_ms: 0 };
  }

  const res = await client.search({
    index: cfg.ES_INDEX_ASSETS,
    size: params.size,
    _source: ['video_id', 'title'],
    query: {
      bool: {
        filter: [{ ids: { values: params.eligibleIds } }],
        should: buildBm25Should(params.query),
        minimum_should_match: 1,
      },
    },
  });

  const ranked = res.hits.hits
    .map((h) => {
      const src = h._source as { video_id?: string } | undefined;
      return {
        video_id: String(src?.video_id ?? h._id ?? ''),
        score: typeof h._score === 'number' ? h._score : 0,
      };
    })
    .filter((r) => r.video_id);

  return {
    assets: selectLexicalAssets(ranked, params.eligibleIds.length),
    took_ms: Math.round(performance.now() - t0),
  };
}

type KnnHit = {
  id: string;
  score: number;
  source: Record<string, unknown>;
};

async function knnChunks(params: {
  field: 'embedding_video' | 'embedding_audio';
  k: number;
  filters: Record<string, unknown>[];
  mode: QueryVectorMode;
}): Promise<KnnHit[]> {
  const client = getEsClient();
  const cfg = getConfig();
  const res = await client.search({
    index: cfg.ES_INDEX_CHUNKS,
    size: params.k,
    _source: [...FILE_SOURCE_FIELDS],
    retriever: {
      knn: knnRetrieverBody(params.field, params.k, params.filters, params.mode),
    },
  } as Parameters<typeof client.search>[0]);

  return (res.hits?.hits ?? [])
    .map((h) => ({
      id: String(h._id ?? ''),
      score: typeof h._score === 'number' ? h._score : 0,
      source: (h._source as Record<string, unknown>) ?? {},
    }))
    .filter((h) => h.id);
}

/** One msearch round-trip for the guaranteed per-asset floor. */
async function msearchFloorKnn(params: {
  field: 'embedding_video' | 'embedding_audio';
  assets: LexicalAssetHit[];
  variantId: string;
  mode: QueryVectorMode;
}): Promise<{ hitsByAsset: KnnHit[][]; http_requests: number; subsearches: number }> {
  if (params.assets.length === 0) {
    return { hitsByAsset: [], http_requests: 0, subsearches: 0 };
  }
  const client = getEsClient();
  const cfg = getConfig();
  const searches: object[] = [];
  for (const asset of params.assets) {
    searches.push({ index: cfg.ES_INDEX_CHUNKS });
    searches.push({
      size: 2,
      _source: [...FILE_SOURCE_FIELDS],
      retriever: {
        knn: knnRetrieverBody(
          params.field,
          2,
          buildChunkFilters({
            variantId: params.variantId,
            eligibleVideoIds: [asset.video_id],
          }),
          params.mode,
        ),
      },
    });
  }

  const res = await client.msearch({
    // NDJSON pairs: header, body, header, body, …
    searches: searches as never,
  });

  const responses = res.responses ?? [];
  if (responses.length !== params.assets.length) {
    throw new Error(
      `msearch_floor_count_mismatch: expected ${params.assets.length}, got ${responses.length}`,
    );
  }

  const hitsByAsset = responses.map((resp, i) => {
    if (!resp || typeof resp !== 'object') {
      throw new Error(`msearch_floor_missing:${i}`);
    }
    const row = resp as {
      error?: unknown;
      status?: number;
      hits?: { hits?: Array<Record<string, unknown>> };
    };
    if (row.error != null) {
      throw new Error(`msearch_floor_error:${i}`);
    }
    if (typeof row.status === 'number' && row.status >= 400) {
      throw new Error(`msearch_floor_status:${i}:${row.status}`);
    }
    if (!('hits' in row) || !row.hits) {
      throw new Error(`msearch_floor_missing_hits:${i}`);
    }
    const hits = row.hits.hits;
    if (!Array.isArray(hits)) {
      throw new Error(`msearch_floor_bad_hits:${i}`);
    }
    return hits
      .map((h) => ({
        id: String(h._id ?? ''),
        score: typeof h._score === 'number' ? h._score : 0,
        source: (h._source as Record<string, unknown>) ?? {},
      }))
      .filter((h) => h.id);
  });
  return {
    hitsByAsset,
    http_requests: 1,
    subsearches: params.assets.length,
  };
}

function upsertCandidate(
  byId: Map<string, FusionCandidate>,
  hit: KnnHit,
  field: 'visual' | 'audio',
) {
  const videoId = String(hit.source.video_id ?? '');
  let row = byId.get(hit.id);
  if (!row) {
    row = {
      chunk_id: hit.id,
      video_id: videoId,
      score_visual: null,
      score_audio: null,
      source: hit.source,
    };
    byId.set(hit.id, row);
  }
  if (field === 'visual') {
    row.score_visual =
      row.score_visual == null
        ? hit.score
        : Math.max(row.score_visual, hit.score);
  } else {
    row.score_audio =
      row.score_audio == null
        ? hit.score
        : Math.max(row.score_audio, hit.score);
  }
}

async function expandLexicalChunks(params: {
  modality: SearchModality;
  variantId: string;
  lexical: LexicalAssetHit[];
  mode: QueryVectorMode;
}): Promise<{
  candidates: FusionCandidate[];
  http_requests: number;
  subsearches: number;
  attempts: number;
  took_ms: number;
}> {
  const t0 = performance.now();
  let httpRequests = 0;
  let subsearches = 0;
  let attempts = 0;
  const byId = new Map<string, FusionCandidate>();

  const fields: Array<'embedding_video' | 'embedding_audio'> =
    params.modality === 'visual'
      ? ['embedding_video']
      : params.modality === 'audio'
        ? ['embedding_audio']
        : ['embedding_video', 'embedding_audio'];

  const G = guaranteedFloorCount(params.lexical.length);
  const floorAssets = params.lexical.slice(0, G);
  const restAssets = params.lexical.slice(G);

  for (const field of fields) {
    const modalityKey = field === 'embedding_video' ? 'visual' : 'audio';

    if (floorAssets.length > 0) {
      attempts += floorAssets.length;
      const floor = await msearchFloorKnn({
        field,
        assets: floorAssets,
        variantId: params.variantId,
        mode: params.mode,
      });
      httpRequests += floor.http_requests;
      subsearches += floor.subsearches;
      for (const hits of floor.hitsByAsset) {
        for (const h of hits) upsertCandidate(byId, h, modalityKey);
      }
    }

    if (restAssets.length > 0) {
      const ids = restAssets.map((a) => a.video_id);
      const k = Math.min(5 * ids.length, 100);
      attempts += 1;
      const hits = await knnChunks({
        field,
        k,
        filters: buildChunkFilters({
          variantId: params.variantId,
          eligibleVideoIds: ids,
        }),
        mode: params.mode,
      });
      httpRequests += 1;
      subsearches += 1;
      const perAsset = new Map<string, number>();
      for (const h of hits) {
        const vid = String(h.source.video_id ?? '');
        const n = perAsset.get(vid) ?? 0;
        if (n >= 5) continue;
        perAsset.set(vid, n + 1);
        upsertCandidate(byId, h, modalityKey);
      }
    }
  }

  return {
    candidates: [...byId.values()],
    http_requests: httpRequests,
    subsearches,
    attempts,
    took_ms: Math.round(performance.now() - t0),
  };
}

function emptyBranch(partial?: Partial<HybridBranchMeta>): HybridBranchMeta {
  return {
    global_visual: 0,
    global_audio: 0,
    lexical_assets: 0,
    lexical_chunks: 0,
    semantic_assets: 0,
    embed_ms: 0,
    embed_calls: 0,
    bm25_ms: 0,
    knn_global_ms: 0,
    knn_lexical_ms: 0,
    knn_semantic_ms: 0,
    fusion_ms: 0,
    es_http_requests: 0,
    es_subsearches: 0,
    es_attempts: 0,
    ...partial,
  };
}

async function searchSemanticAssets(params: {
  queryVector: number[];
  eligibleIds: string[];
  size: number;
}): Promise<{ ranks: Map<string, number>; took_ms: number }> {
  const client = getEsClient();
  const cfg = getConfig();
  const t0 = performance.now();
  if (!cfg.ASSET_SEMANTIC_ENABLED || params.eligibleIds.length === 0) {
    return { ranks: new Map(), took_ms: 0 };
  }

  const res = await client.search({
    index: cfg.ES_INDEX_ASSETS,
    size: Math.min(params.size, params.eligibleIds.length),
    _source: ['video_id'],
    knn: {
      field: 'meta.description_embedding',
      query_vector: params.queryVector,
      k: Math.min(params.size, params.eligibleIds.length),
      num_candidates: Math.min(100, Math.max(params.size * 2, 20)),
      filter: {
        bool: {
          filter: [
            { ids: { values: params.eligibleIds } },
            { term: { 'meta.description_embedding_meta.state': 'current' } },
            // Provider invalidation: only vectors matching the active embed identity.
            { term: { 'meta.description_embedding_meta.provider': cfg.EMBED_PROVIDER } },
            { term: { 'meta.description_embedding_meta.model': cfg.EMBED_MODEL } },
            {
              term: {
                'meta.description_embedding_meta.task': cfg.EMBED_TASK_PASSAGE,
              },
            },
            { term: { 'meta.description_embedding_meta.dims': cfg.EMBED_DIMS } },
          ],
        },
      },
    },
  } as Parameters<typeof client.search>[0]);

  const ranks = new Map<string, number>();
  let rank = 0;
  for (const h of res.hits?.hits ?? []) {
    const src = h._source as { video_id?: string } | undefined;
    const vid = String(src?.video_id ?? h._id ?? '');
    if (!vid || ranks.has(vid)) continue;
    rank += 1;
    ranks.set(vid, rank);
  }
  return { ranks, took_ms: Math.round(performance.now() - t0) };
}

async function loadAssetFacetSnapshots(
  videoIds: string[],
): Promise<Map<string, AssetFacetSnapshot>> {
  const out = new Map<string, AssetFacetSnapshot>();
  if (videoIds.length === 0) return out;
  const client = getEsClient();
  const cfg = getConfig();
  const res = await client.mget({
    index: cfg.ES_INDEX_ASSETS,
    ids: videoIds,
    _source: [
      'video_id',
      'meta.actor_ids',
      'meta.year',
      'meta.country',
      'meta.video_type',
    ],
  });
  for (const doc of res.docs ?? []) {
    if (!('found' in doc) || !doc.found) continue;
    const src = (doc as { _source?: Record<string, unknown>; _id?: string })
      ._source;
    if (!src) continue;
    const meta = (src.meta as Record<string, unknown> | undefined) ?? {};
    const vid = String(src.video_id ?? doc._id ?? '');
    if (!vid) continue;
    out.set(vid, {
      actor_ids: Array.isArray(meta.actor_ids)
        ? meta.actor_ids.map(String)
        : undefined,
      year: typeof meta.year === 'number' ? meta.year : null,
      country: typeof meta.country === 'string' ? meta.country : null,
      video_type: typeof meta.video_type === 'string' ? meta.video_type : null,
    });
  }
  return out;
}

export async function searchChunksHybrid(
  params: HybridSearchParams,
  cfg?: AppConfig,
): Promise<HybridSearchResult> {
  const config = cfg ?? getConfig();
  const size = clampSearchSize(params.size);
  const W = hybridBranchWindow(size);
  const tAll = performance.now();

  const enumerated = await enumerateEligibleAssetIds({
    variantId: params.variantId,
    filters: params.filters ?? null,
    videoId: params.videoId,
  });

  if (enumerated.videoIds.length === 0) {
    return {
      hits: [],
      rank_window_size: W,
      size,
      modality: params.modality,
      sort_by: 'hybrid',
      variant_id: params.variantId,
      video_id: params.videoId ?? null,
      badge_strategy: 'hybrid_app_rrf',
      took_ms: enumerated.took_ms,
      text_channel_status: 'empty',
      ranking_strategy: 'hybrid_rrf',
      filter_meta: {
        eligible_assets: 0,
        enumeration_ms: enumerated.took_ms,
        filters_applied: true,
      },
      branch: emptyBranch({
        es_http_requests: 1,
        es_subsearches: 1,
        es_attempts: 1,
      }),
      query_dsl: {
        status: 'empty_eligible',
        reason: 'no_eligible_assets',
        bm25_query: params.bm25Query?.trim() || params.query,
        vector_query: params.vectorQuery?.trim() || params.query,
        extracted_boosts: params.extractedBoosts ?? null,
      },
    };
  }

  const residualText = params.vectorQuery?.trim() || params.query;
  const fullQuery = params.query.trim();
  const residualMatchesFull =
    residualText.normalize('NFKC').toLowerCase() ===
    fullQuery.normalize('NFKC').toLowerCase();

  let embedCalls = Math.max(0, Math.trunc(params.priorEmbedCalls ?? 0));
  let embedMs = 0;
  let queryVector: number[];

  if (params.queryVector?.length) {
    queryVector = params.queryVector;
  } else if (params.speculativeEmbed && residualMatchesFull) {
    const speculative = await params.speculativeEmbed;
    if (speculative?.vector?.length) {
      queryVector = speculative.vector;
      embedMs += speculative.took_ms;
      // priorEmbedCalls already counted the launch; do not double-count.
    } else {
      const embedded = await embedQueryVector(config, residualText);
      queryVector = embedded.vector;
      embedMs += embedded.took_ms;
      embedCalls += 1;
    }
  } else {
    // Residual differs, or no speculative promise — embed residual now.
    // Speculative (if any) still counts via priorEmbedCalls when launched.
    if (params.speculativeEmbed) {
      void params.speculativeEmbed.catch(() => null);
    }
    const embedded = await embedQueryVector(config, residualText);
    queryVector = embedded.vector;
    embedMs += embedded.took_ms;
    embedCalls += 1;
  }

  const mode: QueryVectorMode = { kind: 'vector', vector: queryVector };
  const bm25Text = params.bm25Query?.trim() || params.query;

  const baseFilters = buildChunkFilters({
    variantId: params.variantId,
    eligibleVideoIds: enumerated.videoIds,
  });

  const byId = new Map<string, FusionCandidate>();
  let httpRequests = 1; // enumeration
  let subsearches = 1;
  let attempts = 1;

  const tGlobal = performance.now();
  const globalJobs: Array<Promise<{ field: 'visual' | 'audio'; hits: KnnHit[] }>> =
    [];
  if (params.modality !== 'audio') {
    attempts += 1;
    globalJobs.push(
      knnChunks({
        field: 'embedding_video',
        k: W,
        filters: baseFilters,
        mode,
      }).then((hits) => ({ field: 'visual' as const, hits })),
    );
  }
  if (params.modality !== 'visual') {
    attempts += 1;
    globalJobs.push(
      knnChunks({
        field: 'embedding_audio',
        k: W,
        filters: baseFilters,
        mode,
      }).then((hits) => ({ field: 'audio' as const, hits })),
    );
  }

  const globalResults = await Promise.all(globalJobs);
  httpRequests += globalResults.length;
  subsearches += globalResults.length;

  let globalVisual = 0;
  let globalAudio = 0;
  for (const row of globalResults) {
    if (row.field === 'visual') globalVisual = row.hits.length;
    else globalAudio = row.hits.length;
    for (const h of row.hits) upsertCandidate(byId, h, row.field);
  }
  const knnGlobalMs = Math.round(performance.now() - tGlobal);

  let textStatus: HybridSearchResult['text_channel_status'] = 'ok';
  let lexical: LexicalAssetHit[] = [];
  let bm25Ms = 0;
  let lexicalChunkCount = 0;
  let lexicalKnnMs = 0;

  // BM25 then lexical expansion — on any text-path failure, clear lexical prior
  // so ranking falls back to global vector candidates only.
  try {
    attempts += 1;
    const bm25 = await searchLexicalAssets({
      query: bm25Text,
      eligibleIds: enumerated.videoIds,
      size: Math.min(20, enumerated.videoIds.length),
    });
    httpRequests += 1;
    subsearches += 1;
    bm25Ms = bm25.took_ms;
    lexical = bm25.assets;
    if (lexical.length === 0) {
      textStatus = 'empty';
    } else {
      try {
        const expanded = await expandLexicalChunks({
          modality: params.modality,
          variantId: params.variantId,
          lexical,
          mode,
        });
        lexicalKnnMs = expanded.took_ms;
        httpRequests += expanded.http_requests;
        subsearches += expanded.subsearches;
        attempts += expanded.attempts;
        lexicalChunkCount = expanded.candidates.length;
        for (const c of expanded.candidates) {
          const existing = byId.get(c.chunk_id);
          if (!existing) {
            byId.set(c.chunk_id, c);
          } else {
            if (c.score_visual != null) {
              existing.score_visual =
                existing.score_visual == null
                  ? c.score_visual
                  : Math.max(existing.score_visual, c.score_visual);
            }
            if (c.score_audio != null) {
              existing.score_audio =
                existing.score_audio == null
                  ? c.score_audio
                  : Math.max(existing.score_audio, c.score_audio);
            }
          }
        }
      } catch {
        // Expansion failed after BM25 success → drop text prior entirely.
        textStatus = 'failed';
        lexical = [];
        lexicalChunkCount = 0;
      }
    }
  } catch {
    textStatus = 'failed';
    lexical = [];
    lexicalChunkCount = 0;
  }

  const lexicalByVideo = new Map(lexical.map((a) => [a.video_id, a]));

  // Semantic asset channel + facet snapshots (Phase 3.5).
  let semanticByVideo = new Map<string, number>();
  let knnSemanticMs = 0;
  if (config.ASSET_SEMANTIC_ENABLED) {
    try {
      attempts += 1;
      const semantic = await searchSemanticAssets({
        queryVector,
        eligibleIds: enumerated.videoIds,
        size: Math.min(20, enumerated.videoIds.length),
      });
      httpRequests += 1;
      subsearches += 1;
      knnSemanticMs = semantic.took_ms;
      semanticByVideo = semantic.ranks;

      // Recover paraphrase/cross-language videos absent from global + BM25.
      const presentVideos = new Set(
        [...byId.values()].map((c) => c.video_id),
      );
      const semanticOnly: LexicalAssetHit[] = [...semanticByVideo.entries()]
        .filter(([vid]) => !presentVideos.has(vid))
        .map(([vid, rank]) => ({
          video_id: vid,
          score: 1 / rank,
          rank,
        }));
      if (semanticOnly.length > 0) {
        try {
          const expanded = await expandLexicalChunks({
            modality: params.modality,
            variantId: params.variantId,
            lexical: semanticOnly,
            mode,
          });
          knnSemanticMs += expanded.took_ms;
          httpRequests += expanded.http_requests;
          subsearches += expanded.subsearches;
          attempts += expanded.attempts;
          for (const c of expanded.candidates) {
            const existing = byId.get(c.chunk_id);
            if (!existing) {
              byId.set(c.chunk_id, c);
            } else {
              if (c.score_visual != null) {
                existing.score_visual =
                  existing.score_visual == null
                    ? c.score_visual
                    : Math.max(existing.score_visual, c.score_visual);
              }
              if (c.score_audio != null) {
                existing.score_audio =
                  existing.score_audio == null
                    ? c.score_audio
                    : Math.max(existing.score_audio, c.score_audio);
              }
            }
          }
        } catch {
          // semantic expansion is optional — ranks still apply to union hits
        }
      }
    } catch {
      // semantic is optional — leave empty
    }
  }

  let assetFacetsByVideo = new Map<string, AssetFacetSnapshot>();
  let snapshotFailed = false;
  const candidateVideoIds = [
    ...new Set([...byId.values()].map((c) => c.video_id)),
  ];
  if (params.extractedBoosts) {
    try {
      attempts += 1;
      assetFacetsByVideo = await loadAssetFacetSnapshots(candidateVideoIds);
      httpRequests += 1;
      subsearches += 1;
    } catch {
      assetFacetsByVideo = new Map();
      snapshotFailed = true;
    }
  }

  // Score only facets that match ≥1 candidate (`applied`). `no_effect` /
  // `snapshot_unavailable` groups stay informational and must not dilute
  // matchedCount/selectedCount in facetBoostScore.
  const boostEffects = params.extractedBoosts
    ? deriveExtractedBoostEffects({
        extracted: params.extractedBoosts,
        snapshots: assetFacetsByVideo,
        candidateVideoIds,
        snapshotFailed,
      })
    : undefined;
  const scoringBoosts =
    boostEffects && Object.keys(boostEffects.applied).length > 0
      ? boostEffects.applied
      : null;

  const vectorScale =
    params.sceneTermsPresent === false ? HYBRID_SCENELESS_VECTOR_SCALE : 1;

  const tFusion = performance.now();
  const fused = fuseHybridCandidates({
    candidates: [...byId.values()],
    lexicalByVideo,
    modality: params.modality,
    semanticByVideo,
    assetFacetsByVideo,
    extractedBoosts: scoringBoosts,
    vectorWeightScale: vectorScale,
  });
  const fusionMs = Math.round(performance.now() - tFusion);

  const hits: SearchHit[] = fused.slice(0, size).map((f) => {
    const base = mapFileHit(
      f.chunk_id,
      f.score_hybrid,
      f.source,
      params.modality === 'both'
        ? f.rank_visual != null && f.rank_audio != null
          ? 'both'
          : f.rank_audio != null
            ? 'audio'
            : 'visual'
        : params.modality,
      f.score_visual,
      f.score_audio,
      f.rank_visual,
      f.rank_audio,
    );
    return {
      ...base,
      score: f.score_hybrid,
      score_kind: 'hybrid_rrf' as const,
      rank_text: f.rank_text,
      asset_text_score: f.asset_text_score,
      metadata_match: f.metadata_match,
    };
  });

  return {
    hits,
    rank_window_size: W,
    size,
    modality: params.modality,
    sort_by: 'hybrid',
    variant_id: params.variantId,
    video_id: params.videoId ?? null,
    badge_strategy: 'hybrid_app_rrf',
    took_ms: Math.round(performance.now() - tAll),
    text_channel_status: textStatus,
    ranking_strategy: 'hybrid_rrf',
    filter_meta: {
      eligible_assets: enumerated.videoIds.length,
      enumeration_ms: enumerated.took_ms,
      filters_applied: true,
    },
    boost_effects: boostEffects,
    query_dsl: buildHybridQueryDslExplain({
      assetsIndex: config.ES_INDEX_ASSETS,
      chunksIndex: config.ES_INDEX_CHUNKS,
      bm25Query: bm25Text,
      vectorQuery: residualText,
      bm25Size: Math.min(20, enumerated.videoIds.length),
      eligibleIds: enumerated.videoIds,
      variantId: params.variantId,
      videoId: params.videoId,
      modality: params.modality,
      knnK: W,
      extractedBoosts: params.extractedBoosts ?? null,
    }),
    branch: {
      global_visual: globalVisual,
      global_audio: globalAudio,
      lexical_assets: lexical.length,
      lexical_chunks: lexicalChunkCount,
      semantic_assets: semanticByVideo.size,
      embed_ms: embedMs,
      embed_calls: embedCalls,
      bm25_ms: bm25Ms,
      knn_global_ms: knnGlobalMs,
      knn_lexical_ms: lexicalKnnMs,
      knn_semantic_ms: knnSemanticMs,
      fusion_ms: fusionMs,
      es_http_requests: httpRequests,
      es_subsearches: subsearches,
      es_attempts: attempts,
    },
  };
}
