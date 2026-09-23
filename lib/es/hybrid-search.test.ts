import { describe, expect, it, beforeAll } from 'vitest';
import { loadPeopleCatalog } from '../metadata/people';
import {
  buildBm25Should,
  buildHybridQueryDslExplain,
  truncateIdList,
} from './hybrid-search';

describe('buildBm25Should', () => {
  beforeAll(() => {
    loadPeopleCatalog(true);
  });

  it('adds actor_keys for a contained alias in a mixed query', () => {
    const should = buildBm25Should('Audrey Hepburn running');
    const terms = should.find(
      (c) => c.terms && (c.terms as { 'meta.actor_keys'?: string[] })['meta.actor_keys'],
    ) as
      | { terms: { 'meta.actor_keys': string[]; boost: number } }
      | undefined;
    expect(terms).toBeDefined();
    expect(terms!.terms['meta.actor_keys']).toEqual(
      expect.arrayContaining(['audreyhepburn']),
    );

    const phrases = should.filter(
      (c) =>
        (c.match_phrase as { 'meta.search_text'?: { query: string } } | undefined)
          ?.['meta.search_text']?.query.toLowerCase() === 'audrey hepburn',
    );
    expect(phrases.length).toBeGreaterThan(0);
  });

  it('still builds clauses for a pure scene query without aliases', () => {
    const should = buildBm25Should('person running through rain');
    expect(should.some((c) => c.match)).toBe(true);
  });
});

describe('buildHybridQueryDslExplain', () => {
  beforeAll(() => {
    loadPeopleCatalog(true);
  });

  it('truncates large eligible id lists and omits query vectors', () => {
    const ids = Array.from({ length: 20 }, (_, i) => `v${i}`);
    const dsl = buildHybridQueryDslExplain({
      assetsIndex: 'video-assets',
      chunksIndex: 'video-chunks',
      bm25Query: '帅哥',
      vectorQuery: '帅哥',
      bm25Size: 8,
      eligibleIds: ids,
      variantId: 'var1',
      modality: 'visual',
      knnK: 40,
      extractedBoosts: { country: ['KR'] },
    });
    expect(dsl.status).toBe('applied');
    expect(dsl.query_vector).toBeUndefined();
    expect(dsl.knn_global?.query_vector).toBe('omitted');
    const idsFilter = (
      dsl.asset_bm25?.query as {
        bool: { filter: Array<{ ids: { values_count: number; truncated: boolean; values_sample: string[] } }> };
      }
    ).bool.filter[0]!.ids;
    expect(idsFilter.values_count).toBe(20);
    expect(idsFilter.truncated).toBe(true);
    expect(idsFilter.values_sample).toHaveLength(8);
    expect(dsl.extracted_boosts).toEqual({ country: ['KR'] });
  });

  it('truncateIdList reports count and sample', () => {
    const t = truncateIdList(['a', 'b', 'c'], 2);
    expect(t).toEqual({ count: 3, sample: ['a', 'b'], truncated: true });
  });
});
