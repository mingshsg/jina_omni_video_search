import { describe, expect, it } from 'vitest';
import { LiveApiError } from './errors';
import { durationTokenToMs } from './duration';
import { buildLiveSearchFilters } from './search-filters';
import type { LiveConfig } from './config';

const cfg = {
  LIVE_SEARCH_MAX_RANGE: '24h',
} as LiveConfig;

describe('durationTokenToMs', () => {
  it('parses common units', () => {
    expect(durationTokenToMs('500ms')).toBe(500);
    expect(durationTokenToMs('2s')).toBe(2000);
    expect(durationTokenToMs('3m')).toBe(180_000);
    expect(durationTokenToMs('24h')).toBe(86_400_000);
    expect(durationTokenToMs('1d')).toBe(86_400_000);
  });
});

describe('buildLiveSearchFilters', () => {
  it('requires variant_id and applies source/session/time filters', () => {
    const filters = buildLiveSearchFilters(
      {
        variantId: 'var-1',
        sourceIds: ['s1', 's2'],
        sessionIds: ['sess-a'],
        from: '2026-09-10T00:00:00.000Z',
        to: '2026-09-10T01:00:00.000Z',
      },
      cfg,
    );
    expect(filters).toEqual(
      expect.arrayContaining([
        { term: { variant_id: 'var-1' } },
        { terms: { source_id: ['s1', 's2'] } },
        { term: { session_id: 'sess-a' } },
        { range: { window_end_at: { gte: '2026-09-10T00:00:00.000Z' } } },
        { range: { window_start_at: { lte: '2026-09-10T01:00:00.000Z' } } },
      ]),
    );
  });

  it('requires session_ids when follow=true', () => {
    expect(() =>
      buildLiveSearchFilters(
        { variantId: 'v', follow: true, sessionIds: [] },
        cfg,
      ),
    ).toThrow(LiveApiError);
  });

  it('rejects inverted or oversized ranges', () => {
    expect(() =>
      buildLiveSearchFilters(
        {
          variantId: 'v',
          from: '2026-09-11T00:00:00.000Z',
          to: '2026-09-10T00:00:00.000Z',
        },
        cfg,
      ),
    ).toThrow(/from must precede to/);

    expect(() =>
      buildLiveSearchFilters(
        {
          variantId: 'v',
          from: '2026-09-01T00:00:00.000Z',
          to: '2026-09-03T00:00:00.000Z',
        },
        cfg,
      ),
    ).toThrow(/LIVE_SEARCH_MAX_RANGE/);
  });
});
