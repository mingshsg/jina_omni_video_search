import { describe, expect, it } from 'vitest';
import {
  SearchRequestGate,
  shouldRerunOnFilterChange,
} from './search-request-gate';

describe('shouldRerunOnFilterChange (G4)', () => {
  it('does not run before the first explicit Search', () => {
    expect(
      shouldRerunOnFilterChange({ submitted: false, query: 'cat', variantId: 'v' }),
    ).toBe(false);
  });

  it('re-runs a previously submitted query on a filter change', () => {
    expect(
      shouldRerunOnFilterChange({ submitted: true, query: 'cat', variantId: 'v' }),
    ).toBe(true);
  });

  it('requires text and a variant after submission', () => {
    expect(
      shouldRerunOnFilterChange({ submitted: true, query: '   ', variantId: 'v' }),
    ).toBe(false);
    expect(
      shouldRerunOnFilterChange({ submitted: true, query: 'cat', variantId: '' }),
    ).toBe(false);
  });

  it('models rapid selections as one request per control change, none before submit', () => {
    let requests = 0;
    const selections = ['demo', 'trailer', 'demo,trailer'];

    for (const _ of selections) {
      if (shouldRerunOnFilterChange({ submitted: false, query: 'cat', variantId: 'v' })) {
        requests += 1;
      }
    }
    expect(requests).toBe(0);

    for (const _ of selections) {
      if (shouldRerunOnFilterChange({ submitted: true, query: 'cat', variantId: 'v' })) {
        requests += 1;
      }
    }
    expect(requests).toBe(selections.length);
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
