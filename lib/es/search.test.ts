import { describe, expect, it } from 'vitest';
import {
  badgeFromRanks,
  clampSearchSize,
  compareOptionalScoresDesc,
  effectiveRankWindowSize,
} from './search';

describe('search helpers', () => {
  it('clamps size to 1..100 with default 20', () => {
    expect(clampSearchSize(undefined)).toBe(20);
    expect(clampSearchSize(0)).toBe(1);
    expect(clampSearchSize(-3)).toBe(1);
    expect(clampSearchSize(50)).toBe(50);
    expect(clampSearchSize(999)).toBe(100);
  });

  it('raises rank_window_size to at least size', () => {
    const cfg = { SEARCH_RANK_WINDOW_SIZE: 50 } as Parameters<
      typeof effectiveRankWindowSize
    >[0];
    expect(effectiveRankWindowSize(cfg, 20)).toBe(50);
    expect(effectiveRankWindowSize(cfg, 80)).toBe(80);
  });

  it('badge rule: dual hit → both', () => {
    expect(badgeFromRanks(1, 3)).toBe('both');
    expect(badgeFromRanks(2, undefined)).toBe('visual');
    expect(badgeFromRanks(undefined, 1)).toBe('audio');
  });

  it('sorts optional knn scores descending with nulls last', () => {
    const rows = [
      { id: 'a', visual: 0.4, rrf: 0.02 },
      { id: 'b', visual: 0.9, rrf: 0.01 },
      { id: 'c', visual: null, rrf: 0.03 },
      { id: 'd', visual: 0.9, rrf: 0.04 },
    ];
    rows.sort((x, y) =>
      compareOptionalScoresDesc(x.visual, y.visual, x.rrf, y.rrf),
    );
    expect(rows.map((r) => r.id)).toEqual(['d', 'b', 'a', 'c']);
  });
});
