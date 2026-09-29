/**
 * Shared types for the server-backed group/ready-variant availability result
 * (todo/39 G1). Pure types only — no server imports, so client components and
 * their pure helpers can import this without pulling in the ES client.
 */

/**
 * `ok` — enumeration succeeded and every distinct group is present.
 * `partial` — enumeration succeeded but the terms aggregation was truncated,
 *   so some existing groups are not in the list.
 * `unavailable` — enumeration failed; `groups` holds starter suggestions only.
 */
export type GroupAvailabilityStatus = 'ok' | 'partial' | 'unavailable';

export type GroupAvailabilityEntry = {
  id: string;
  label: string;
  /** True for the built-in starter suggestions (they may not be indexed yet). */
  suggested: boolean;
  /** Assets whose `meta.group_id` equals this id (any variant status). */
  indexed_assets: number;
  /**
   * Distinct variant ids that have at least one `ready` asset in this group.
   * Empty means no ready video is searchable under any variant for this group.
   */
  ready_variant_ids: string[];
};

export type GroupAvailability = {
  status: GroupAvailabilityStatus;
  groups: GroupAvailabilityEntry[];
  /** Distinct indexed groups (suggestions excluded). */
  total_groups: number;
  truncated: boolean;
  /**
   * Union of the ready variant ids the enumeration actually saw (todo/40 R1).
   * This is the server-backed variant option source: it can include a variant
   * whose only ready asset is older than `/api/library`'s newest-200 window,
   * so the search control can offer it instead of dropping it. Bounded by
   * {@link GROUP_VARIANT_OPTION_MAX}; explicitly requested (selected/looked-up)
   * groups are folded in first so their variants always survive the cap.
   */
  ready_variant_ids: string[];
  /** Fixed public error code, present only when `status === 'unavailable'`. */
  error?: string;
};
