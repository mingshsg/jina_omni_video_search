/**
 * Pure rules for when a search control change may re-run a query (todo/39 G4,
 * corrected by todo/40 R3) and how an out-of-order response is discarded.
 *
 * Decision recorded here (option (b) from todo/40 R3 — a bounded debounce):
 *
 * 1. A filter change only ever re-runs the **last submitted query text**, never
 *    the current draft. Before an explicit Search there is no submitted query,
 *    so a control click cannot spend a request on an unsubmitted draft. This is
 *    what `shouldRerunOnFilterChange` enforces; it is keyed on the text rather
 *    than the boolean the old code used, which is the R3 defect.
 * 2. Rapid changes are coalesced into **one** rerun per burst
 *    (`createFilterRerunScheduler`). Three quick Group clicks therefore spend
 *    one provider request, not three, while a later deliberate change starts a
 *    fresh burst and still refreshes the results.
 *
 * The scheduler is timer-free: the caller supplies the real `setTimeout` and
 * reports back with `onTimerFired()`. That keeps request counts assertable in
 * the `lib/**` Vitest suite, where timers are not observable, and leaves the
 * component with nothing but a trivial schedule/cancel.
 */

export type FilterChangeTrigger = {
  /** The last explicitly submitted query text, or null if none yet. */
  submittedQuery: string | null;
  /** Current query draft as typed. */
  query: string;
  /** Selected variant id ('' = not chosen yet). */
  variantId: string;
};

/** Bounded debounce for a filter-change rerun. */
export const FILTER_RERUN_DEBOUNCE_MS = 300;

/** True when a filter change should re-run the last submitted query. */
export function shouldRerunOnFilterChange(trigger: FilterChangeTrigger): boolean {
  const submitted = trigger.submittedQuery;
  if (submitted === null) return false;
  if (submitted.trim().length === 0) return false;
  // The draft must not have drifted from what was submitted (R3).
  if (submitted !== trigger.query.trim()) return false;
  return trigger.variantId.length > 0;
}

export type FilterRerunDecision =
  | { action: 'none' }
  | { action: 'schedule'; query: string; delayMs: number };

export type FilterRerunFired = { action: 'none' } | { action: 'rerun'; query: string };

/**
 * Coalesce a burst of filter changes into one rerun. A "burst" is a run of
 * changes that arrive before the debounce fires; each burst yields at most one
 * `rerun`. The caller must call `onTimerFired()` exactly once per `schedule`
 * (a re-schedule cancels the previous timer and replaces it).
 */
export function createFilterRerunScheduler(): {
  onFilterChange(trigger: FilterChangeTrigger): FilterRerunDecision;
  onTimerFired(): FilterRerunFired;
  reset(): void;
} {
  let pending: string | null = null;
  return {
    onFilterChange(trigger) {
      if (!shouldRerunOnFilterChange(trigger)) return { action: 'none' };
      const submitted = trigger.submittedQuery as string;
      if (pending === submitted) {
        // Already scheduled by an earlier change in this burst.
        return { action: 'none' };
      }
      pending = submitted;
      return { action: 'schedule', query: submitted, delayMs: FILTER_RERUN_DEBOUNCE_MS };
    },
    onTimerFired() {
      const query = pending;
      pending = null;
      return query === null ? { action: 'none' } : { action: 'rerun', query };
    },
    reset() {
      pending = null;
    },
  };
}

/**
 * Monotonic request sequence. `next()` issues a token; `isCurrent(token)`
 * answers whether a response may still be applied. A superseded token's
 * response is ignored so an older request never overwrites a newer result.
 */
export class SearchRequestGate {
  private current = 0;

  next(): number {
    this.current += 1;
    return this.current;
  }

  isCurrent(token: number): boolean {
    return token === this.current;
  }
}
