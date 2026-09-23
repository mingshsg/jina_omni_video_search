/**
 * Item 4 (plan/11) — standalone "Description" search axis.
 *
 * Distinct from `searchChunks`/`searchChunksHybrid`: this is an asset-level
 * query (whole video, no time window) against the `semantic_text` mirror
 * fields (`meta.description_semantic`, `meta.abstract_semantic`,
 * `meta.work_title_semantic`). Deliberately NOT folded into
 * `searchChunksHybrid`'s chunk-level RRF fusion — chunk hits carry
 * start_ms/end_ms; a description/abstract/title match is a claim about the
 * whole asset, not about a specific moment (plan/03's "Result grain"
 * principle already established this for the lexical BM25 asset channel).
 */
import { getConfig } from '../config';
import { enumerateEligibleAssetIds } from '../metadata/search-filters';
import type { NormalizedSearchFilters } from '../metadata/search-filters';
import type { WorkTitle } from '../metadata/validate';
import { getEsClient } from './client';
import { clampSearchSize } from './search-core';

export interface DescriptionSearchHit {
  video_id: string;
  title: string;
  work_title: WorkTitle | null;
  score: number;
  thumb_url: string;
  duration_ms: number;
}

export interface DescriptionSearchResult {
  hits: DescriptionSearchHit[];
  size: number;
  took_ms: number;
  eligible_assets: number;
}

export interface DescriptionSearchParams {
  query: string;
  variantId: string;
  videoId?: string | null;
  size?: number;
  filters?: NormalizedSearchFilters | null;
}

function thumbUrlForAsset(
  videoId: string,
  variants: Array<{ variant_id?: unknown }> | undefined,
  fallbackVariantId: string,
): string {
  const firstVariant =
    variants?.find((v) => typeof v?.variant_id === 'string')?.variant_id;
  const variantId =
    typeof firstVariant === 'string' && firstVariant
      ? firstVariant
      : fallbackVariantId;
  return `/api/thumb/${encodeURIComponent(videoId)}/${encodeURIComponent(variantId)}/0`;
}

/**
 * Asset-level semantic search over description + abstract + work_title.
 * Requires `meta.*_semantic` mapping fields (see `videoAssetsMetaMappingProperties`)
 * — on a cluster that hasn't run the item 4 mapping upgrade yet, this throws
 * the same way any other query against a missing field would; callers should
 * treat that as "Description mode unavailable" rather than a generic 500.
 */
export async function searchDescriptionAssets(
  params: DescriptionSearchParams,
): Promise<DescriptionSearchResult> {
  const cfg = getConfig();
  const client = getEsClient();
  const size = clampSearchSize(params.size);
  const t0 = performance.now();

  const enumerated = await enumerateEligibleAssetIds({
    variantId: params.variantId,
    filters: params.filters ?? null,
    videoId: params.videoId ?? null,
  });

  if (enumerated.videoIds.length === 0) {
    return {
      hits: [],
      size,
      took_ms: Math.round(performance.now() - t0),
      eligible_assets: 0,
    };
  }

  const res = await client.search({
    index: cfg.ES_INDEX_ASSETS,
    size: Math.min(size, enumerated.videoIds.length),
    _source: ['title', 'duration_ms', 'variants.variant_id', 'meta.work_title'],
    query: {
      bool: {
        filter: [{ ids: { values: enumerated.videoIds } }],
        should: [
          { semantic: { field: 'meta.description_semantic', query: params.query } },
          { semantic: { field: 'meta.abstract_semantic', query: params.query } },
          { semantic: { field: 'meta.work_title_semantic', query: params.query } },
        ],
        minimum_should_match: 1,
      },
    },
  });

  const hits: DescriptionSearchHit[] = res.hits.hits.map((h) => {
    const src = (h._source ?? {}) as Record<string, unknown>;
    const videoId = String(h._id ?? '');
    const meta = (src.meta ?? {}) as { work_title?: WorkTitle };
    const variants = Array.isArray(src.variants)
      ? (src.variants as Array<{ variant_id?: unknown }>)
      : undefined;
    return {
      video_id: videoId,
      title: String(src.title ?? ''),
      work_title: meta.work_title ?? null,
      score: typeof h._score === 'number' ? h._score : 0,
      thumb_url: thumbUrlForAsset(videoId, variants, params.variantId),
      duration_ms: Number(src.duration_ms ?? 0),
    };
  });

  return {
    hits,
    size,
    took_ms: Math.round(performance.now() - t0),
    eligible_assets: enumerated.videoIds.length,
  };
}
