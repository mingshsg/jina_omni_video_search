import { describe, expect, it, beforeAll } from 'vitest';
import { loadPeopleCatalog } from './people';
import {
  buildAssetEligibilityFilters,
  buildChunkFilters,
  hasActiveFilters,
  interpretEligibleTotal,
  isValidYearRange,
  parseSearchFilters,
  searchFiltersSchema,
  SearchFilterError,
} from './search-filters';

describe('searchFiltersSchema', () => {
  // Regression: app/api/search/image/route.ts embeds this schema directly
  // as a request-body field and, for the "no filters selected" multipart
  // case, always sends an explicit `null` (FormData has no absent-vs-null
  // distinction once its parser normalizes a missing field) — `.optional()`
  // alone only tolerates `undefined` and 400'd every filter-less image
  // search with "filters: Expected object, received null".
  it('accepts null as well as undefined (image-search always sends null, never omits the key)', () => {
    expect(searchFiltersSchema.safeParse(null).success).toBe(true);
    expect(searchFiltersSchema.safeParse(undefined).success).toBe(true);
  });

  it('still rejects a non-object, non-null filters value', () => {
    expect(searchFiltersSchema.safeParse('nope').success).toBe(false);
    expect(searchFiltersSchema.safeParse(42).success).toBe(false);
  });
});

describe('parseSearchFilters', () => {
  beforeAll(() => {
    loadPeopleCatalog(true);
  });

  it('returns null for empty / omitted filters', () => {
    expect(parseSearchFilters(undefined)).toBeNull();
    expect(parseSearchFilters(null)).toBeNull();
    expect(parseSearchFilters({})).toBeNull();
  });

  it('normalizes country, language, tags, group and validates catalogs', () => {
    const f = parseSearchFilters({
      year_from: 1960,
      year_to: 1965,
      actor_ids: ['person:audrey-hepburn'],
      country: ['us'],
      primary_language: ['zh-hans'],
      video_type: ['trailer'],
      tags: ['Fashion'],
      group_id: ['  my set  '],
    });
    expect(f).toEqual({
      year_from: 1960,
      year_to: 1965,
      actor_ids: ['person:audrey-hepburn'],
      country: ['US'],
      primary_language: ['zh-Hans'],
      video_type: ['trailer'],
      tags_key: ['fashion'],
      group_id: ['my set'],
    });
    expect(hasActiveFilters(f)).toBe(true);
  });

  it('isValidYearRange only rejects an inverted pair with both bounds set (todo/22 F7)', () => {
    expect(isValidYearRange(1960, 1965)).toBe(true);
    expect(isValidYearRange(1965, 1965)).toBe(true);
    expect(isValidYearRange(undefined, 1965)).toBe(true);
    expect(isValidYearRange(1965, undefined)).toBe(true);
    expect(isValidYearRange(undefined, undefined)).toBe(true);
    // This is the shape app/api/search/route.ts's filter-mode merge can
    // produce: an already-valid request range narrowed by a non-overlapping
    // extracted year leaves year_from > year_to.
    expect(isValidYearRange(2000, 1990)).toBe(false);
  });

  it('rejects reversed year range and unknown actor / country', () => {
    expect(() =>
      parseSearchFilters({ year_from: 2000, year_to: 1990 }),
    ).toThrow(SearchFilterError);
    expect(() =>
      parseSearchFilters({ actor_ids: ['person:nobody'] }),
    ).toThrow(/Unknown actor/);
    expect(() => parseSearchFilters({ country: ['XX'] })).toThrow(
      /Country\/region/,
    );
    expect(() =>
      parseSearchFilters({ group_id: ['x'.repeat(65)] }),
    ).toThrow(/group_id|at most 64/i);
  });

  // G2 (todo/39): the control caps at 20 selected groups to match this bound.
  // The 21st selection must be blocked client-side; if it ever reaches the
  // server it is a 400, which this test pins as the contract the UI mirrors.
  it('accepts 20 group ids and rejects 21 at the schema bound', () => {
    const twenty = Array.from({ length: 20 }, (_, i) => `group-${i}`);
    expect(searchFiltersSchema.safeParse({ group_id: twenty }).success).toBe(true);
    expect(parseSearchFilters({ group_id: twenty })?.group_id).toHaveLength(20);

    const twentyOne = [...twenty, 'group-20'];
    expect(searchFiltersSchema.safeParse({ group_id: twentyOne }).success).toBe(
      false,
    );
    expect(() => parseSearchFilters({ group_id: twentyOne })).toThrow(
      SearchFilterError,
    );
  });
});

describe('interpretEligibleTotal', () => {
  it('accepts exact 10000 and rejects 10001 even when relation=eq', () => {
    expect(
      interpretEligibleTotal({
        totalHits: { value: 10_000, relation: 'eq' },
        hitCount: 10_000,
      }),
    ).toEqual({ total: 10_000, overflow: false, ambiguous: false });

    expect(
      interpretEligibleTotal({
        totalHits: { value: 10_001, relation: 'eq' },
        hitCount: 10_000,
      }).overflow,
    ).toBe(true);
  });

  it('rejects gte at the tracking threshold and larger', () => {
    expect(
      interpretEligibleTotal({
        totalHits: { value: 10_001, relation: 'gte' },
        hitCount: 10_000,
      }).overflow,
    ).toBe(true);
    expect(
      interpretEligibleTotal({
        totalHits: { value: 10_000, relation: 'gte' },
        hitCount: 10_000,
      }).overflow,
    ).toBe(true);
  });

  it('fails closed when total is missing and the page is full', () => {
    expect(
      interpretEligibleTotal({
        totalHits: undefined,
        hitCount: 10_000,
      }).overflow,
    ).toBe(true);
    expect(
      interpretEligibleTotal({
        totalHits: undefined,
        hitCount: 3,
      }),
    ).toEqual({ total: 3, overflow: false, ambiguous: true });
  });
});

describe('eligibility filter builders', () => {
  it('requires nested ready variant and ANDs facets / ANY within arrays', () => {
    const clauses = buildAssetEligibilityFilters(
      'var1',
      {
        year_from: 1960,
        year_to: 1965,
        actor_ids: ['person:a', 'person:b'],
        country: ['US', 'KR'],
        group_id: ['demo'],
      },
      null,
    );
    expect(clauses[0]).toHaveProperty('nested');
    expect(JSON.stringify(clauses)).toContain('meta.actor_ids');
    expect(JSON.stringify(clauses)).toContain('meta.year');
    expect(JSON.stringify(clauses)).toContain('meta.group_id');
  });

  it('builds chunk filters with optional ID allow-list', () => {
    const filters = buildChunkFilters({
      variantId: 'v',
      eligibleVideoIds: ['a', 'b'],
    });
    expect(filters).toEqual([
      { term: { variant_id: 'v' } },
      { terms: { video_id: ['a', 'b'] } },
    ]);
  });
});
