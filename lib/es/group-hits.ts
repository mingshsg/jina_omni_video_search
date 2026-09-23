/**
 * Presentation grouping for ranked search hits.
 *
 * Same video (+ variant) hits whose start times span at most
 * `2 * chunkWindowMs` (earliest → latest) collapse into one group.
 * Top-k then counts **groups**, not raw windows.
 */

export type GroupableHit = {
  chunk_id: string;
  video_id: string;
  variant_id: string;
  start_ms: number;
  end_ms: number;
  start_label: string;
  end_label: string;
  score: number;
};

export type SearchHitGroup<T extends GroupableHit> = {
  /** Stable key for React lists. */
  key: string;
  video_id: string;
  variant_id: string;
  /** Ranked best member (highest score; ties → earlier original rank). */
  representative: T;
  /** Members sorted by start_ms ascending. */
  members: T[];
  start_ms: number;
  end_ms: number;
  start_label: string;
  end_label: string;
};

/** Max ES/API window size used when oversampling for grouped top-k. */
export const GROUPED_SEARCH_FETCH_CAP = 100;

/**
 * How many raw hits to fetch so that after temporal grouping we can still
 * fill `groupTopK` result cards.
 */
export function oversampleForGroupedTopK(groupTopK: number): number {
  const k = Math.max(1, Math.floor(groupTopK));
  return Math.min(GROUPED_SEARCH_FETCH_CAP, Math.max(k * 10, k));
}

function pickRepresentative<T extends GroupableHit>(
  members: T[],
  originalIndex: Map<string, number>,
): T {
  let best = members[0]!;
  for (let i = 1; i < members.length; i += 1) {
    const cand = members[i]!;
    if (cand.score > best.score) {
      best = cand;
      continue;
    }
    if (cand.score < best.score) continue;
    const bi = originalIndex.get(best.chunk_id) ?? 0;
    const ci = originalIndex.get(cand.chunk_id) ?? 0;
    if (ci < bi) best = cand;
  }
  return best;
}

function finalizeGroup<T extends GroupableHit>(
  membersIn: T[],
  originalIndex: Map<string, number>,
): SearchHitGroup<T> {
  const members = membersIn
    .slice()
    .sort(
      (a, b) =>
        a.start_ms - b.start_ms ||
        (originalIndex.get(a.chunk_id) ?? 0) -
          (originalIndex.get(b.chunk_id) ?? 0),
    );
  const representative = pickRepresentative(members, originalIndex);
  const first = members[0]!;
  const last = members[members.length - 1]!;
  const endMs = Math.max(...members.map((m) => m.end_ms));
  const endLabel =
    members.find((m) => m.end_ms === endMs)?.end_label ?? last.end_label;
  return {
    key: members.map((m) => m.chunk_id).join('|'),
    video_id: first.video_id,
    variant_id: first.variant_id,
    representative,
    members,
    start_ms: first.start_ms,
    end_ms: endMs,
    start_label: first.start_label,
    end_label: endLabel,
  };
}

/**
 * Cluster hits from the same video/variant when
 * `latest_start - earliest_start <= 2 * chunkWindowMs`.
 * Groups are ordered by the representative's original rank.
 */
export function groupSearchHits<T extends GroupableHit>(
  hits: T[],
  chunkWindowMs: number,
): SearchHitGroup<T>[] {
  if (hits.length === 0) return [];

  const windowMs =
    Number.isFinite(chunkWindowMs) && chunkWindowMs > 0
      ? Math.floor(chunkWindowMs)
      : 64_000;
  const thresholdMs = windowMs * 2;

  const originalIndex = new Map<string, number>();
  hits.forEach((h, i) => originalIndex.set(h.chunk_id, i));

  const buckets = new Map<string, T[]>();
  for (const hit of hits) {
    const key = `${hit.video_id}::${hit.variant_id}`;
    const list = buckets.get(key);
    if (list) list.push(hit);
    else buckets.set(key, [hit]);
  }

  const groups: SearchHitGroup<T>[] = [];

  for (const bucket of buckets.values()) {
    const sorted = bucket.slice().sort(
      (a, b) =>
        a.start_ms - b.start_ms ||
        (originalIndex.get(a.chunk_id) ?? 0) -
          (originalIndex.get(b.chunk_id) ?? 0),
    );

    let current: T[] = [];
    let earliestStart = 0;

    for (const hit of sorted) {
      if (current.length === 0) {
        current = [hit];
        earliestStart = hit.start_ms;
        continue;
      }
      if (hit.start_ms - earliestStart <= thresholdMs) {
        current.push(hit);
      } else {
        groups.push(finalizeGroup(current, originalIndex));
        current = [hit];
        earliestStart = hit.start_ms;
      }
    }
    if (current.length > 0) {
      groups.push(finalizeGroup(current, originalIndex));
    }
  }

  groups.sort(
    (a, b) =>
      (originalIndex.get(a.representative.chunk_id) ?? 0) -
      (originalIndex.get(b.representative.chunk_id) ?? 0),
  );

  return groups;
}

/** Default max temporal groups kept per video when filling top-k. */
export const MAX_GROUPS_PER_VIDEO = 2;

/**
 * Group then keep at most `groupTopK` groups (by ranked order).
 * Prefer at most `maxPerVideo` groups per video while other videos can fill
 * the page; relax the cap when too few distinct videos qualify.
 */
export function groupSearchHitsTopK<T extends GroupableHit>(
  hits: T[],
  chunkWindowMs: number,
  groupTopK: number,
  options?: { maxPerVideo?: number },
): SearchHitGroup<T>[] {
  const k = Math.max(1, Math.floor(groupTopK));
  const maxPerVideo = Math.max(
    1,
    Math.floor(options?.maxPerVideo ?? MAX_GROUPS_PER_VIDEO),
  );
  const groups = groupSearchHits(hits, chunkWindowMs);
  if (groups.length <= k) return groups;

  const distinctVideos = new Set(groups.map((g) => g.video_id)).size;
  // Relax when every available video would still leave the page under-filled
  // even if we take the per-video max from each.
  const relax = distinctVideos * maxPerVideo < k;

  const selected: SearchHitGroup<T>[] = [];
  const perVideo = new Map<string, number>();

  for (const group of groups) {
    if (selected.length >= k) break;
    const n = perVideo.get(group.video_id) ?? 0;
    if (!relax && n >= maxPerVideo) continue;
    perVideo.set(group.video_id, n + 1);
    selected.push(group);
  }

  // If the preference skipped too many, backfill in original order.
  if (selected.length < k) {
    const taken = new Set(selected.map((g) => g.key));
    for (const group of groups) {
      if (selected.length >= k) break;
      if (taken.has(group.key)) continue;
      selected.push(group);
    }
    // Preserve ranked order after backfill.
    selected.sort(
      (a, b) =>
        groups.findIndex((g) => g.key === a.key) -
        groups.findIndex((g) => g.key === b.key),
    );
  }

  return selected.slice(0, k);
}
