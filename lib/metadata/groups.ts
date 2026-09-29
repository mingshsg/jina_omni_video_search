/**
 * Free-form organizational group helpers + ES terms listing for catalogs UI.
 */
import { getConfig } from '../config';
import { getEsClient } from '../es/client';
import {
  META_BOUNDS,
  SUGGESTED_ASSET_GROUPS,
  groupLabel,
  normalizeGroupId,
} from './catalogs';

export type GroupCatalogEntry = { id: string; label: string };

/**
 * `ok` — every distinct stored group is in `entries`.
 * `partial` — the terms aggregation truncated (more than
 *   {@link GROUP_CATALOG_TERMS_SIZE} distinct groups).
 * `unavailable` — the Elasticsearch query failed; only starter suggestions.
 */
export type GroupCatalogStatus = 'ok' | 'partial' | 'unavailable';

export interface GroupCatalogResult {
  entries: GroupCatalogEntry[];
  status: GroupCatalogStatus;
  /** Distinct stored groups retrieved (suggestions excluded). */
  total_groups: number;
  truncated: boolean;
  /** Sanitized failure detail, present only when `status === 'unavailable'`. */
  error?: string;
}

/** Top-N distinct stored groups enumerated in one request. */
export const GROUP_CATALOG_TERMS_SIZE = 200;

/** Validate / normalize a free-form group name; throws on over-length. */
export function parseFreeformGroupId(raw: string): string {
  const id = normalizeGroupId(raw);
  if (!id) {
    throw new Error('empty group_id');
  }
  if (id.length > META_BOUNDS.groupIdMaxLen) {
    throw new Error(
      `group_id exceeds ${META_BOUNDS.groupIdMaxLen} characters`,
    );
  }
  return id;
}

/**
 * Suggested starters + distinct `meta.group_id` values already in the index,
 * with an explicit completeness status. Never throws: an Elasticsearch
 * failure returns `status: 'unavailable'` with the starter suggestions so a
 * caller can still render All and offer a retry (todo/39 G3).
 */
export async function listGroupCatalogResult(
  locale: 'en' | 'zh' = 'en',
): Promise<GroupCatalogResult> {
  const byId = new Map<string, string>();
  for (const g of SUGGESTED_ASSET_GROUPS) {
    byId.set(g.id, groupLabel(g.id, locale));
  }
  const suggestions = [...byId.entries()].map(([id, label]) => ({ id, label }));

  try {
    const client = getEsClient();
    const cfg = getConfig();
    const res = await client.search({
      index: cfg.ES_INDEX_ASSETS,
      size: 0,
      track_total_hits: false,
      query: { exists: { field: 'meta.group_id' } },
      aggs: {
        groups: {
          terms: { field: 'meta.group_id', size: GROUP_CATALOG_TERMS_SIZE },
        },
        distinct_groups: { cardinality: { field: 'meta.group_id' } },
      },
    });
    const aggregations = res.aggregations as
      | {
          groups?: {
            buckets?: Array<{ key: string | number }>;
            sum_other_doc_count?: number;
          };
          distinct_groups?: { value?: number };
        }
      | undefined;
    const buckets = aggregations?.groups?.buckets ?? [];
    for (const b of buckets) {
      const id = String(b.key);
      if (!id || byId.has(id)) continue;
      byId.set(id, id);
    }

    const returned = buckets.length;
    const other = aggregations?.groups?.sum_other_doc_count ?? 0;
    const distinct = Math.max(
      typeof aggregations?.distinct_groups?.value === 'number'
        ? aggregations.distinct_groups.value
        : returned,
      returned,
    );
    const truncated = other > 0 || distinct > returned;

    return {
      entries: [...byId.entries()].map(([id, label]) => ({ id, label })),
      status: truncated ? 'partial' : 'ok',
      total_groups: distinct,
      truncated,
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Group enumeration failed';
    return {
      entries: suggestions,
      status: 'unavailable',
      total_groups: 0,
      truncated: false,
      error: message.replace(/ApiKey\s+\S+/gi, 'ApiKey [redacted]'),
    };
  }
}

/**
 * Back-compat wrapper returning only the entries. Prefer
 * {@link listGroupCatalogResult} when the caller can surface completeness.
 */
export async function listGroupCatalogEntries(
  locale: 'en' | 'zh' = 'en',
): Promise<GroupCatalogEntry[]> {
  return (await listGroupCatalogResult(locale)).entries;
}

/**
 * Infer backfill group from asset variants.
 * - 10 s / `fine` → `trailer`
 * - 2 s / `2s` → `demo`
 * Prefer `demo` when both are present (ultra-dense is the newer default).
 */
export function inferGroupFromVariants(
  variants: Array<{
    chunk_preset?: string;
    chunk_window_ms?: number;
  }>,
): 'trailer' | 'demo' | null {
  let hasFine = false;
  let has2s = false;
  for (const v of variants) {
    const preset = v.chunk_preset;
    const ms = v.chunk_window_ms;
    if (preset === 'fine' || ms === 10_000) hasFine = true;
    if (preset === '2s' || ms === 2_000) has2s = true;
  }
  if (has2s) return 'demo';
  if (hasFine) return 'trailer';
  return null;
}
