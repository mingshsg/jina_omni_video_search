import { describe, expect, it, vi } from 'vitest';
import { mapLiveHit, runLiveSearch } from './search';
import type { ExecuteChunkSearchResult } from '../es/search';

vi.mock('./query-cache', () => ({
  resolveLiveTextQueryVector: vi.fn(async () => ({
    vector: [0.11, 0.22],
    cache: 'miss' as const,
    key: 'text:test',
  })),
  resolveLiveImageQueryVector: vi.fn(async () => ({
    vector: [0.3],
    cache: 'hit' as const,
    key: 'image:test',
  })),
}));

vi.mock('./session-repository', () => ({
  LiveSessionRepository: class {
    async get(sessionId: string) {
      return {
        source: { published_revision: sessionId === 's1' ? 42 : 7 },
      };
    }
  },
}));

vi.mock('./follow-search', async () => {
  const actual = await vi.importActual<typeof import('./follow-search')>(
    './follow-search',
  );
  return {
    ...actual,
    createFollowSearchHandle: vi.fn((args) => ({
      queryId: 'qid-1',
      ...args,
      seenChunkIds: new Set(args.initialChunkIds),
      createdAtMs: Date.now(),
      expiresAtMs: args.expiresAtMs,
    })),
  };
});

vi.mock('./config', async () => {
  const actual = await vi.importActual<typeof import('./config')>('./config');
  return {
    ...actual,
    getLiveConfig: () =>
      ({
        ES_DATA_STREAM_LIVE_CHUNKS: 'live-chunks',
        LIVE_QUERY_CACHE_TTL_MS: 300_000,
        LIVE_SEARCH_MAX_RANGE: '24h',
      }) as ReturnType<typeof actual.getLiveConfig>,
  };
});

vi.mock('../config', async () => {
  const actual = await vi.importActual<typeof import('../config')>('../config');
  return {
    ...actual,
    getConfig: () =>
      ({
        SEARCH_RANK_WINDOW_SIZE: 50,
        SEARCH_RANK_CONSTANT: 60,
        SEARCH_WEIGHT_VIDEO: 1,
        SEARCH_WEIGHT_AUDIO: 1,
      }) as ReturnType<typeof actual.getConfig>,
  };
});

describe('live search mapping + orchestration', () => {
  it('mapLiveHit exposes live media URLs and window fields', () => {
    const hit = mapLiveHit(
      'c1',
      0.5,
      {
        chunk_id: 'c1',
        source_id: 'src',
        session_id: 'sess',
        stream_epoch: 2,
        sequence_no: 9,
        variant_id: 'var',
        window_start_at: '2026-09-10T04:00:00.000Z',
        window_end_at: '2026-09-10T04:00:08.000Z',
        event_ingested: '2026-09-10T04:00:09.000Z',
        start_offset_ms: 0,
        end_offset_ms: 8000,
      },
      'visual',
      0.9,
      null,
      1,
      null,
    );
    expect(hit.thumb_url).toBe('/api/live/chunks/c1/thumb');
    expect(hit.clip_url).toBe('/api/live/chunks/c1/media');
    expect(hit.source_id).toBe('src');
    expect(hit.sequence_no).toBe(9);
  });

  it('runLiveSearch passes query_vector + collapse and opens follow handle', async () => {
    const execute = vi.fn(
      async (): Promise<ExecuteChunkSearchResult> => ({
        hits: [
          mapLiveHit(
            'c1',
            0.4,
            {
              chunk_id: 'c1',
              source_id: 'src',
              session_id: 's1',
              stream_epoch: 1,
              sequence_no: 1,
              variant_id: 'var',
              window_start_at: '2026-09-10T04:00:00.000Z',
              window_end_at: '2026-09-10T04:00:08.000Z',
              event_ingested: '2026-09-10T04:00:09.000Z',
            },
            'visual',
            0.4,
            null,
            1,
            null,
          ),
        ],
        rank_window_size: 50,
        size: 20,
        modality: 'both',
        sort_by: 'rrf',
        badge_strategy: 'rrf_plus_parallel_knn',
        took_ms: 3,
      }),
    );

    const result = await runLiveSearch(
      {
        query: 'red bag',
        variantId: 'var',
        sessionIds: ['s1'],
        follow: true,
        size: 20,
      },
      { execute },
    );

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        index: 'live-chunks',
        queryVectorMode: { kind: 'vector', vector: [0.11, 0.22] },
        collapseByChunkId: true,
      }),
      expect.anything(),
    );
    expect(result.query_vector_cache).toBe('miss');
    expect(result.query_id).toBe('qid-1');
    expect(result.session_cursors).toEqual({ s1: 42 });
    expect(result.hits[0]?.chunk_id).toBe('c1');
  });
});
