/**
 * Search facet validation + eligible asset-ID enumeration (Phase 2).
 */
import { z } from 'zod';
import { getConfig } from '../config';
import { getEsClient } from '../es/client';
import {
  COUNTRY_CODE_SET,
  META_BOUNDS,
  PRIMARY_LANGUAGES,
  VIDEO_TYPE_SET,
  canonicalizePrimaryLanguage,
} from './catalogs';
import { getPerson } from './people';
import { normalizeTagKey } from './validate';

export const FILTER_SCOPE_CAP = 10_000;

export class SearchFilterError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = 'SearchFilterError';
    this.code = code;
    this.status = status;
  }
}

const stringArray = (maxItems: number, maxLen: number) =>
  z
    .array(z.string().min(1).max(maxLen))
    .max(maxItems)
    .optional();

export const searchFiltersSchema = z
  .object({
    year_from: z
      .number()
      .int()
      .min(META_BOUNDS.yearMin)
      .max(META_BOUNDS.yearMax)
      .optional(),
    year_to: z
      .number()
      .int()
      .min(META_BOUNDS.yearMin)
      .max(META_BOUNDS.yearMax)
      .optional(),
    actor_ids: stringArray(META_BOUNDS.facetArrayMax, META_BOUNDS.actorIdMaxLen),
    video_type: stringArray(META_BOUNDS.facetArrayMax, 64),
    primary_language: stringArray(META_BOUNDS.facetArrayMax, 32),
    country: stringArray(META_BOUNDS.facetArrayMax, 8),
    tags: stringArray(META_BOUNDS.facetArrayMax, META_BOUNDS.tagMaxLen),
  })
  .strict()
  // Bug fix: image search (app/api/search/image/route.ts) embeds this same
  // schema as a request-body field and always sends an explicit `null` for
  // "no filters selected" (FormData has no concept of an absent-vs-null
  // field once the multipart parser normalizes it) — `.optional()` alone
  // only tolerates `undefined`, so every filter-less image search 400'd
  // with "filters: Expected object, received null". `parseSearchFilters`
  // below already treats `null` and `undefined` identically; this just
  // lets the schema agree before that function ever runs.
  .nullable()
  .optional();

export type SearchFiltersInput = z.infer<typeof searchFiltersSchema>;

export interface NormalizedSearchFilters {
  year_from?: number;
  year_to?: number;
  actor_ids?: string[];
  video_type?: string[];
  primary_language?: string[];
  country?: string[];
  tags_key?: string[];
}

/** True when the request selected at least one facet. */
export function hasActiveFilters(
  filters: NormalizedSearchFilters | null | undefined,
): boolean {
  if (!filters) return false;
  return (
    filters.year_from != null ||
    filters.year_to != null ||
    (filters.actor_ids?.length ?? 0) > 0 ||
    (filters.video_type?.length ?? 0) > 0 ||
    (filters.primary_language?.length ?? 0) > 0 ||
    (filters.country?.length ?? 0) > 0 ||
    (filters.tags_key?.length ?? 0) > 0
  );
}

export function parseSearchFilters(raw: unknown): NormalizedSearchFilters | null {
  if (raw == null || raw === undefined) return null;
  const parsed = searchFiltersSchema.safeParse(raw);
  if (!parsed.success) {
    throw new SearchFilterError(
      'SEARCH_INVALID_REQUEST',
      parsed.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; '),
    );
  }
  if (!parsed.data) return null;

  const f = parsed.data;
  if (
    f.year_from != null &&
    f.year_to != null &&
    f.year_from > f.year_to
  ) {
    throw new SearchFilterError(
      'SEARCH_INVALID_REQUEST',
      'year_from must be <= year_to',
    );
  }

  const out: NormalizedSearchFilters = {};
  if (f.year_from != null) out.year_from = f.year_from;
  if (f.year_to != null) out.year_to = f.year_to;

  if (f.actor_ids?.length) {
    const ids = [...new Set(f.actor_ids.map((id) => id.trim()))];
    for (const id of ids) {
      if (!getPerson(id)) {
        throw new SearchFilterError(
          'SEARCH_INVALID_REQUEST',
          `Unknown actor id: ${id}`,
        );
      }
    }
    out.actor_ids = ids;
  }

  if (f.video_type?.length) {
    const types = [...new Set(f.video_type.map((t) => t.trim()))];
    for (const t of types) {
      if (!VIDEO_TYPE_SET.has(t)) {
        throw new SearchFilterError(
          'SEARCH_INVALID_REQUEST',
          `Unknown video_type: ${t}`,
        );
      }
    }
    out.video_type = types;
  }

  if (f.primary_language?.length) {
    const langs: string[] = [];
    for (const rawLang of f.primary_language) {
      const canonical = canonicalizePrimaryLanguage(rawLang);
      if (!canonical) {
        throw new SearchFilterError(
          'SEARCH_INVALID_REQUEST',
          `Unsupported language: ${rawLang}`,
        );
      }
      langs.push(canonical);
    }
    out.primary_language = [...new Set(langs)];
  }

  if (f.country?.length) {
    const codes = [
      ...new Set(f.country.map((c) => c.trim().toUpperCase())),
    ];
    for (const c of codes) {
      if (!COUNTRY_CODE_SET.has(c)) {
        throw new SearchFilterError(
          'SEARCH_INVALID_REQUEST',
          `Country/region not in catalog: ${c}`,
        );
      }
    }
    out.country = codes;
  }

  if (f.tags?.length) {
    const keys = [
      ...new Set(
        f.tags
          .map((t) => normalizeTagKey(t))
          .filter(Boolean),
      ),
    ];
    if (keys.length === 0) {
      throw new SearchFilterError(
        'SEARCH_INVALID_REQUEST',
        'tags must contain at least one non-empty value',
      );
    }
    out.tags_key = keys;
  }

  return hasActiveFilters(out) ? out : null;
}

/** Build the asset-side bool.filter clauses (facets + ready variant). */
export function buildAssetEligibilityFilters(
  variantId: string,
  filters: NormalizedSearchFilters | null,
  videoId?: string | null,
): Record<string, unknown>[] {
  const clauses: Record<string, unknown>[] = [
    {
      nested: {
        path: 'variants',
        query: {
          bool: {
            filter: [
              { term: { 'variants.variant_id': variantId } },
              { term: { 'variants.status': 'ready' } },
            ],
          },
        },
      },
    },
  ];

  if (videoId) {
    clauses.push({ term: { video_id: videoId } });
  }

  if (!filters) return clauses;

  if (filters.year_from != null || filters.year_to != null) {
    const range: Record<string, number> = {};
    if (filters.year_from != null) range.gte = filters.year_from;
    if (filters.year_to != null) range.lte = filters.year_to;
    clauses.push({ range: { 'meta.year': range } });
  }
  if (filters.actor_ids?.length) {
    clauses.push({ terms: { 'meta.actor_ids': filters.actor_ids } });
  }
  if (filters.video_type?.length) {
    clauses.push({ terms: { 'meta.video_type': filters.video_type } });
  }
  if (filters.primary_language?.length) {
    clauses.push({
      terms: { 'meta.primary_language': filters.primary_language },
    });
  }
  if (filters.country?.length) {
    clauses.push({ terms: { 'meta.country': filters.country } });
  }
  if (filters.tags_key?.length) {
    clauses.push({ terms: { 'meta.tags_key': filters.tags_key } });
  }

  return clauses;
}

export interface EnumerateEligibleAssetsResult {
  videoIds: string[];
  total: number;
  overflow: boolean;
  took_ms: number;
}

/**
 * Interpret ES hits.total for the enumeration cap.
 * Reject whenever total > CAP (including relation=eq at 10001).
 * Fail closed on missing/ambiguous totals when the page is full.
 */
export function interpretEligibleTotal(params: {
  totalHits: unknown;
  hitCount: number;
  cap?: number;
}): { total: number; overflow: boolean; ambiguous: boolean } {
  const cap = params.cap ?? FILTER_SCOPE_CAP;
  const { totalHits, hitCount } = params;

  if (typeof totalHits === 'number') {
    return {
      total: totalHits,
      overflow: totalHits > cap,
      ambiguous: false,
    };
  }

  if (
    totalHits &&
    typeof totalHits === 'object' &&
    'value' in totalHits &&
    typeof (totalHits as { value: unknown }).value === 'number'
  ) {
    const value = (totalHits as { value: number }).value;
    const relation =
      'relation' in totalHits &&
      typeof (totalHits as { relation: unknown }).relation === 'string'
        ? (totalHits as { relation: string }).relation
        : 'eq';
    // gte means the true count may be higher than value — fail closed at the
    // tracking threshold (CAP+1) and at CAP itself.
    if (relation === 'gte' && value >= cap) {
      return { total: value, overflow: true, ambiguous: false };
    }
    return {
      total: value,
      overflow: value > cap,
      ambiguous: false,
    };
  }

  // Missing total: cannot prove completeness if we already filled the page.
  if (hitCount >= cap) {
    return { total: hitCount, overflow: true, ambiguous: true };
  }
  return { total: hitCount, overflow: false, ambiguous: true };
}

/**
 * Single-request eligible asset-ID set (size 10000, track_total_hits 10001).
 * On overflow throw FILTER_SCOPE_TOO_LARGE — never silently truncate.
 */
export async function enumerateEligibleAssetIds(params: {
  variantId: string;
  filters?: NormalizedSearchFilters | null;
  videoId?: string | null;
}): Promise<EnumerateEligibleAssetsResult> {
  const client = getEsClient();
  const cfg = getConfig();
  const t0 = performance.now();
  const filter = buildAssetEligibilityFilters(
    params.variantId,
    params.filters ?? null,
    params.videoId,
  );

  const res = await client.search({
    index: cfg.ES_INDEX_ASSETS,
    size: FILTER_SCOPE_CAP,
    _source: false,
    track_total_hits: FILTER_SCOPE_CAP + 1,
    query: { bool: { filter } },
  });

  const interpreted = interpretEligibleTotal({
    totalHits: res.hits.total,
    hitCount: res.hits.hits.length,
  });

  if (interpreted.overflow) {
    throw new SearchFilterError(
      'FILTER_SCOPE_TOO_LARGE',
      `More than ${FILTER_SCOPE_CAP} assets match the selected filters`,
      422,
    );
  }

  const videoIds = res.hits.hits
    .map((h) => h._id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);

  return {
    videoIds,
    total: interpreted.total,
    overflow: false,
    took_ms: Math.round(performance.now() - t0),
  };
}

/** Chunk knn pre-filters: variant + optional video + optional ID allow-list. */
export function buildChunkFilters(params: {
  variantId: string;
  videoId?: string | null;
  eligibleVideoIds?: string[] | null;
}): Record<string, unknown>[] {
  const filters: Record<string, unknown>[] = [
    { term: { variant_id: params.variantId } },
  ];
  if (params.videoId) {
    filters.push({ term: { video_id: params.videoId } });
  }
  if (params.eligibleVideoIds && params.eligibleVideoIds.length > 0) {
    filters.push({ terms: { video_id: params.eligibleVideoIds } });
  }
  // Empty eligible set is handled by the caller (return no hits before embed).
  return filters;
}

/** Re-export for UI catalogs. */
export { PRIMARY_LANGUAGES };
