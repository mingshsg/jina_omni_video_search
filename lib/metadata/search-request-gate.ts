/**
 * Pure rules for when a search control change may re-run a query (todo/39 G4)
 * and how an out-of-order response is discarded.
 *
 * Decision recorded here: filter changes before the first explicit Search only
 * update filter state. After a query has been submitted, an explicit control
 * change re-runs **that submitted query once** (no debounce timer): the
 * control's own `onChange` fires per discrete selection, and the request gate
 * drops any older in-flight response, so rapid selections never render stale
 * results. A debounce was rejected because it adds a timer whose firing is
 * not observable in this repo's non-browser Vitest include.
 */

export type FilterChangeTrigger = {
  /** True once an explicit Search has run for the current query draft. */
  submitted: boolean;
  /** Current query text as typed. */
  query: string;
  /** Selected variant id ('' = not chosen yet). */
  variantId: string;
};

/** True when a Group/filter change should re-run the last submitted query. */
export function shouldRerunOnFilterChange(trigger: FilterChangeTrigger): boolean {
  return (
    trigger.submitted &&
    trigger.query.trim().length > 0 &&
    trigger.variantId.length > 0
  );
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
