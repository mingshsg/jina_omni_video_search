import { describe, expect, it } from 'vitest';
import {
  deriveExtractedBoostEffects,
  facetBoostScore,
  fuseHybridCandidates,
  hybridBranchWindow,
  lexicalWindowSize,
  scoreHybrid,
  selectLexicalAssets,
} from './hybrid-fusion';

describe('hybrid sizing', () => {
  it('uses catalog-relative lexical window', () => {
    expect(lexicalWindowSize(0)).toBe(0);
    expect(lexicalWindowSize(10)).toBe(5);
    expect(lexicalWindowSize(36)).toBe(8);
    expect(lexicalWindowSize(200)).toBe(20);
  });

  it('sizes the vector branch window from requested size', () => {
    expect(hybridBranchWindow(5)).toBe(50);
    expect(hybridBranchWindow(8)).toBe(80);
    expect(hybridBranchWindow(20)).toBe(100);
  });
});

describe('scoreHybrid', () => {
  it('weights text at 0.4 relative to modality terms', () => {
    // rank 1 visual ≈ 1/61; rank 1 text ≈ 0.4/61
    const visualOnly = scoreHybrid({ rankVisual: 1 });
    const textOnly = scoreHybrid({ rankText: 1 });
    expect(textOnly / visualOnly).toBeCloseTo(0.4, 5);
  });

  it('adds facet boost on RRF scale, below rank-1 text', () => {
    const facet = facetBoostScore({ matchedCount: 1, selectedCount: 1 });
    const textOnly = scoreHybrid({ rankText: 1 });
    const visualOnly = scoreHybrid({ rankVisual: 1 });
    // Full facet match = w_facet/(C+1) ≈ 0.2/61, below text 0.4/61.
    expect(facet).toBeCloseTo(0.2 / 61, 5);
    expect(facet).toBeLessThan(textOnly);
    expect(facet / visualOnly).toBeCloseTo(0.2, 5);

    const withFacet = scoreHybrid({ rankVisual: 1, facetBoost: facet });
    expect(withFacet - visualOnly).toBeCloseTo(facet, 5);
  });

  it('does not let one facet outrank a strong scene-only hit vs unrelated video', () => {
    const sceneOnly = scoreHybrid({ rankVisual: 1 });
    const unrelatedWithFacet = scoreHybrid({
      rankVisual: 50,
      facetBoost: facetBoostScore({ matchedCount: 1, selectedCount: 1 }),
    });
    expect(sceneOnly).toBeGreaterThan(unrelatedWithFacet);
  });
});

describe('selectLexicalAssets', () => {
  it('caps by A and drops weak BM25 tails', () => {
    const selected = selectLexicalAssets(
      [
        { video_id: 'a', score: 10 },
        { video_id: 'b', score: 9 },
        { video_id: 'c', score: 0.5 },
      ],
      36,
    );
    expect(selected.map((s) => s.video_id)).toEqual(['a', 'b']);
    expect(selected[0]!.rank).toBe(1);
  });
});

describe('fuseHybridCandidates', () => {
  it('lifts a metadata-matching video via text rank', () => {
    const lexicalByVideo = new Map([
      ['v-meta', { video_id: 'v-meta', score: 12, rank: 1 }],
    ]);
    const fused = fuseHybridCandidates({
      modality: 'visual',
      lexicalByVideo,
      candidates: [
        {
          chunk_id: 'c-scene',
          video_id: 'v-scene',
          score_visual: 0.9,
          score_audio: null,
        },
        {
          chunk_id: 'c-meta',
          video_id: 'v-meta',
          score_visual: 0.5,
          score_audio: null,
        },
      ],
    });
    expect(fused[0]!.chunk_id).toBe('c-meta');
    expect(fused[0]!.metadata_match).toBe(true);
    expect(fused[0]!.rank_text).toBe(1);
  });

  it('keeps visual order when no lexical match (pure-scene)', () => {
    const fused = fuseHybridCandidates({
      modality: 'visual',
      lexicalByVideo: new Map(),
      candidates: [
        {
          chunk_id: 'c1',
          video_id: 'v1',
          score_visual: 0.9,
          score_audio: null,
        },
        {
          chunk_id: 'c2',
          video_id: 'v2',
          score_visual: 0.8,
          score_audio: null,
        },
      ],
    });
    expect(fused.map((f) => f.chunk_id)).toEqual(['c1', 'c2']);
    expect(fused.every((f) => f.metadata_match === false)).toBe(true);
  });

  it('applies extracted facet boosts and semantic ranks', () => {
    const fused = fuseHybridCandidates({
      modality: 'visual',
      lexicalByVideo: new Map(),
      semanticByVideo: new Map([['v-sem', 1]]),
      assetFacetsByVideo: new Map([
        ['v-sem', { country: 'KR', actor_ids: ['person:a'] }],
      ]),
      extractedBoosts: { country: ['KR'] },
      candidates: [
        {
          chunk_id: 'c1',
          video_id: 'v-other',
          score_visual: 0.9,
          score_audio: null,
        },
        {
          chunk_id: 'c2',
          video_id: 'v-sem',
          score_visual: 0.5,
          score_audio: null,
        },
      ],
    });
    expect(fused[0]!.chunk_id).toBe('c2');
    expect(fused[0]!.rank_semantic).toBe(1);
    expect(fused[0]!.facet_boost).toBeGreaterThan(0);
  });

  it('prefers country=KR over a similar visual rank (facet-only boost)', () => {
    const fused = fuseHybridCandidates({
      modality: 'visual',
      lexicalByVideo: new Map(),
      assetFacetsByVideo: new Map([
        ['v-us', { country: 'US' }],
        ['v-kr', { country: 'KR' }],
      ]),
      extractedBoosts: { country: ['KR'] },
      candidates: [
        {
          chunk_id: 'c-us',
          video_id: 'v-us',
          score_visual: 0.91,
          score_audio: null,
        },
        {
          chunk_id: 'c-kr',
          video_id: 'v-kr',
          // Slightly weaker vector — without facet boost this stays second.
          score_visual: 0.9,
          score_audio: null,
        },
      ],
    });
    expect(fused.map((f) => f.video_id)).toEqual(['v-kr', 'v-us']);
    expect(fused[0]!.facet_boost).toBeCloseTo(0.2 / 61, 5);
    expect(fused[1]!.facet_boost).toBe(0);
    expect(fused[0]!.score_hybrid).toBeGreaterThan(fused[1]!.score_hybrid);
  });

  it('does not dilute KR boost with no_effect sibling facets', () => {
    const snapshots = new Map([
      ['v-us', { country: 'US', video_type: 'movie' }],
      ['v-kr', { country: 'KR', video_type: 'movie' }],
    ]);
    const effects = deriveExtractedBoostEffects({
      extracted: { country: ['KR'], video_type: ['trailer'] },
      snapshots,
      candidateVideoIds: ['v-us', 'v-kr'],
    });
    expect(effects.applied).toEqual({ country: ['KR'] });
    expect(effects.rejected).toEqual([
      { field: 'video_type', value: 'trailer', reason: 'no_effect' },
    ]);

    // Score with applied only (hybrid-search contract) — full w_facet term.
    const fused = fuseHybridCandidates({
      modality: 'visual',
      lexicalByVideo: new Map(),
      assetFacetsByVideo: snapshots,
      extractedBoosts: effects.applied,
      candidates: [
        {
          chunk_id: 'c-us',
          video_id: 'v-us',
          score_visual: 0.91,
          score_audio: null,
        },
        {
          chunk_id: 'c-kr',
          video_id: 'v-kr',
          score_visual: 0.9,
          score_audio: null,
        },
      ],
    });
    expect(fused[0]!.video_id).toBe('v-kr');
    expect(fused[0]!.facet_boost).toBeCloseTo(0.2 / 61, 5);

    // Raw extraction including no_effect trailer would halve the term.
    const diluted = facetBoostScore({ matchedCount: 1, selectedCount: 2 });
    expect(fused[0]!.facet_boost).toBeGreaterThan(diluted);
  });
});

describe('deriveExtractedBoostEffects', () => {
  it('reports no_effect when no candidate matches country', () => {
    const effects = deriveExtractedBoostEffects({
      extracted: { country: ['KR'] },
      snapshots: new Map([['v1', { country: 'US' }]]),
      candidateVideoIds: ['v1'],
    });
    expect(effects.applied).toEqual({});
    expect(effects.rejected).toEqual([
      { field: 'country', value: 'KR', reason: 'no_effect' },
    ]);
  });
});
