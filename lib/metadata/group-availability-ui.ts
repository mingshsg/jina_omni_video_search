/**
 * Pure helpers for the primary search Group control (todo/39 G1/G2 auto
 * selection edge cases and G5 catalog scale). No React and no server imports,
 * so these are covered by the Vitest include (`lib/**`).
 */
import type { GroupAvailabilityEntry } from './group-availability-types';

/**
 * Selected-ID cap enforced by the control, mirroring
 * `META_BOUNDS.facetArrayMax` (the `searchFiltersSchema` limit — the 21st id
 * would otherwise 400). Kept as an explicit local constant because importing
 * catalogs would drag the server config into the client bundle.
 */
export const GROUP_SELECTION_LIMIT = 20;

/** Empty selection means All (no API filter). */
export function selectedSearchGroupIds(
  options: Array<{ label: string; value?: string | number | string[] | null }>,
): string[] {
  if (options.some((option) => option.value === '')) return [];
  return [...new Set(options.map((option) => String(option.value ?? option.label)))];
}

/**
 * Cap a proposed selection at {@link GROUP_SELECTION_LIMIT}. Overflow is
 * dropped from the end rather than rejected outright, so a chip click that
 * would exceed the bound keeps the previously selected ids usable.
 */
export function capGroupSelection(ids: string[]): {
  ids: string[];
  overflowed: boolean;
} {
  const unique = [...new Set(ids.filter((id) => Boolean(id)))];
  if (unique.length <= GROUP_SELECTION_LIMIT) {
    return { ids: unique, overflowed: false };
  }
  return { ids: unique.slice(0, GROUP_SELECTION_LIMIT), overflowed: true };
}

/**
 * Keep currently selected ids visible as selectable options even when the
 * server response is truncated or unavailable (the user must be able to see
 * and clear what they picked).
 */
export function mergeSelectedGroupEntries(
  entries: GroupAvailabilityEntry[],
  selectedIds: string[],
): GroupAvailabilityEntry[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  for (const id of selectedIds) {
    if (id && !byId.has(id)) {
      byId.set(id, {
        id,
        label: id,
        suggested: false,
        indexed_assets: 0,
        ready_variant_ids: [],
      });
    }
  }
  return [...byId.values()];
}

export type GroupVariantNotice =
  | { kind: 'none' }
  | { kind: 'no_variant' }
  | { kind: 'unknown'; groupIds: string[] }
  | {
      kind: 'incompatible';
      groupIds: string[];
      /** Compatible variants, most common first; may be empty. */
      suggestedVariantIds: string[];
    };

/**
 * The variant/group compatibility state for the current selection (G1).
 *
 * - `no_variant` — no variant is chosen yet; nothing to explain.
 * - `unknown` — the control has not resolved every selected group yet
 *   (truncated/unavailable catalog); do not claim an empty result is real.
 * - `none` — at least one selected group has ready assets in the current
 *   variant, so the search can match.
 * - `incompatible` — every selected group lacks ready assets for the current
 *   variant; `suggestedVariantIds` are the variants those groups do support.
 */
export function deriveGroupVariantNotice(params: {
  selectedIds: string[];
  variantId: string;
  entries: GroupAvailabilityEntry[];
  /** All known ready variant ids — used to label suggestions. Optional. */
  knownVariantIds?: string[];
}): GroupVariantNotice {
  const { selectedIds, variantId, entries } = params;
  if (selectedIds.length === 0) return { kind: 'none' };
  if (!variantId) return { kind: 'no_variant' };

  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const missing = selectedIds.filter((id) => !byId.has(id));
  if (missing.length > 0) return { kind: 'unknown', groupIds: missing };

  const compatible = selectedIds.some((id) =>
    (byId.get(id)?.ready_variant_ids ?? []).includes(variantId),
  );
  if (compatible) return { kind: 'none' };

  const suggested = [
    ...new Set(
      selectedIds.flatMap((id) => byId.get(id)?.ready_variant_ids ?? []),
    ),
  ].sort();
  return { kind: 'incompatible', groupIds: selectedIds, suggestedVariantIds: suggested };
}

/**
 * Compatible variants the control may offer as an explicit switch. When the
 * page can only select a known subset, ids outside it are dropped so the
 * button never sets a variant the page cannot render (todo/39 G1).
 */
export function selectableCompatibleVariants(
  suggestedVariantIds: string[],
  knownVariantIds?: string[],
): string[] {
  if (!knownVariantIds) return suggestedVariantIds;
  const known = new Set(knownVariantIds);
  return suggestedVariantIds.filter((id) => known.has(id));
}

/** Query string for the availability endpoint, including selected ids. */
export function groupAvailabilityQuery(params: {
  locale: string;
  selectedIds: string[];
  q?: string;
}): string {
  const search = new URLSearchParams({ locale: params.locale });
  for (const id of params.selectedIds) {
    if (id) search.append('include', id);
  }
  if (params.q) search.set('q', params.q);
  return search.toString();
}
