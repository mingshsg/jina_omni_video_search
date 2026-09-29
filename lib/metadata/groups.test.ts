import { beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeGroupId } from './catalogs';
import { inferGroupFromVariants, parseFreeformGroupId } from './groups';

const mocks = vi.hoisted(() => ({ search: vi.fn() }));

vi.mock('../es/client', () => ({ getEsClient: () => ({ search: mocks.search }) }));
vi.mock('../config', () => ({
  getConfig: () => ({ ES_INDEX_ASSETS: 'video-assets' }),
}));

import { GROUP_CATALOG_TERMS_SIZE, listGroupCatalogResult } from './groups';

describe('normalizeGroupId / parseFreeformGroupId', () => {
  it('trims and collapses spaces', () => {
    expect(normalizeGroupId('  my   set  ')).toBe('my set');
    expect(parseFreeformGroupId('  trailer ')).toBe('trailer');
  });

  it('rejects empty and over-long names', () => {
    expect(normalizeGroupId('   ')).toBeNull();
    expect(() => parseFreeformGroupId('')).toThrow(/empty/);
    expect(() => parseFreeformGroupId('x'.repeat(65))).toThrow(/exceeds/);
  });
});

describe('inferGroupFromVariants', () => {
  it('maps fine / 10s → trailer and 2s → demo', () => {
    expect(
      inferGroupFromVariants([{ chunk_preset: 'fine', chunk_window_ms: 10_000 }]),
    ).toBe('trailer');
    expect(
      inferGroupFromVariants([{ chunk_preset: '2s', chunk_window_ms: 2_000 }]),
    ).toBe('demo');
    expect(inferGroupFromVariants([{ chunk_window_ms: 10_000 }])).toBe(
      'trailer',
    );
    expect(inferGroupFromVariants([{ chunk_window_ms: 2_000 }])).toBe('demo');
  });

  it('prefers demo when both windows are present', () => {
    expect(
      inferGroupFromVariants([
        { chunk_preset: 'fine', chunk_window_ms: 10_000 },
        { chunk_preset: '2s', chunk_window_ms: 2_000 },
      ]),
    ).toBe('demo');
  });

  it('returns null for unrelated presets', () => {
    expect(
      inferGroupFromVariants([{ chunk_preset: '30s', chunk_window_ms: 30_000 }]),
    ).toBeNull();
    expect(inferGroupFromVariants([])).toBeNull();
  });
});

describe('listGroupCatalogResult (G3/G5)', () => {
  beforeEach(() => {
    mocks.search.mockReset();
  });

  it('reports ok with starter suggestions plus stored groups', async () => {
    mocks.search.mockResolvedValue({
      aggregations: {
        groups: { buckets: [{ key: 'drama' }, { key: 'trailer' }], sum_other_doc_count: 0 },
        distinct_groups: { value: 2 },
      },
    });

    const result = await listGroupCatalogResult();
    expect(result.status).toBe('ok');
    expect(result.truncated).toBe(false);
    expect(result.entries.map((e) => e.id)).toEqual(
      expect.arrayContaining(['trailer', 'demo', 'drama']),
    );
    // `trailer` is a starter; it keeps its localized suggestion label.
    expect(result.entries.find((e) => e.id === 'trailer')?.label).toBe('trailer');
    const request = mocks.search.mock.calls[0]?.[0];
    expect(request.aggs.groups.terms.size).toBe(GROUP_CATALOG_TERMS_SIZE);
  });

  it('marks the catalog partial when the terms aggregation truncates', async () => {
    mocks.search.mockResolvedValue({
      aggregations: {
        groups: { buckets: [{ key: 'a' }], sum_other_doc_count: 3 },
        distinct_groups: { value: 4 },
      },
    });

    const result = await listGroupCatalogResult();
    expect(result.status).toBe('partial');
    expect(result.truncated).toBe(true);
    expect(result.total_groups).toBe(4);
  });

  it('returns an explicit unavailable status with suggestions and a redacted error', async () => {
    mocks.search.mockRejectedValue(
      new Error('ES down: ApiKey secret.value'),
    );

    const result = await listGroupCatalogResult();
    expect(result.status).toBe('unavailable');
    expect(result.error).toContain('[redacted]');
    expect(result.error).not.toContain('secret.value');
    expect(result.entries.map((e) => e.id)).toEqual(
      expect.arrayContaining(['trailer', 'demo']),
    );
  });
});
