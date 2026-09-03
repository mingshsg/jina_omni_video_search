import { describe, expect, it } from 'vitest';
import { planChunks } from './plan-chunks';

describe('planChunks', () => {
  const standard = {
    windowMs: 64_000,
    overlapMs: 4_000,
    minMs: 4_000,
  };

  it('returns one window when video is shorter than window', () => {
    const windows = planChunks({ durationMs: 30_000, ...standard });
    expect(windows).toEqual([
      { chunk_index: 0, start_ms: 0, end_ms: 30_000 },
    ]);
  });

  it('plans exact multiples without trailing merge', () => {
    const windows = planChunks({ durationMs: 120_000, ...standard });
    expect(windows).toEqual([
      { chunk_index: 0, start_ms: 0, end_ms: 64_000 },
      { chunk_index: 1, start_ms: 60_000, end_ms: 120_000 },
    ]);
  });

  it('merges trailing remainder shorter than CHUNK_MIN_MS into previous window', () => {
    const windows = planChunks({ durationMs: 123_000, ...standard });
    expect(windows).toHaveLength(2);
    expect(windows[0]).toEqual({
      chunk_index: 0,
      start_ms: 0,
      end_ms: 64_000,
    });
    expect(windows[1]).toEqual({
      chunk_index: 1,
      start_ms: 60_000,
      end_ms: 123_000,
    });
    expect(windows[1]!.end_ms - windows[1]!.start_ms).toBe(63_000);
  });

  it('keeps trailing window when it meets minMs', () => {
    const windows = planChunks({ durationMs: 125_000, ...standard });
    expect(windows).toHaveLength(3);
    expect(windows[2]).toEqual({
      chunk_index: 2,
      start_ms: 120_000,
      end_ms: 125_000,
    });
    expect(windows[2]!.end_ms - windows[2]!.start_ms).toBe(5_000);
  });

  it('returns empty array for zero duration', () => {
    expect(planChunks({ durationMs: 0, ...standard })).toEqual([]);
  });
});
