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

  it('fails soft to suggestions with an unavailable status and a redacted error', async () => {
    mocks.search.mockRejectedValue(
      new Error('connect ECONNREFUSED Authorization: ApiKey abc.def'),
    );

    const result = await listGroupAvailability();

    expect(result.status).toBe('unavailable');
    expect(result.error).toContain('[redacted]');
    expect(result.error).not.toContain('abc.def');
    // All stays usable: the starter suggestions are still returned.
    expect(result.groups.map((g) => g.id)).toEqual(
      expect.arrayContaining(['trailer', 'demo']),
    );
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
