import { describe, expect, it } from 'vitest';
import {
  EXACT_LOOKUP_DEBOUNCE_MS,
  EXACT_LOOKUP_MISS_MIN_LENGTH,
  isStaleExactLookup,
  lookupMissName,
  planExactLookup,
} from './exact-lookup';

describe('planExactLookup (R5)', () => {
  it('clears the lookup for an empty input and invalidates in-flight work', () => {
    expect(planExactLookup({ raw: '', seq: 5 })).toEqual({ action: 'clear' });
    expect(planExactLookup({ raw: '   ', seq: 6 })).toEqual({ action: 'clear' });
  });

  it('does not query for a single character', () => {
    expect(planExactLookup({ raw: 'a', seq: 1 })).toEqual({ action: 'clear' });
  });

  it('debounces a 2+ character name and carries the invalidation seq', () => {
    expect(planExactLookup({ raw: '  demo  ', seq: 3 })).toEqual({
      action: 'debounce',
      name: 'demo',
      seq: 3,
      delayMs: EXACT_LOOKUP_DEBOUNCE_MS,
    });
  });

  it('normalizes NFKC and collapses internal whitespace', () => {
    expect(planExactLookup({ raw: 'ａ  b', seq: 1 })).toMatchObject({
      action: 'debounce',
      name: 'a b',
    });
  });
});

describe('isStaleExactLookup (R5)', () => {
  it('accepts only the newest sequence', () => {
    // A response issued at seq 1 must be discarded once the input advanced to 2.
    expect(isStaleExactLookup(1, 2)).toBe(true);
    expect(isStaleExactLookup(2, 2)).toBe(false);
  });

  it('discards an in-flight response after the input is cleared', () => {
    // Clearing advances the seq (the plan returns `clear`), so the stale
    // response for the old name can no longer repopulate the options.
    const inFlightSeq = 4;
    const clearedSeq = 5;
    expect(isStaleExactLookup(inFlightSeq, clearedSeq)).toBe(true);
  });
});

describe('lookupMissName (R5)', () => {
  it('shows the hint only for a resolved empty lookup of a long-enough name', () => {
    expect(lookupMissName('old-group', [])).toBe('old-group');
    expect(lookupMissName('old-group', [{ id: 'old-group' }])).toBeNull();
    expect(lookupMissName('ab', [])).toBeNull();
    expect('ab'.length < EXACT_LOOKUP_MISS_MIN_LENGTH).toBe(true);
  });
});
