import { describe, expect, it } from 'vitest';
import { groupCatalogUnavailable, peopleCatalogUnavailable } from './catalogs-status';

describe('peopleCatalogUnavailable (R4)', () => {
  it('flags the explicit unavailable status both actor clients read', () => {
    expect(peopleCatalogUnavailable({ people_status: 'unavailable' })).toBe(true);
  });

  it('does not flag a healthy or absent status', () => {
    expect(peopleCatalogUnavailable({ people_status: 'ok' })).toBe(false);
    // Backward compatible with a response that predates the field.
    expect(peopleCatalogUnavailable({})).toBe(false);
    expect(peopleCatalogUnavailable(null)).toBe(false);
  });

  it('treats an empty people list with status ok as genuinely empty, not a failure', () => {
    const body = { people_status: 'ok' as const, people: [] };
    expect(peopleCatalogUnavailable(body)).toBe(false);
  });
});

describe('groupCatalogUnavailable (R4)', () => {
  it('flags only the unavailable status', () => {
    expect(groupCatalogUnavailable('unavailable')).toBe(true);
    expect(groupCatalogUnavailable('partial')).toBe(false);
    expect(groupCatalogUnavailable('ok')).toBe(false);
    expect(groupCatalogUnavailable(undefined)).toBe(false);
  });
});
