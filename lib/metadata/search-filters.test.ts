import { describe, expect, it, beforeAll } from 'vitest';
import { loadPeopleCatalog } from './people';
import {
  buildAssetEligibilityFilters,
  buildChunkFilters,
  hasActiveFilters,
  interpretEligibleTotal,
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

  it('normalizes country, language, tags and validates catalogs', () => {
    const f = parseSearchFilters({
      year_from: 1960,
      year_to: 1965,
      actor_ids: ['person:audrey-hepburn'],
      country: ['us'],
      primary_language: ['zh-hans'],
      video_type: ['trailer'],
      tags: ['Fashion'],
    });
    expect(f).toEqual({
      year_from: 1960,
      year_to: 1965,
      actor_ids: ['person:audrey-hepburn'],
      country: ['US'],
      primary_language: ['zh-Hans'],
      video_type: ['trailer'],
      tags_key: ['fashion'],
    });
    expect(hasActiveFilters(f)).toBe(true);
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
      },
      null,
    );
    expect(clauses[0]).toHaveProperty('nested');
    expect(JSON.stringify(clauses)).toContain('meta.actor_ids');
    expect(JSON.stringify(clauses)).toContain('meta.year');
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
