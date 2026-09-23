import { describe, expect, it } from 'vitest';
import {
  EMPTY_FACETS,
  facetsToApiFilters,
  type SearchFacetState,
} from './facets-ui';

describe('facetsToApiFilters', () => {
  it('returns filters for valid years', () => {
    const facets: SearchFacetState = {
      ...EMPTY_FACETS,
      year_from: '1960',
      year_to: '1965',
      country: 'US',
    };
    const result = facetsToApiFilters(facets);
    expect(result).toEqual({
      ok: true,
      filters: { year_from: 1960, year_to: 1965, country: ['US'] },
    });
  });

  it('does not silently drop a non-integer year', () => {
    const result = facetsToApiFilters({
      ...EMPTY_FACETS,
      year_from: '1960.5',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/whole number/i);
    }
  });

  it('rejects reversed year bounds', () => {
    const result = facetsToApiFilters({
      ...EMPTY_FACETS,
      year_from: '2000',
      year_to: '1990',
    });
    expect(result.ok).toBe(false);
  });
});
