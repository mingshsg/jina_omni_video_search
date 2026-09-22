import { describe, expect, it } from 'vitest';
import {
  groupSearchHits,
  groupSearchHitsTopK,
  oversampleForGroupedTopK,
  type GroupableHit,
} from './group-hits';

function hit(
  overrides: Partial<GroupableHit> & Pick<GroupableHit, 'chunk_id' | 'start_ms'>,
): GroupableHit {
  const start = overrides.start_ms;
  return {
    video_id: 'vid-a',
    variant_id: 'var-1',
    end_ms: start + 10_000,
    start_label: `${start}`,
    end_label: `${start + 10_000}`,
    score: 1,
    ...overrides,
  };
}

describe('groupSearchHits', () => {
  it('keeps distant same-video hits separate when span exceeds 2×window', () => {
    const windowMs = 10_000;
    const groups = groupSearchHits(
      [
        hit({ chunk_id: 'a', start_ms: 0, score: 0.9 }),
        hit({ chunk_id: 'b', start_ms: 25_000, score: 0.8 }),
      ],
      windowMs,
    );
    expect(groups).toHaveLength(2);
  });

  it('merges same-video hits when earliest→latest start ≤ 2×window', () => {
    const windowMs = 10_000; // threshold 20s
    const groups = groupSearchHits(
      [
        hit({ chunk_id: 'a', start_ms: 0, score: 0.5 }),
        hit({ chunk_id: 'b', start_ms: 8_000, score: 0.9 }),
        hit({ chunk_id: 'c', start_ms: 19_000, score: 0.7 }),
      ],
      windowMs,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]!.members.map((m) => m.chunk_id)).toEqual(['a', 'b', 'c']);
    expect(groups[0]!.representative.chunk_id).toBe('b');
    expect(groups[0]!.start_ms).toBe(0);
    expect(groups[0]!.end_ms).toBe(29_000);
  });

  it('never merges hits from different videos', () => {
    const groups = groupSearchHits(
      [
        hit({ chunk_id: 'a', start_ms: 0, video_id: 'v1', score: 0.9 }),
        hit({ chunk_id: 'b', start_ms: 1_000, video_id: 'v2', score: 0.8 }),
      ],
      10_000,
    );
    expect(groups).toHaveLength(2);
  });

  it('orders groups by original rank of the representative', () => {
    const groups = groupSearchHits(
      [
        hit({ chunk_id: 'far', start_ms: 100_000, score: 0.95 }),
        hit({ chunk_id: 'near-a', start_ms: 0, score: 0.5 }),
        hit({ chunk_id: 'near-b', start_ms: 5_000, score: 0.6 }),
      ],
      10_000,
    );
    expect(groups.map((g) => g.representative.chunk_id)).toEqual([
      'far',
      'near-b',
    ]);
  });

  it('top-k truncates to N groups', () => {
    const groups = groupSearchHitsTopK(
      [
        hit({ chunk_id: '1', start_ms: 0, score: 1 }),
        hit({ chunk_id: '2', start_ms: 100_000, score: 0.9 }),
        hit({ chunk_id: '3', start_ms: 200_000, score: 0.8 }),
      ],
      10_000,
      2,
    );
    expect(groups).toHaveLength(2);
  });
});

describe('oversampleForGroupedTopK', () => {
  it('requests more raw hits than group top-k, capped at 100', () => {
    expect(oversampleForGroupedTopK(5)).toBe(50);
    expect(oversampleForGroupedTopK(20)).toBe(100);
    expect(oversampleForGroupedTopK(1)).toBe(10);
  });
});
