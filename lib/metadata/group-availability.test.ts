import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  search: vi.fn(),
}));

vi.mock('../es/client', () => ({ getEsClient: () => ({ search: mocks.search }) }));
vi.mock('../config', () => ({
  getConfig: () => ({ ES_INDEX_ASSETS: 'video-assets' }),
}));

import { GROUP_TERMS_SIZE, listGroupAvailability } from './group-availability';
import { GROUP_SELECTION_LIMIT } from './group-availability-ui';

/** Minimal aggregation response with one bucket per group. */
function aggResponse(
  groups: Array<{
    id: string;
    count: number;
    readyVariants: string[];
  }>,
  extra: { sumOtherDocCount?: number; distinctGroups?: number } = {},
) {
  return {
    aggregations: {
      groups: {
        buckets: groups.map((g) => ({
          key: g.id,
          doc_count: g.count,
          variants: {
            ready: {
              variant_ids: {
                buckets: g.readyVariants.map((v) => ({ key: v })),
              },
            },
          },
        })),
        sum_other_doc_count: extra.sumOtherDocCount ?? 0,
      },
      distinct_groups: {
        value: extra.distinctGroups ?? groups.length,
      },
    },
  };
}

describe('listGroupAvailability (G1/G5)', () => {
  beforeEach(() => {
    mocks.search.mockReset();
  });

  it('reports ready variants per group and keeps ready/unready distinct', async () => {
    mocks.search.mockResolvedValue(
      aggResponse([
        { id: 'trailer', count: 3, readyVariants: ['var-fine'] },
        { id: 'demo', count: 1, readyVariants: ['var-2s', 'var-30s'] },
        { id: 'pending-only', count: 2, readyVariants: [] },
      ]),
    );

    const result = await listGroupAvailability();

    expect(result.status).toBe('ok');
    expect(result.truncated).toBe(false);
    expect(result.total_groups).toBe(3);
    const byId = new Map(result.groups.map((g) => [g.id, g]));
    expect(byId.get('trailer')?.ready_variant_ids).toEqual(['var-fine']);
    expect(byId.get('demo')?.ready_variant_ids).toEqual(['var-2s', 'var-30s']);
    // A genuinely empty group (indexed but no ready assets) is visible and
    // has no compatible variant rather than being dropped.
    expect(byId.get('pending-only')?.ready_variant_ids).toEqual([]);
    // A starter suggestion that is also indexed keeps its suggestion label
    // but carries the real index counts.
    expect(byId.get('trailer')?.suggested).toBe(true);
    expect(byId.get('trailer')?.indexed_assets).toBe(3);
    // A non-starter group is not a suggestion.
    expect(byId.get('pending-only')?.suggested).toBe(false);
    expect(
      result.groups.find((g) => g.id === 'demo')?.label,
    ).toBe('demo');
  });

  it('labels starter suggestions when the group is not yet indexed', async () => {
    mocks.search.mockResolvedValue(aggResponse([]));

    const result = await listGroupAvailability({ locale: 'zh' });
    const trailer = result.groups.find((g) => g.id === 'trailer');
    expect(trailer?.suggested).toBe(true);
    expect(trailer?.indexed_assets).toBe(0);
    expect(trailer?.ready_variant_ids).toEqual([]);
  });

  it('marks the catalog partial when the terms aggregation truncates', async () => {
    mocks.search.mockResolvedValue(
      aggResponse([{ id: 'a', count: 1, readyVariants: ['v'] }], {
        sumOtherDocCount: 5,
        distinctGroups: 6,
      }),
    );

    const result = await listGroupAvailability();
    expect(result.status).toBe('partial');
    expect(result.truncated).toBe(true);
    expect(result.total_groups).toBe(6);
  });

  it('includes selected ids beyond the top-N via a bounded include terms agg', async () => {
    mocks.search.mockResolvedValue({
      aggregations: {
        groups: {
          buckets: [{ key: 'common', doc_count: 9 }],
          sum_other_doc_count: 0,
        },
        requested: {
          buckets: [
            {
              key: 'rare-old-group',
              doc_count: 1,
              variants: { ready: { variant_ids: { buckets: [{ key: 'var-old' }] } } },
            },
          ],
        },
        distinct_groups: { value: 2 },
      },
    });

    const result = await listGroupAvailability({ includeIds: ['rare-old-group'] });
    const request = mocks.search.mock.calls[0]?.[0];
    expect(request.aggs.requested.terms.include).toEqual(['rare-old-group']);
    expect(request.aggs.groups.terms.size).toBe(GROUP_TERMS_SIZE);
    expect(result.groups.find((g) => g.id === 'rare-old-group')?.ready_variant_ids).toEqual([
      'var-old',
    ]);
  });

  it('fails soft to suggestions with an unavailable status and a fixed public code', async () => {
    mocks.search.mockRejectedValue(
      new Error('connect ECONNREFUSED Authorization: ApiKey abc.def'),
    );

    const logs: string[] = [];
    const result = await listGroupAvailability({ log: (m) => logs.push(m) });

    expect(result.status).toBe('unavailable');
    // R4: only a fixed code in the response; the detail is logged, redacted.
    expect(result.error).toBe('GROUP_AVAILABILITY_UNAVAILABLE');
    expect(result.error).not.toContain('abc.def');
    expect(logs.join(' ')).toContain('[redacted]');
    expect(logs.join(' ')).not.toContain('abc.def');
    expect(result.ready_variant_ids).toEqual([]);
    // All stays usable: the starter suggestions are still returned.
    expect(result.groups.map((g) => g.id)).toEqual(
      expect.arrayContaining(['trailer', 'demo']),
    );
  });

  it('returns the server-backed ready variant option source (R1)', async () => {
    mocks.search.mockResolvedValue(
      aggResponse([
        { id: 'recent', count: 5, readyVariants: ['var-new'] },
        { id: 'old-group', count: 1, readyVariants: ['var-old'] },
      ]),
    );

    const result = await listGroupAvailability();

    expect(result.ready_variant_ids).toEqual(
      expect.arrayContaining(['var-new', 'var-old']),
    );
  });

  it('folds explicitly requested (selected) groups into the variant options', async () => {
    // The top-N terms agg truncated and does not contain the rare group; the
    // bounded `requested` terms agg returns it. Its variant must still be in
    // the option source so the selected group stays switchable (R1).
    mocks.search.mockResolvedValue({
      aggregations: {
        groups: {
          buckets: [
            {
              key: 'common',
              doc_count: 9,
              variants: { ready: { variant_ids: { buckets: [{ key: 'var-new' }] } } },
            },
          ],
          sum_other_doc_count: 4,
        },
        requested: {
          buckets: [
            {
              key: 'rare-old-group',
              doc_count: 1,
              variants: { ready: { variant_ids: { buckets: [{ key: 'var-old' }] } } },
            },
          ],
        },
        distinct_groups: { value: 5 },
      },
    });

    const result = await listGroupAvailability({ includeIds: ['rare-old-group'] });

    expect(result.status).toBe('partial');
    expect(result.ready_variant_ids).toContain('var-old');
  });

  it('offers an older group variant absent from the newest-200 library page (R1)', async () => {
    // 201 newer assets in 200 newer groups (the terms agg truncates to the top
    // 200) plus one older grouped asset on a distinct variant. The library page
    // only exposes `var-new`, but the endpoint must still surface `var-old`.
    const newer = Array.from({ length: 200 }, (_, i) => ({
      id: `g${i}`,
      count: 1,
      readyVariants: ['var-new'],
    }));
    const older = { id: 'old-group', count: 1, readyVariants: ['var-old'] };
    mocks.search.mockResolvedValue({
      aggregations: {
        groups: {
          buckets: newer.map((g) => ({
            key: g.id,
            doc_count: g.count,
            variants: {
              ready: { variant_ids: { buckets: g.readyVariants.map((v) => ({ key: v })) } },
            },
          })),
          // The 201st distinct group (the older asset) fell outside the top-N.
          sum_other_doc_count: 1,
        },
        requested: {
          buckets: [
            {
              key: older.id,
              doc_count: older.count,
              variants: {
                ready: { variant_ids: { buckets: older.readyVariants.map((v) => ({ key: v })) } },
              },
            },
          ],
        },
        distinct_groups: { value: 201 },
      },
    });

    const result = await listGroupAvailability({ includeIds: ['old-group'] });

    expect(result.status).toBe('partial');
    // Server-backed option source beats the library page's newest-200 window.
    expect(result.ready_variant_ids).toContain('var-old');
    expect(
      result.groups.find((g) => g.id === 'old-group')?.ready_variant_ids,
    ).toEqual(['var-old']);
  });

  it('bounds the explicit include list and dedupes ids', async () => {
    mocks.search.mockResolvedValue(aggResponse([]));
    const many = Array.from({ length: 40 }, (_, i) => `g${i}`);
    await listGroupAvailability({ includeIds: [...many, 'g0'] });
    const requested = mocks.search.mock.calls[0]?.[0].aggs.requested.terms.include;
    expect(new Set(requested).size).toBe(requested.length);
    expect(requested.length).toBeLessThanOrEqual(30);
  });
});

describe('selection cap constant (G2)', () => {
  it('matches the request schema bound of 20', () => {
    expect(GROUP_SELECTION_LIMIT).toBe(20);
  });
});
