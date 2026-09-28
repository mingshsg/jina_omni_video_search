import { describe, expect, it } from 'vitest';
import { heuristicStructureOnly } from './structure';

describe('heuristicStructureOnly', () => {
  it('covers full duration with opening, body, ending', () => {
    const intervals = heuristicStructureOnly(45 * 60_000);
    expect(intervals.map((i) => i.kind)).toEqual([
      'opening_credits',
      'body',
      'ending_credits',
    ]);
    expect(intervals[0].start_ms).toBe(0);
    expect(intervals[intervals.length - 1].end_ms).toBe(45 * 60_000);
    // contiguous half-open coverage
    for (let i = 0; i < intervals.length - 1; i++) {
      expect(intervals[i].end_ms).toBe(intervals[i + 1].start_ms);
    }
  });

  it('handles short clips', () => {
    const intervals = heuristicStructureOnly(60_000);
    expect(intervals[0].kind).toBe('opening_credits');
    expect(intervals.some((i) => i.kind === 'ending_credits')).toBe(true);
  });
});
