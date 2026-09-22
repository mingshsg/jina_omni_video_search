import { afterEach, describe, expect, it } from 'vitest';
import {
  getCachedQueryVector,
  imageQueryCacheKey,
  liveQueryCacheInferenceCount,
  normalizeLiveTextQuery,
  putCachedQueryVector,
  resetLiveQueryCacheForTests,
  textQueryCacheKey,
} from './query-cache';
import type { ProviderIdentity } from '../embed/types';

const identity: ProviderIdentity = {
  provider: 'eis',
  model: 'jina-embeddings-v4',
  task: 'retrieval.query',
  dims: 1024,
  normalizedBy: 'provider',
};

afterEach(() => {
  resetLiveQueryCacheForTests();
});

describe('query-vector cache', () => {
  it('normalizes text and builds stable keys', () => {
    expect(normalizeLiveTextQuery('  Hello   World ')).toBe('hello world');
    expect(textQueryCacheKey(identity, 'query', 'Hello')).toContain('eis|');
    const imgKey = imageQueryCacheKey(
      identity,
      'query',
      Buffer.from('abc'),
      320,
      240,
    );
    expect(imgKey).toMatch(/^image:/);
    expect(imgKey).toContain('w320:h240');
  });

  it('TTL expires entries and LRU evicts oldest', () => {
    const now = 1_000_000;
    putCachedQueryVector({
      key: 'a',
      vector: [1],
      provider: identity,
      role: 'query',
      createdAtMs: now,
      expiresAtMs: now + 1000,
      lastAccessMs: now,
    });
    expect(getCachedQueryVector('a', now + 10)?.vector).toEqual([1]);
    expect(getCachedQueryVector('a', now + 2000)).toBeNull();

    for (let i = 0; i < 70; i++) {
      putCachedQueryVector(
        {
          key: `k${i}`,
          vector: [i],
          provider: identity,
          role: 'query',
          createdAtMs: now + i,
          expiresAtMs: now + 60_000,
          lastAccessMs: now + i,
        },
        64,
      );
    }
    expect(getCachedQueryVector('k0', now + 100)).toBeNull();
    expect(getCachedQueryVector('k69', now + 100)?.vector).toEqual([69]);
  });

  it('exposes inference counter for follow-search gate tests', () => {
    expect(liveQueryCacheInferenceCount()).toBe(0);
  });
});
