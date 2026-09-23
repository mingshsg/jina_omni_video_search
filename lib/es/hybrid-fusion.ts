/**
 * Application-side hybrid fusion (plan §B) — pure helpers, no ES I/O.
 */

export const HYBRID_RANK_CONSTANT = 60;
export const HYBRID_W_TEXT = 0.4;
export const HYBRID_W_VISUAL = 1;
export const HYBRID_W_AUDIO = 1;
/** Phase 3.5 semantic asset channel weight (below text). */
export const HYBRID_W_SEMANTIC = 0.3;
/** Phase 3.5 extracted-facet boost weight (below text). */
export const HYBRID_W_FACET = 0.2;
/** When parse finds no scene residual, down-weight vector channels. */
export const HYBRID_SCENELESS_VECTOR_SCALE = 0.25;
/** Drop BM25 assets below this fraction of the top score. */
export const BM25_MIN_SCORE_FRACTION = 0.15;

export function lexicalWindowSize(eligibleCount: number): number {
  const n = Math.max(0, Math.trunc(eligibleCount));
  if (n === 0) return 0;
  return Math.min(20, Math.max(5, Math.ceil(0.2 * n)));
}

export function hybridBranchWindow(requestedSize: number): number {
  const size = Math.max(1, Math.trunc(requestedSize));
  return Math.min(100, Math.max(50, 10 * size));
}

export function guaranteedFloorCount(lexicalAssetCount: number): number {
  return Math.min(5, Math.max(0, Math.trunc(lexicalAssetCount)));
}

/** RRF-style term: w / (C + rank); rank is 1-based. */
export function rrfTerm(weight: number, rank: number | null | undefined): number {
  if (rank == null || rank < 1 || !Number.isFinite(rank)) return 0;
  return weight / (HYBRID_RANK_CONSTANT + rank);
}

export function scoreHybrid(params: {
  rankVisual?: number | null;
  rankAudio?: number | null;
  rankText?: number | null;
  rankSemantic?: number | null;
  facetBoost?: number;
  wVisual?: number;
  wAudio?: number;
  wText?: number;
  wSemantic?: number;
}): number {
  const wV = params.wVisual ?? HYBRID_W_VISUAL;
  const wA = params.wAudio ?? HYBRID_W_AUDIO;
  const wT = params.wText ?? HYBRID_W_TEXT;
  const wS = params.wSemantic ?? HYBRID_W_SEMANTIC;
  return (
    rrfTerm(wV, params.rankVisual) +
    rrfTerm(wA, params.rankAudio) +
    rrfTerm(wT, params.rankText) +
    rrfTerm(wS, params.rankSemantic) +
    (params.facetBoost ?? 0)
  );
}

/**
 * Extracted-facet boost on the same RRF scale as modality/text ranks:
 *   (w_facet / (C + 1)) × matched / n_selected
 * so a full facet match is below rank-1 text (w_text / (C+1)).
 * Hand-selected hard filters are excluded by the caller (filter wins).
 *
 * Callers must pass only pool-effective (`applied`) facets as `selectedCount`
 * so `no_effect` groups do not dilute the numeric boost.
 */
export function facetBoostScore(params: {
  matchedCount: number;
  selectedCount: number;
  wFacet?: number;
}): number {
  const n = Math.max(0, Math.trunc(params.selectedCount));
  const m = Math.max(0, Math.trunc(params.matchedCount));
  if (n === 0 || m === 0) return 0;
  const w = params.wFacet ?? HYBRID_W_FACET;
  const fraction = Math.min(m, n) / n;
  return rrfTerm(w, 1) * fraction;
}

/**
 * Which extracted facet groups matched at least one candidate asset.
 * Unmatched groups are reported as `no_effect`; missing snapshots as
 * `snapshot_unavailable`. Hybrid fusion must score with `applied` only —
 * rejected groups are informational and never a hard filter.
 */
export function deriveExtractedBoostEffects(params: {
  extracted: ExtractedFacetBoosts;
  snapshots: Map<string, AssetFacetSnapshot>;
  candidateVideoIds: string[];
  snapshotFailed?: boolean;
}): {
  applied: ExtractedFacetBoosts;
  rejected: Array<{ field: string; value: string; reason: string }>;
} {
  const applied: ExtractedFacetBoosts = {};
  const rejected: Array<{ field: string; value: string; reason: string }> = [];
  const vids = params.candidateVideoIds;
  const reason = params.snapshotFailed
    ? 'snapshot_unavailable'
    : 'no_effect';

  const anyMatch = (pred: (a: AssetFacetSnapshot) => boolean): boolean => {
    if (params.snapshotFailed || vids.length === 0) return false;
    for (const id of vids) {
      const snap = params.snapshots.get(id);
      if (snap && pred(snap)) return true;
    }
    return false;
  };

  if (params.extracted.actor_ids && params.extracted.actor_ids.length > 0) {
    const ids = params.extracted.actor_ids;
    if (anyMatch((a) => ids.some((id) => (a.actor_ids ?? []).includes(id)))) {
      applied.actor_ids = [...ids];
    } else {
      for (const id of ids) {
        rejected.push({ field: 'actor_ids', value: id, reason });
      }
    }
  }
  if (
    params.extracted.year_from != null ||
    params.extracted.year_to != null
  ) {
    const from = params.extracted.year_from;
    const to = params.extracted.year_to;
    const ok = anyMatch((a) => {
      const y = a.year;
      if (typeof y !== 'number') return false;
      return (from == null || y >= from) && (to == null || y <= to);
    });
    if (ok) {
      if (from != null) applied.year_from = from;
      if (to != null) applied.year_to = to;
    } else {
      rejected.push({
        field: 'year',
        value: `${from ?? ''}-${to ?? ''}`,
        reason,
      });
    }
  }
  if (params.extracted.country && params.extracted.country.length > 0) {
    const codes = params.extracted.country;
    if (anyMatch((a) => Boolean(a.country && codes.includes(a.country)))) {
      applied.country = [...codes];
    } else {
      for (const c of codes) {
        rejected.push({ field: 'country', value: c, reason });
      }
    }
  }
  if (params.extracted.video_type && params.extracted.video_type.length > 0) {
    const types = params.extracted.video_type;
    if (anyMatch((a) => Boolean(a.video_type && types.includes(a.video_type)))) {
      applied.video_type = [...types];
    } else {
      for (const t of types) {
        rejected.push({ field: 'video_type', value: t, reason });
      }
    }
  }

  return { applied, rejected };
}

export interface LexicalAssetHit {
  video_id: string;
  score: number;
  rank: number;
  matched_clauses?: string[];
}

/** Keep assets within BM25_MIN_SCORE_FRACTION of the top score, capped at A. */
export function selectLexicalAssets(
  ranked: Array<{ video_id: string; score: number; matched_clauses?: string[] }>,
  eligibleCount: number,
): LexicalAssetHit[] {
  const A = lexicalWindowSize(eligibleCount);
  if (A === 0 || ranked.length === 0) return [];
  const top = ranked[0]!.score;
  const floor = top * BM25_MIN_SCORE_FRACTION;
  const out: LexicalAssetHit[] = [];
  for (let i = 0; i < ranked.length && out.length < A; i++) {
    const row = ranked[i]!;
    if (row.score < floor) break;
    out.push({
      video_id: row.video_id,
      score: row.score,
      rank: i + 1,
      matched_clauses: row.matched_clauses,
    });
  }
  return out;
}

export interface FusionCandidate {
  chunk_id: string;
  video_id: string;
  score_visual: number | null;
  score_audio: number | null;
  source?: Record<string, unknown>;
}

export interface AssetFacetSnapshot {
  actor_ids?: string[];
  year?: number | null;
  country?: string | null;
  video_type?: string | null;
}

export interface ExtractedFacetBoosts {
  actor_ids?: string[];
  year_from?: number;
  year_to?: number;
  country?: string[];
  video_type?: string[];
}

/** Count how many extracted facet groups this asset satisfies. */
export function countMatchedExtractedFacets(
  asset: AssetFacetSnapshot | undefined,
  extracted: ExtractedFacetBoosts,
): { matched: number; selected: number } {
  let selected = 0;
  let matched = 0;

  if (extracted.actor_ids && extracted.actor_ids.length > 0) {
    selected += 1;
    const ids = new Set(asset?.actor_ids ?? []);
    if (extracted.actor_ids.some((id) => ids.has(id))) matched += 1;
  }
  if (extracted.year_from != null || extracted.year_to != null) {
    selected += 1;
    const y = asset?.year;
    if (typeof y === 'number') {
      const fromOk = extracted.year_from == null || y >= extracted.year_from;
      const toOk = extracted.year_to == null || y <= extracted.year_to;
      if (fromOk && toOk) matched += 1;
    }
  }
  if (extracted.country && extracted.country.length > 0) {
    selected += 1;
    const c = asset?.country;
    if (c && extracted.country.includes(c)) matched += 1;
  }
  if (extracted.video_type && extracted.video_type.length > 0) {
    selected += 1;
    const t = asset?.video_type;
    if (t && extracted.video_type.includes(t)) matched += 1;
  }

  return { matched, selected };
}

/**
 * Assign 1-based ranks within a modality by sorting on knn score desc,
 * then chunk_id. Missing modality scores are omitted from that rank list.
 */
export function assignModalityRanks(
  candidates: FusionCandidate[],
  modality: 'visual' | 'audio',
): Map<string, number> {
  const key = modality === 'visual' ? 'score_visual' : 'score_audio';
  const scored = candidates
    .filter((c) => typeof c[key] === 'number' && Number.isFinite(c[key]!))
    .slice()
    .sort((a, b) => {
      const sa = a[key]!;
      const sb = b[key]!;
      if (sb !== sa) return sb - sa;
      return a.chunk_id.localeCompare(b.chunk_id);
    });
  const ranks = new Map<string, number>();
  scored.forEach((c, i) => ranks.set(c.chunk_id, i + 1));
  return ranks;
}

export interface FusedHit {
  chunk_id: string;
  video_id: string;
  score_hybrid: number;
  rank_visual: number | null;
  rank_audio: number | null;
  rank_text: number | null;
  rank_semantic: number | null;
  score_visual: number | null;
  score_audio: number | null;
  asset_text_score: number | null;
  facet_boost: number;
  metadata_match: boolean;
  source?: Record<string, unknown>;
}

export function fuseHybridCandidates(params: {
  candidates: FusionCandidate[];
  lexicalByVideo: Map<string, LexicalAssetHit>;
  modality: 'visual' | 'audio' | 'both';
  /** video_id → semantic asset rank (1-based). */
  semanticByVideo?: Map<string, number>;
  /** video_id → facet snapshot for boost matching. */
  assetFacetsByVideo?: Map<string, AssetFacetSnapshot>;
  /**
   * Pool-effective extracted facets (`deriveExtractedBoostEffects().applied`).
   * Do not pass raw extractions that include `no_effect` groups — those dilute
   * the per-asset matched/selected fraction.
   */
  extractedBoosts?: ExtractedFacetBoosts | null;
  /** Scale visual/audio weights (e.g. sceneless parse). */
  vectorWeightScale?: number;
}): FusedHit[] {
  const visualRanks =
    params.modality === 'audio'
      ? new Map<string, number>()
      : assignModalityRanks(params.candidates, 'visual');
  const audioRanks =
    params.modality === 'visual'
      ? new Map<string, number>()
      : assignModalityRanks(params.candidates, 'audio');

  const scale = params.vectorWeightScale ?? 1;
  const wVisual = HYBRID_W_VISUAL * scale;
  const wAudio = HYBRID_W_AUDIO * scale;
  const extracted = params.extractedBoosts ?? null;

  const fused: FusedHit[] = params.candidates.map((c) => {
    const lex = params.lexicalByVideo.get(c.video_id);
    const rankVisual = visualRanks.get(c.chunk_id) ?? null;
    const rankAudio = audioRanks.get(c.chunk_id) ?? null;
    const rankText = lex?.rank ?? null;
    const rankSemantic = params.semanticByVideo?.get(c.video_id) ?? null;
    let facetBoost = 0;
    if (extracted) {
      const counts = countMatchedExtractedFacets(
        params.assetFacetsByVideo?.get(c.video_id),
        extracted,
      );
      facetBoost = facetBoostScore({
        matchedCount: counts.matched,
        selectedCount: counts.selected,
      });
    }
    return {
      chunk_id: c.chunk_id,
      video_id: c.video_id,
      score_hybrid: scoreHybrid({
        rankVisual: params.modality === 'audio' ? null : rankVisual,
        rankAudio: params.modality === 'visual' ? null : rankAudio,
        rankText,
        rankSemantic,
        facetBoost,
        wVisual: params.modality === 'audio' ? 0 : wVisual,
        wAudio: params.modality === 'visual' ? 0 : wAudio,
      }),
      rank_visual: params.modality === 'audio' ? null : rankVisual,
      rank_audio: params.modality === 'visual' ? null : rankAudio,
      rank_text: rankText,
      rank_semantic: rankSemantic,
      score_visual: c.score_visual,
      score_audio: c.score_audio,
      asset_text_score: lex?.score ?? null,
      facet_boost: facetBoost,
      metadata_match: Boolean(lex) || rankSemantic != null || facetBoost > 0,
      source: c.source,
    };
  });

  fused.sort((a, b) => {
    if (b.score_hybrid !== a.score_hybrid) return b.score_hybrid - a.score_hybrid;
    const bestA = Math.min(
      a.rank_visual ?? Infinity,
      a.rank_audio ?? Infinity,
    );
    const bestB = Math.min(
      b.rank_visual ?? Infinity,
      b.rank_audio ?? Infinity,
    );
    if (bestA !== bestB) return bestA - bestB;
    const ta = a.rank_text ?? Infinity;
    const tb = b.rank_text ?? Infinity;
    if (ta !== tb) return ta - tb;
    const sa = a.rank_semantic ?? Infinity;
    const sb = b.rank_semantic ?? Infinity;
    if (sa !== sb) return sa - sb;
    return a.chunk_id.localeCompare(b.chunk_id);
  });

  return fused;
}
