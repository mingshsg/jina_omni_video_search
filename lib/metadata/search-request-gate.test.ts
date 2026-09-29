import { describe, expect, it } from 'vitest';
import {
  createFilterRerunScheduler,
  FILTER_RERUN_DEBOUNCE_MS,
  SearchRequestGate,
  shouldRerunOnFilterChange,
  type FilterChangeTrigger,
} from './search-request-gate';

const submittedCat: FilterChangeTrigger = {
  submittedQuery: 'cat',
  query: 'cat',
  variantId: 'v',
};

describe('shouldRerunOnFilterChange (R3)', () => {
  it('does not run before the first explicit Search', () => {
    expect(
      shouldRerunOnFilterChange({ submittedQuery: null, query: 'cat', variantId: 'v' }),
    ).toBe(false);
  });

  it('re-runs the last submitted query when the draft still matches it', () => {
    expect(shouldRerunOnFilterChange(submittedCat)).toBe(true);
  });

  it('does not submit a changed draft (the R3 defect)', () => {
    // Searched "cat", typed "dog" but did not submit, then changed a filter.
    expect(
      shouldRerunOnFilterChange({
        submittedQuery: 'cat',
        query: 'dog',
        variantId: 'v',
      }),
    ).toBe(false);
  });

  it('requires a submitted query and a variant', () => {
    expect(
      shouldRerunOnFilterChange({ submittedQuery: '   ', query: '   ', variantId: 'v' }),
    ).toBe(false);
    expect(
      shouldRerunOnFilterChange({ submittedQuery: 'cat', query: 'cat', variantId: '' }),
    ).toBe(false);
  });

  it('ignores surrounding whitespace when comparing the draft', () => {
    expect(
      shouldRerunOnFilterChange({
        submittedQuery: 'cat',
        query: '  cat  ',
        variantId: 'v',
      }),
    ).toBe(true);
  });
});

describe('createFilterRerunScheduler (R3 request count)', () => {
  it('spends zero requests before the first Search', () => {
    const scheduler = createFilterRerunScheduler();
    for (const _ of ['demo', 'trailer', 'demo,trailer']) {
      expect(
        scheduler.onFilterChange({ submittedQuery: null, query: 'cat', variantId: 'v' }),
      ).toEqual({ action: 'none' });
    }
    // No timer was ever armed, so firing is a no-op.
    expect(scheduler.onTimerFired()).toEqual({ action: 'none' });
  });

  it('coalesces three rapid selections into one request', () => {
    const scheduler = createFilterRerunScheduler();
    const selections = ['demo', 'trailer', 'demo,trailer'];
    let timers = 0;
    for (const _ of selections) {
      const decision = scheduler.onFilterChange(submittedCat);
      if (decision.action === 'schedule') {
        timers += 1;
        expect(decision.delayMs).toBe(FILTER_RERUN_DEBOUNCE_MS);
      }
    }
    // Only the first click in the burst arms a timer; the other two coalesce.
    expect(timers).toBe(1);
    expect(scheduler.onTimerFired()).toEqual({ action: 'rerun', query: 'cat' });
  });

  it('starts a fresh burst for the same query after a deliberate later change', () => {
    const scheduler = createFilterRerunScheduler();
    scheduler.onFilterChange(submittedCat);
    expect(scheduler.onTimerFired()).toEqual({ action: 'rerun', query: 'cat' });
    // A later change is a new burst and refreshes the results again.
    expect(scheduler.onFilterChange(submittedCat)).toEqual({
      action: 'schedule',
      query: 'cat',
      delayMs: FILTER_RERUN_DEBOUNCE_MS,
    });
    expect(scheduler.onTimerFired()).toEqual({ action: 'rerun', query: 'cat' });
  });

  it('does not schedule for a changed draft and re-runs once the draft is submitted', () => {
    const scheduler = createFilterRerunScheduler();
    expect(
      scheduler.onFilterChange({ submittedQuery: 'cat', query: 'dog', variantId: 'v' }),
    ).toEqual({ action: 'none' });
    expect(scheduler.onTimerFired()).toEqual({ action: 'none' });
    // The caller submits "dog"; a click now schedules that submitted query.
    expect(
      scheduler.onFilterChange({ submittedQuery: 'dog', query: 'dog', variantId: 'v' }),
    ).toMatchObject({ action: 'schedule', query: 'dog' });
    expect(scheduler.onTimerFired()).toEqual({ action: 'rerun', query: 'dog' });
  });

  it('a timer fire without a pending schedule is a no-op', () => {
    const scheduler = createFilterRerunScheduler();
    expect(scheduler.onTimerFired()).toEqual({ action: 'none' });
  });

  it('a re-schedule replaces the pending query rather than queueing two runs', () => {
    const scheduler = createFilterRerunScheduler();
    scheduler.onFilterChange(submittedCat);
    scheduler.onFilterChange({ submittedQuery: 'dog', query: 'dog', variantId: 'v' });
    // Firing once yields the latest scheduled query; a second fire is empty.
    expect(scheduler.onTimerFired()).toEqual({ action: 'rerun', query: 'dog' });
    expect(scheduler.onTimerFired()).toEqual({ action: 'none' });
  });
});

describe('SearchRequestGate (G4 stale responses)', () => {
  it('accepts only the newest token', () => {
    const gate = new SearchRequestGate();
    const first = gate.next();
    const second = gate.next();
    expect(gate.isCurrent(first)).toBe(false);
    expect(gate.isCurrent(second)).toBe(true);
  });

  it('treats an out-of-order response as stale', () => {
    const gate = new SearchRequestGate();
    const older = gate.next();
    gate.next(); // a newer request was issued while the older was in flight
    // The older response arrives late — it must not be applied.
    expect(gate.isCurrent(older)).toBe(false);
  });

  it('keeps an in-flight response current until a newer one starts', () => {
    const gate = new SearchRequestGate();
    const only = gate.next();
    expect(gate.isCurrent(only)).toBe(true);
  });
});
