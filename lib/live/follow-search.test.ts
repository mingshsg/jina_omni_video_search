import { afterEach, describe, expect, it } from 'vitest';
import { LiveApiError } from './errors';
import {
  createFollowSearchHandle,
  deleteFollowSearchHandle,
  getFollowSearchHandle,
  resetFollowSearchHandlesForTests,
} from './follow-search';

afterEach(() => {
  resetFollowSearchHandlesForTests();
});

describe('follow-search handles', () => {
  it('creates handle with per-session cursors and co-expires', () => {
    const handle = createFollowSearchHandle({
      cacheKey: 'k',
      vector: [1, 2],
      filters: [{ term: { variant_id: 'v' } }],
      modality: 'both',
      sortBy: 'rrf',
      size: 20,
      variantId: 'v',
      sourceIds: [],
      sessionIds: ['s1', 's2'],
      sessionCursors: { s1: 10, s2: 3 },
      initialChunkIds: ['c1'],
      expiresAtMs: Date.now() + 60_000,
      isImage: false,
    });
    expect(handle.seenChunkIds.has('c1')).toBe(true);
    expect(getFollowSearchHandle(handle.queryId).sessionCursors.s1).toBe(10);
    expect(deleteFollowSearchHandle(handle.queryId)).toBe(true);
    expect(() => getFollowSearchHandle(handle.queryId)).toThrow(LiveApiError);
  });

  it('returns LIVE_QUERY_EXPIRED after TTL', () => {
    const handle = createFollowSearchHandle({
      cacheKey: 'k',
      vector: [1],
      filters: [],
      modality: 'visual',
      sortBy: 'visual',
      size: 5,
      variantId: 'v',
      sourceIds: [],
      sessionIds: ['s1'],
      sessionCursors: { s1: 0 },
      initialChunkIds: [],
      expiresAtMs: 1000,
      isImage: false,
      nowMs: 0,
    });
    expect(() => getFollowSearchHandle(handle.queryId, 1001)).toThrow(
      /LIVE_QUERY_EXPIRED|unavailable/i,
    );
  });
});
