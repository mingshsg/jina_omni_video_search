import { describe, expect, it } from 'vitest';
import {
  assembleHits,
  badgeFromRanks,
  clampSearchSize,
  collapseEsHitsById,
  compareOptionalScoresDesc,
  effectiveRankWindowSize,
  emptyIdMaps,
  FILE_SOURCE_FIELDS,
  idMaps,
  knnRetrieverBody,
  mapFileHit,
  type SearchHit,
} from './search-core';

describe('search-core helpers', () => {
  it('clamps size to 1..100 with default 20', () => {
    expect(clampSearchSize(undefined)).toBe(20);
    expect(clampSearchSize(0)).toBe(1);
    expect(clampSearchSize(-3)).toBe(1);
    expect(clampSearchSize(50)).toBe(50);
    expect(clampSearchSize(999)).toBe(100);
  });

  it('raises rank_window_size to at least size', () => {
    const cfg = { SEARCH_RANK_WINDOW_SIZE: 50 } as Parameters<
      typeof effectiveRankWindowSize
    >[0];
    expect(effectiveRankWindowSize(cfg, 20)).toBe(50);
    expect(effectiveRankWindowSize(cfg, 80)).toBe(80);
  });

  it('collapse fetchSize must not exceed RRF rank_window_size', () => {
    // Mirrors executeChunkSearch: collapse fetch = min(rank*2, 200).
    const rankWindow = effectiveRankWindowSize(
      { SEARCH_RANK_WINDOW_SIZE: 50 } as Parameters<
        typeof effectiveRankWindowSize
      >[0],
      10,
    );
    const fetchSize = Math.min(rankWindow * 2, 200);
    const rrfRankWindow = Math.max(rankWindow, fetchSize);
    expect(rrfRankWindow).toBeGreaterThanOrEqual(fetchSize);
    expect(rrfRankWindow).toBe(100);
  });

  it('collapse fetchSize must not exceed RRF rank_window_size', () => {
    // Mirrors executeChunkSearch: collapse fetch = min(rank*2, 200).
    const rankWindow = effectiveRankWindowSize(
      { SEARCH_RANK_WINDOW_SIZE: 50 } as Parameters<
        typeof effectiveRankWindowSize
      >[0],
      10,
    );
    const fetchSize = Math.min(rankWindow * 2, 200);
    const rrfRankWindow = Math.max(rankWindow, fetchSize);
    expect(rrfRankWindow).toBeGreaterThanOrEqual(fetchSize);
    expect(rrfRankWindow).toBe(100);
  });

  it('badge rule: dual hit → both', () => {
    expect(badgeFromRanks(1, 3)).toBe('both');
    expect(badgeFromRanks(2, undefined)).toBe('visual');
    expect(badgeFromRanks(undefined, 1)).toBe('audio');
  });

  it('sorts optional knn scores descending with nulls last', () => {
    const rows = [
      { id: 'a', visual: 0.4, rrf: 0.02 },
      { id: 'b', visual: 0.9, rrf: 0.01 },
      { id: 'c', visual: null, rrf: 0.03 },
      { id: 'd', visual: 0.9, rrf: 0.04 },
    ];
    rows.sort((x, y) =>
      compareOptionalScoresDesc(x.visual, y.visual, x.rrf, y.rrf),
    );
    expect(rows.map((r) => r.id)).toEqual(['d', 'b', 'a', 'c']);
  });

  it('file mapHit preserves response field contract', () => {
    const hit = mapFileHit(
      'chunk-1',
      0.42,
      {
        video_id: 'vid-1',
        variant_id: 'var-1',
        chunk_index: 3,
        start_ms: 1000,
        end_ms: 2000,
        start_label: '00:00:01',
        end_label: '00:00:02',
        video_title: 'Demo',
      },
      'both',
      0.9,
      0.8,
      1,
      2,
    );
    const keys = Object.keys(hit).sort();
    expect(keys).toEqual(
      [
        'chunk_id',
        'video_id',
        'variant_id',
        'title',
        'start_ms',
        'end_ms',
        'start_label',
        'end_label',
        'score',
        'score_visual',
        'score_audio',
        'rank_visual',
        'rank_audio',
        'modality_badge',
        'thumb_url',
      ].sort(),
    );
    expect(hit.thumb_url).toBe('/api/thumb/vid-1/var-1/3');
    expect(hit.title).toBe('Demo');
  });

  it('FILE_SOURCE_FIELDS stay stable for file regression', () => {
    expect([...FILE_SOURCE_FIELDS]).toEqual([
      'video_id',
      'variant_id',
      'chunk_index',
      'start_ms',
      'end_ms',
      'start_label',
      'end_label',
      'video_title',
      'thumb_path',
    ]);
  });

  it('collapses duplicate ids keeping best score before attribution', () => {
    const collapsed = collapseEsHitsById([
      { _id: 'a', _score: 0.2, _source: { chunk_id: 'a' } },
      { _id: 'a', _score: 0.9, _source: { chunk_id: 'a' } },
      { _id: 'b', _score: 0.5, _source: { chunk_id: 'b' } },
    ]);
    expect(collapsed.map((h) => h._id)).toEqual(['a', 'b']);
    expect(collapsed[0]?._score).toBe(0.9);
  });

  it('applies query_vector (not builder) when mode is vector', () => {
    const body = knnRetrieverBody(
      'embedding_video',
      10,
      [{ term: { variant_id: 'v' } }],
      { kind: 'vector', vector: [0.1, 0.2] },
    );
    expect(body.query_vector).toEqual([0.1, 0.2]);
    expect(body.query_vector_builder).toBeUndefined();
    expect(body.filter).toEqual({
      bool: { filter: [{ term: { variant_id: 'v' } }] },
    });
  });

  it('assembles file hits with RRF attribution fields', () => {
    const primary = [
      {
        _id: 'c1',
        _score: 0.01,
        _source: {
          video_id: 'v',
          variant_id: 'var',
          chunk_index: 0,
          start_ms: 0,
          end_ms: 1000,
          start_label: 'a',
          end_label: 'b',
          video_title: 't',
        },
      },
    ];
    const visual = idMaps([
      { _id: 'c1', _score: 0.9, _source: primary[0]!._source },
    ]);
    const audio = emptyIdMaps();
    const hits: SearchHit[] = assembleHits(
      primary,
      10,
      visual,
      audio,
      new Map([['c1', 0.05]]),
      visual.source,
      'both',
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]!.score).toBe(0.05);
    expect(hits[0]!.score_visual).toBe(0.9);
    expect(hits[0]!.modality_badge).toBe('visual');
  });
});
