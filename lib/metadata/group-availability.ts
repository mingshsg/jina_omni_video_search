/**
 * Server-side group availability (todo/39 G1): which variants actually have
 * `ready` assets for each `meta.group_id`.
 *
 * This is deliberately independent of `/api/library` (newest 200 assets) and
 * of the shared `/api/metadata/catalogs` route (todo/39 G3): a group whose
 * ready assets use a non-default variant must be visible before a search
 * returns an unexplained empty result. Enumeration is a single terms
 * aggregation over `video-assets`, bounded by {@link GROUP_TERMS_SIZE}; the
 * response reports truncation instead of hiding it.
 */
import { getConfig } from '../config';
import { getEsClient } from '../es/client';
import {
  SUGGESTED_ASSET_GROUPS,
  groupLabel,
  normalizeGroupId,
} from './catalogs';
import type {
  GroupAvailability,
  GroupAvailabilityEntry,
} from './group-availability-types';

/** Top-N distinct groups enumerated in one request. */
export const GROUP_TERMS_SIZE = 1000;
/** Upper bound on explicitly requested ids (selected groups / exact lookup). */
export const GROUP_REQUESTED_MAX = 30;
/** Distinct ready variants reported per group. */
const READY_VARIANT_TERMS_SIZE = 50;

type VariantBucket = { key: string | number };
type GroupBucket = {
  key: string | number;
  doc_count?: number;
  variants?: {
    ready?: { variant_ids?: { buckets?: VariantBucket[] } };
  };
};

/** Nested ready-variant sub-aggregation shared by both terms aggregations. */
function readyVariantsAgg() {
  return {
    variants: {
      nested: { path: 'variants' },
      aggs: {
        ready: {
          filter: { term: { 'variants.status': 'ready' } },
          aggs: {
            variant_ids: {
              terms: {
                field: 'variants.variant_id',
                size: READY_VARIANT_TERMS_SIZE,
              },
            },
          },
        },
      },
    },
  };
}

function readBucket(bucket: GroupBucket): GroupAvailabilityEntry {
  const raw = bucket.key;
  const id = typeof raw === 'string' ? raw : String(raw);
  const buckets = bucket.variants?.ready?.variant_ids?.buckets ?? [];
  const ready = buckets
    .map((b) => (typeof b.key === 'string' ? b.key : String(b.key)))
    .filter(Boolean);
  return {
    id,
    label: id,
    suggested: false,
    indexed_assets:
      typeof bucket.doc_count === 'number' ? bucket.doc_count : 0,
    ready_variant_ids: [...new Set(ready)],
  };
}

function readBuckets(
  agg: unknown,
): { buckets: GroupBucket[]; other: number } {
  const value = agg as
    | {
        buckets?: GroupBucket[];
        sum_other_doc_count?: number;
      }
    | undefined;
  return {
    buckets: value?.buckets ?? [],
    other: typeof value?.sum_other_doc_count === 'number'
      ? value.sum_other_doc_count
      : 0,
  };
}

function safeError(err: unknown): string {
  const message = err instanceof Error ? err.message : 'Group enumeration failed';
  return message.replace(/ApiKey\s+\S+/gi, 'ApiKey [redacted]');
}

/**
 * Distinct `meta.group_id` values with the ready variants behind each of them.
 * Never throws on Elasticsearch failure — returns `status: 'unavailable'`
 * with starter suggestions so the search control can stay usable and retry.
 */
export async function listGroupAvailability(opts: {
  locale?: 'en' | 'zh';
  /** Selected ids that must stay visible even beyond the top-N cut. */
  includeIds?: string[];
  /** Exact group name lookup (search-as-you-type fallback). */
  q?: string;
} = {}): Promise<GroupAvailability> {
  const locale = opts.locale ?? 'en';
  const byId = new Map<string, GroupAvailabilityEntry>();
  for (const suggestion of SUGGESTED_ASSET_GROUPS) {
    byId.set(suggestion.id, {
      id: suggestion.id,
      label: groupLabel(suggestion.id, locale),
      suggested: true,
      indexed_assets: 0,
      ready_variant_ids: [],
    });
  }

  const requested = [
    ...new Set(
      [...(opts.includeIds ?? []), ...(opts.q ? [opts.q] : [])]
        .map((raw) => normalizeGroupId(raw))
        .filter((id): id is string => Boolean(id)),
    ),
  ].slice(0, GROUP_REQUESTED_MAX);

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
          terms: { field: 'meta.group_id', size: GROUP_TERMS_SIZE },
          aggs: readyVariantsAgg(),
        },
        ...(requested.length > 0
          ? {
              requested: {
                terms: {
                  field: 'meta.group_id',
                  size: requested.length,
                  include: requested,
                },
                aggs: readyVariantsAgg(),
              },
            }
          : {}),
        distinct_groups: { cardinality: { field: 'meta.group_id' } },
      },
    });

    const aggregations = res.aggregations as
      | {
          groups?: unknown;
          requested?: unknown;
          distinct_groups?: { value?: number };
        }
      | undefined;

    const main = readBuckets(aggregations?.groups);
    const extra = readBuckets(aggregations?.requested);

    for (const bucket of [...main.buckets, ...extra.buckets]) {
      const entry = readBucket(bucket);
      if (!entry.id) continue;
      const existing = byId.get(entry.id);
      if (existing) {
        byId.set(entry.id, {
          ...existing,
          indexed_assets: entry.indexed_assets,
          ready_variant_ids: entry.ready_variant_ids,
        });
      } else {
        byId.set(entry.id, {
          ...entry,
          label: groupLabel(entry.id, locale),
        });
      }
    }

    const returned = main.buckets.length;
    const distinct = Math.max(
      typeof aggregations?.distinct_groups?.value === 'number'
        ? aggregations.distinct_groups.value
        : returned,
      returned,
    );
    const truncated = main.other > 0 || distinct > returned;

    return {
      status: truncated ? 'partial' : 'ok',
      groups: [...byId.values()],
      total_groups: distinct,
      truncated,
    };
  } catch (err) {
    return {
      status: 'unavailable',
      groups: [...byId.values()],
      total_groups: 0,
      truncated: false,
      error: safeError(err),
    };
  }
}
