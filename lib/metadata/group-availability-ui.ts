/**
 * Pure helpers for the primary search Group control (todo/39 G1/G2 auto
 * selection edge cases and G5 catalog scale). No React and no server imports,
 * so these are covered by the Vitest include (`lib/**`).
 */
import type {
  GroupAvailability,
  GroupAvailabilityEntry,
} from './group-availability-types';

/**
 * Selected-ID cap enforced by the control, mirroring
 * `META_BOUNDS.facetArrayMax` (the `searchFiltersSchema` limit — the 21st id
 * would otherwise 400). Kept as an explicit local constant because importing
 * catalogs would drag the server config into the client bundle.
 */
export const GROUP_SELECTION_LIMIT = 20;

/** Select only from verified Group entries, preserving a compatible current choice.
 * For multiple OR-filtered groups, prefer coverage, then server preference rank.
 * An unresolved/empty selection cannot justify changing vector identity.
 */
export function groupSelectionVariant(params: {
  selectedIds: string[];
  currentVariantId: string;
  entries: GroupAvailabilityEntry[];
}): string | undefined {
  const groups = [...new Set(params.selectedIds)].map((id) => params.entries.find((g) => g.id === id));
  if (!groups.length || groups.some((g) => !g)) return undefined;
  const candidates = new Map<string, { coverage: number; rank: number }>();
  for (const group of groups) {
    [...new Set(group!.ready_variant_ids)].forEach((id, rank) => {
      const previous = candidates.get(id) ?? { coverage: 0, rank: 0 };
      candidates.set(id, { coverage: previous.coverage + 1, rank: previous.rank + rank });
    });
  }
  if (candidates.has(params.currentVariantId)) return params.currentVariantId;
  return [...candidates.keys()].sort((a, b) => {
    const left = candidates.get(a)!;
    const right = candidates.get(b)!;
    return right.coverage - left.coverage || left.rank - right.rank || a.localeCompare(b);
  })[0];
}

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

/**
 * How completely the last availability response resolved the selected ids
 * (todo/40 R2):
 * - `resolved` — every selected id was in the response.
 * - `loading` — a request is in flight; nothing to conclude yet.
 * - `unavailable` — the request failed, so no entry can be trusted.
 * - `truncated` — the response succeeded but did not include every selected id.
 * - `missing` — the response was complete yet omitted the selected id(s),
 *   which for a complete catalog means the group truly is unavailable.
 */
export type GroupAvailabilityResolution =
  | 'resolved'
  | 'loading'
  | 'unavailable'
  | 'truncated'
  | 'missing';

export type ComposedGroupAvailability = {
  /** Non-selected catalog entries plus placeholder entries for selected ids. */
  entries: GroupAvailabilityEntry[];
  /** Selectable ComboBox options (catalog + exact-lookup only). */
  options: GroupAvailabilityEntry[];
  resolution: GroupAvailabilityResolution;
  /** Selected ids the response did not include. */
  unresolvedGroupIds: string[];
  /** Selected ids the response included with zero ready variants. */
  verifiedEmptyGroupIds: string[];
};

/**
 * Compose the availability response, the exact-lookup result, and the selected
 * ids into the single state the search control consumes. This is the exact
 * path the component uses, so tests exercise the same merge/status logic
 * (vitest only includes `lib/**`).
 *
 * Key rule (todo/40 R2): a selected id that is *absent* from the response is
 * "unresolved" and only treated as an empty group when the response is
 * genuinely complete (`status === 'ok'`). A failed or truncated response must
 * never be reported as a confirmed empty group.
 */
export function composeGroupAvailability(params: {
  data: GroupAvailability | null;
  lookup: GroupAvailabilityEntry[];
  selectedIds: string[];
  loading: boolean;
  failed: boolean;
}): ComposedGroupAvailability {
  const { data, lookup, selectedIds, loading, failed } = params;
  const selectedKey = selectedIds.join('\u0000');
  // Selectable options are the catalog plus exact-lookup hits only; selected
  // ids that are absent get a placeholder entry for visibility, never an option.
  const options = [...new Map([...(data?.groups ?? []), ...lookup].map((entry) => [entry.id, entry])).values()];
  const merged = mergeSelectedGroupEntries(
    options,
    selectedKey ? selectedKey.split('\u0000') : [],
  );
  const entries = [...new Map(merged.map((e) => [e.id, e])).values()];

  const byId = new Map((data?.groups ?? []).map((e) => [e.id, e]));
  const unresolvedGroupIds = selectedIds.filter((id) => !byId.has(id));
  const verifiedEmptyGroupIds =
    !loading && !failed && data?.status === 'ok'
      ? unresolvedGroupIds
      : [];

  const resolution: GroupAvailabilityResolution = loading
    ? 'loading'
    : failed || data?.status === 'unavailable'
      ? 'unavailable'
      : data?.status === 'partial' || data?.truncated
        ? 'truncated'
        : unresolvedGroupIds.length > 0
          ? 'missing'
          : 'resolved';

  return { entries, options, resolution, unresolvedGroupIds, verifiedEmptyGroupIds };
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
 * Union the page's `/api/library`-derived selectable variants with the
 * server-backed ready-variant option source (todo/40 R1). A variant the page
 * has never seen only becomes selectable after this merge — the option source
 * is what makes an older group's compatible variant reachable, and the page
 * publishes the same ids into its own selector.
 *
 * Returns `undefined` only when the page passed no known list at all, in
 * which case the caller has no restriction to enforce.
 */
export function variantSelectableIds(
  knownVariantIds: string[] | undefined,
  availabilityVariantIds: string[] | undefined,
): string[] | undefined {
  if (!knownVariantIds) return undefined;
  return [...new Set([...knownVariantIds, ...(availabilityVariantIds ?? [])])];
}

/**
 * Explicit variant-switch targets the control may offer for an
 * `incompatible` notice (todo/39 G1, completed by todo/40 R1).
 *
 * Candidates are the union of the notice's suggested variants and the ready
 * variants of the *selected* groups, minus the currently selected variant,
 * intersected with the ids the page can actually select (`knownVariantIds`).
 * Because the source comes from the availability endpoint rather than
 * `/api/library`'s newest 200, a group whose only ready asset is older than
 * that window still gets a switch button. When `knownVariantIds` is supplied
 * it is authoritative — the page must not be asked to render a variant outside
 * it (the caller merges the option source in via {@link variantSelectableIds}).
 */
export function variantSwitchTargets(params: {
  notice: GroupVariantNotice;
  currentVariantId: string;
  readyVariantIds?: string[];
  knownVariantIds?: string[];
}): string[] {
  const { notice, currentVariantId, readyVariantIds, knownVariantIds } = params;
  if (notice.kind !== 'incompatible') return [];
  const candidates = new Set([
    ...notice.suggestedVariantIds,
    ...(readyVariantIds ?? []),
  ]);
  candidates.delete(currentVariantId);
  const selectable = knownVariantIds
    ? new Set(knownVariantIds)
    : null;
  return [...candidates]
    .filter((id) => !selectable || selectable.has(id))
    .sort();
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
