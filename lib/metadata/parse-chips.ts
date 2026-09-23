/**
 * Derives the search page's extracted-facet chip state from the search
 * response's `meta.parse` fields plus local UI state (hand-selected
 * facets, client-side suppressions). Pure and side-effect free so it is
 * unit-testable from `lib/` (see AGENTS.md trap #6 — `app/` is not
 * collected by vitest.config.ts).
 *
 * See plan/05-parse-chip-state-model.md for the design rationale. In
 * short: a chip is rendered for every value in `extracted` (never for a
 * value that failed catalog/range validation and therefore never reached
 * `extracted`), and its status explains *why* "Use as filter" is or is
 * not the useful action right now — status is derived, never stored.
 */

export type ParseChipField = 'actor_ids' | 'country' | 'video_type' | 'year';

/**
 * Precedence (top wins) — see plan §Decisions #1:
 *   suppressed > hard_filter > filter_mode > hybrid_off >
 *   snapshot_unavailable > no_effect > boosting
 *
 * `no_effect` means the facet matched zero fusion candidates this
 * request — a boost can only re-rank the candidate pool, so this is
 * exactly the situation where "Use as filter" (which re-enumerates the
 * catalog, see plan §D) is most useful, not least.
 */
export type ParseChipStatus =
  | 'suppressed'
  | 'hard_filter'
  | 'filter_mode'
  | 'hybrid_off'
  | 'snapshot_unavailable'
  | 'no_effect'
  | 'boosting';

export type ParseChipAction = 'promote' | 'dismiss' | 'restore';

export interface ParseChip {
  key: string;
  field: ParseChipField;
  label: string;
  /** Value to write into hand-selected facets when promoted (year uses the extracted range directly). */
  promoteValue?: string;
  status: ParseChipStatus;
  actions: ParseChipAction[];
}

export interface ExtractedFacets {
  actor_ids?: string[];
  year_from?: number;
  year_to?: number;
  country?: string[];
  video_type?: string[];
}

export interface RejectedEntry {
  field: string;
  value: string;
  reason: string;
}

/** Current hand-selected (server-hard-filtered) facet state, field-level. */
export interface HandFacetState {
  actor_ids: string[];
  country: string;
  video_type: string;
  year_from: string;
  year_to: string;
}

export interface DeriveParseChipsParams {
  extracted: ExtractedFacets | null | undefined;
  /** `meta.parse.applied` from the search response. */
  applied: ExtractedFacets | null | undefined;
  /** `meta.parse.rejected` from the search response. */
  rejected: RejectedEntry[] | null | undefined;
  /** `meta.parse.facet_mode` — `'filter'` means the deployment scores no boosts at all. */
  facetMode: string | null | undefined;
  handFacets: HandFacetState;
  /** Client-side suppressed keys: `field` or `field:value` (year is always field-level). */
  suppressed: string[] | null | undefined;
}

const ACTIONS: Record<ParseChipStatus, ParseChipAction[]> = {
  suppressed: ['restore'],
  hard_filter: [],
  filter_mode: [],
  hybrid_off: ['promote'],
  snapshot_unavailable: ['promote', 'dismiss'],
  no_effect: ['promote', 'dismiss'],
  boosting: ['promote', 'dismiss'],
};

/** Builds the suppress key sent between UI state and this module. */
export function suppressKeyFor(field: ParseChipField, value?: string): string {
  if (field === 'year' || value == null) return field;
  return `${field}:${value}`;
}

/** Field portion of a suppress key — what today's server API accepts. */
export function suppressKeyField(key: string): string {
  const idx = key.indexOf(':');
  return idx === -1 ? key : key.slice(0, idx);
}

function isSuppressed(
  suppressedSet: Set<string>,
  field: ParseChipField,
  value: string | undefined,
): boolean {
  if (suppressedSet.has(field)) return true;
  if (value != null && suppressedSet.has(`${field}:${value}`)) return true;
  return false;
}

function findReason(
  rejected: RejectedEntry[],
  field: ParseChipField,
  value: string | undefined,
): string | undefined {
  if (field === 'year') {
    // `no_effect` / `snapshot_unavailable` report a single combined `year`
    // entry (lib/es/hybrid-fusion.ts); `hybrid_text_required` reports
    // `year_from` / `year_to` separately (app/api/search/route.ts). One
    // chip covers both shapes.
    return rejected.find(
      (r) => r.field === 'year' || r.field === 'year_from' || r.field === 'year_to',
    )?.reason;
  }
  return rejected.find((r) => r.field === field && r.value === value)?.reason;
}

function statusFor(
  field: ParseChipField,
  value: string | undefined,
  opts: {
    isHandFiltered: boolean;
    inApplied: boolean;
    facetMode: string | null | undefined;
    suppressedSet: Set<string>;
    rejected: RejectedEntry[];
  },
): ParseChipStatus {
  if (isSuppressed(opts.suppressedSet, field, value)) return 'suppressed';
  // Field-level, mirroring lib/metadata/query-parse.ts#boostsMinusHardFilters:
  // any hand-selected value on a field drops the *whole* field's boost.
  if (opts.isHandFiltered) return 'hard_filter';
  if (opts.facetMode === 'filter') return 'filter_mode';
  const reason = findReason(opts.rejected, field, value);
  if (reason === 'hybrid_text_required') return 'hybrid_off';
  if (reason === 'snapshot_unavailable') return 'snapshot_unavailable';
  if (reason === 'no_effect') return 'no_effect';
  if (opts.inApplied) return 'boosting';
  // No rejected entry and not (yet) in `applied`: treat conservatively as
  // no_effect rather than implying a boost that may not have landed.
  return 'no_effect';
}

export function deriveParseChips(params: DeriveParseChipsParams): ParseChip[] {
  const extracted = params.extracted;
  if (!extracted) return [];
  const applied = params.applied ?? {};
  const rejected = params.rejected ?? [];
  const suppressedSet = new Set(params.suppressed ?? []);
  const handFacets = params.handFacets;
  const facetMode = params.facetMode;

  const inAppliedActors = new Set(applied.actor_ids ?? []);
  const inAppliedCountry = new Set(applied.country ?? []);
  const inAppliedType = new Set(applied.video_type ?? []);
  const handActorFiltered = handFacets.actor_ids.length > 0;
  const handCountryFiltered = handFacets.country !== '';
  const handTypeFiltered = handFacets.video_type !== '';
  const handYearFiltered =
    handFacets.year_from.trim() !== '' || handFacets.year_to.trim() !== '';

  const build = (
    key: string,
    field: ParseChipField,
    value: string | undefined,
    label: string,
    promoteValue: string | undefined,
    isHandFiltered: boolean,
    inApplied: boolean,
  ): ParseChip => {
    const status = statusFor(field, value, {
      isHandFiltered,
      inApplied,
      facetMode,
      suppressedSet,
      rejected,
    });
    return { key, field, label, promoteValue, status, actions: ACTIONS[status] };
  };

  const chips: ParseChip[] = [];
  for (const id of extracted.actor_ids ?? []) {
    chips.push(
      build(`actor-${id}`, 'actor_ids', id, id, id, handActorFiltered, inAppliedActors.has(id)),
    );
  }
  for (const c of extracted.country ?? []) {
    chips.push(
      build(`country-${c}`, 'country', c, c, c, handCountryFiltered, inAppliedCountry.has(c)),
    );
  }
  for (const vt of extracted.video_type ?? []) {
    chips.push(
      build(`type-${vt}`, 'video_type', vt, vt, vt, handTypeFiltered, inAppliedType.has(vt)),
    );
  }
  if (extracted.year_from != null || extracted.year_to != null) {
    const from = extracted.year_from;
    const to = extracted.year_to;
    const label =
      from != null && to != null && from !== to
        ? `${from}\u2013${to}`
        : String(from ?? to);
    const inApplied =
      (from != null && applied.year_from === from) ||
      (to != null && applied.year_to === to);
    chips.push(
      build(`year-${label}`, 'year', undefined, label, undefined, handYearFiltered, inApplied),
    );
  }
  return chips;
}
