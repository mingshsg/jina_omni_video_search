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
 * Suggested starters + distinct `meta.group_id` values already in the index.
 * Fail soft on aggregation errors (return suggestions only).
 */
export async function listGroupCatalogEntries(
  locale: 'en' | 'zh' = 'en',
): Promise<GroupCatalogEntry[]> {
  const byId = new Map<string, string>();
  for (const g of SUGGESTED_ASSET_GROUPS) {
    byId.set(g.id, groupLabel(g.id, locale));
  }

  try {
    const client = getEsClient();
    const cfg = getConfig();
    const res = await client.search({
      index: cfg.ES_INDEX_ASSETS,
      size: 0,
      query: { exists: { field: 'meta.group_id' } },
      aggs: {
        groups: {
          terms: { field: 'meta.group_id', size: 200 },
        },
      },
    });
    const buckets = (
      res.aggregations as
        | { groups?: { buckets?: Array<{ key: string | number }> } }
        | undefined
    )?.groups?.buckets;
    for (const b of buckets ?? []) {
      const id = String(b.key);
      if (!id || byId.has(id)) continue;
      byId.set(id, id);
    }
  } catch {
    /* suggestions only */
  }

  return [...byId.entries()].map(([id, label]) => ({ id, label }));
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
