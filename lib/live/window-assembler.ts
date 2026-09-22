/**
 * Pure fragment-aligned window assembler.
 * Window = 4 consecutive finalized fragments in one epoch; step = 3 fragments.
 */

export interface FinalizedFragment {
  stream_epoch: number;
  sequence_no: number;
  /** Actual PTS coverage from media (ms). */
  start_pts_ms: number;
  end_pts_ms: number;
  media_signature: string;
  /** Receive-side wall clock when fragment finalized (ISO). */
  finalized_at: string;
  /** EXT-X-PROGRAM-DATE-TIME when present. */
  program_date_time?: string;
  path: string;
  media_sha256: string;
}

export interface AssembledWindow {
  stream_epoch: number;
  /** Sequence of the last fragment in the window (chunk identity uses this). */
  sequence_no: number;
  fragment_sequences: [number, number, number, number];
  start_pts_ms: number;
  end_pts_ms: number;
  duration_ms: number;
  discontinuity_before: boolean;
  media_signature: string;
  fragment_paths: [string, string, string, string];
  media_sha256s: [string, string, string, string];
  window_start_at: string;
  window_end_at: string;
  anchor_uncertainty_ms: number;
}

export interface IncompleteTail {
  kind: 'incomplete';
  stream_epoch: number;
  fragment_count: number;
  sequences: number[];
  reason: 'epoch_boundary' | 'stop' | 'insufficient_fragments';
}

export const FRAGMENTS_PER_WINDOW = 4;
export const FRAGMENT_STEP = 3;

export function chunkIdFor(
  sessionId: string,
  streamEpoch: number,
  sequenceNo: number,
): string {
  return `${sessionId}_${streamEpoch}_${sequenceNo}`;
}

/**
 * From a contiguous finalized fragment list within one epoch, emit every
 * eligible window (sequences where a complete 4-fragment group ends and
 * advances by 3).
 */
export function assembleWindowsFromFragments(
  fragments: FinalizedFragment[],
  options: {
    discontinuityBeforeFirst?: boolean;
    /** Expected nominal fragment ms for drift reporting (default 2000). */
    nominalFragmentMs?: number;
  } = {},
): { windows: AssembledWindow[]; incomplete: IncompleteTail | null } {
  if (fragments.length === 0) {
    return {
      windows: [],
      incomplete: {
        kind: 'incomplete',
        stream_epoch: 0,
        fragment_count: 0,
        sequences: [],
        reason: 'insufficient_fragments',
      },
    };
  }

  const epoch = fragments[0]!.stream_epoch;
  for (const f of fragments) {
    if (f.stream_epoch !== epoch) {
      throw new Error('assembleWindowsFromFragments requires a single epoch');
    }
  }

  // Sort and verify contiguous sequences
  const sorted = [...fragments].sort((a, b) => a.sequence_no - b.sequence_no);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.sequence_no !== sorted[i - 1]!.sequence_no + 1) {
      throw new Error(
        `Non-contiguous fragment sequences: ${sorted[i - 1]!.sequence_no} -> ${sorted[i]!.sequence_no}`,
      );
    }
    if (sorted[i]!.media_signature !== sorted[0]!.media_signature) {
      throw new Error('Media signature changed within epoch — open a new epoch');
    }
    // PTS regression across fragments → caller must open new epoch before assemble
    if (sorted[i]!.start_pts_ms < sorted[i - 1]!.start_pts_ms) {
      throw new Error('PTS regression within epoch');
    }
  }

  const windows: AssembledWindow[] = [];
  // Window ending at index i (0-based) uses fragments [i-3 .. i] when (i-3) % 3 === 0
  // i.e. end sequence indices 3,6,9,... → positions 3,6,9 in 1-based count
  for (
    let endIdx = FRAGMENTS_PER_WINDOW - 1;
    endIdx < sorted.length;
    endIdx += FRAGMENT_STEP
  ) {
    const group = sorted.slice(
      endIdx - (FRAGMENTS_PER_WINDOW - 1),
      endIdx + 1,
    ) as [
      FinalizedFragment,
      FinalizedFragment,
      FinalizedFragment,
      FinalizedFragment,
    ];
    const start = group[0]!;
    const end = group[3]!;
    const uncertainty = estimateAnchorUncertaintyMs(group);
    windows.push({
      stream_epoch: epoch,
      sequence_no: end.sequence_no,
      fragment_sequences: [
        group[0]!.sequence_no,
        group[1]!.sequence_no,
        group[2]!.sequence_no,
        group[3]!.sequence_no,
      ],
      start_pts_ms: start.start_pts_ms,
      end_pts_ms: end.end_pts_ms,
      duration_ms: end.end_pts_ms - start.start_pts_ms,
      discontinuity_before:
        Boolean(options.discontinuityBeforeFirst) && windows.length === 0,
      media_signature: start.media_signature,
      fragment_paths: [
        group[0]!.path,
        group[1]!.path,
        group[2]!.path,
        group[3]!.path,
      ],
      media_sha256s: [
        group[0]!.media_sha256,
        group[1]!.media_sha256,
        group[2]!.media_sha256,
        group[3]!.media_sha256,
      ],
      window_start_at: start.program_date_time ?? start.finalized_at,
      // A-09: PDT tags the fragment *start*; end = start + PTS span (not last PDT alone).
      window_end_at: computeWindowEndAt(start, end),
      anchor_uncertainty_ms: uncertainty,
    });
  }

  const remainder = sorted.length % FRAGMENT_STEP;
  // After last full step, leftover fragments that cannot form a 4-group
  const usedThrough =
    windows.length === 0
      ? -1
      : windows[windows.length - 1]!.fragment_sequences[3]!;
  const leftover = sorted.filter((f) => f.sequence_no > usedThrough);
  let incomplete: IncompleteTail | null = null;
  if (leftover.length > 0 && leftover.length < FRAGMENTS_PER_WINDOW) {
    incomplete = {
      kind: 'incomplete',
      stream_epoch: epoch,
      fragment_count: leftover.length,
      sequences: leftover.map((f) => f.sequence_no),
      reason: 'insufficient_fragments',
    };
  } else if (windows.length === 0 && sorted.length < FRAGMENTS_PER_WINDOW) {
    incomplete = {
      kind: 'incomplete',
      stream_epoch: epoch,
      fragment_count: sorted.length,
      sequences: sorted.map((f) => f.sequence_no),
      reason: 'insufficient_fragments',
    };
  }

  void remainder;
  return { windows, incomplete };
}

/**
 * Wall-clock window end from receive/PDT anchors + actual PTS coverage.
 * EXT-X-PROGRAM-DATE-TIME marks the start of a segment, so the last fragment's
 * PDT alone is ~one fragment early for search/lag attribution.
 */
export function computeWindowEndAt(
  start: Pick<
    FinalizedFragment,
    'program_date_time' | 'finalized_at' | 'start_pts_ms'
  >,
  end: Pick<
    FinalizedFragment,
    'program_date_time' | 'finalized_at' | 'start_pts_ms' | 'end_pts_ms'
  >,
): string {
  const durationMs = Math.max(0, end.end_pts_ms - start.start_pts_ms);
  const startIso = start.program_date_time ?? start.finalized_at;
  const startMs = Date.parse(startIso);
  if (Number.isFinite(startMs)) {
    return new Date(startMs + durationMs).toISOString();
  }
  if (end.program_date_time) {
    const pdt = Date.parse(end.program_date_time);
    if (Number.isFinite(pdt)) {
      return new Date(
        pdt + Math.max(0, end.end_pts_ms - end.start_pts_ms),
      ).toISOString();
    }
  }
  return end.finalized_at;
}

function estimateAnchorUncertaintyMs(
  group: FinalizedFragment[],
): number {
  const deltas: number[] = [];
  for (const f of group) {
    if (!f.program_date_time) continue;
    const pdt = Date.parse(f.program_date_time);
    const fin = Date.parse(f.finalized_at);
    if (Number.isFinite(pdt) && Number.isFinite(fin)) {
      deltas.push(Math.abs(fin - pdt));
    }
  }
  if (deltas.length === 0) return 0;
  return Math.max(...deltas);
}

/** Detect whether a new fragment must open a new epoch. */
export function shouldOpenNewEpoch(
  previous: FinalizedFragment | null,
  next: {
    start_pts_ms: number;
    media_signature: string;
  },
): boolean {
  if (!previous) return false;
  if (next.media_signature !== previous.media_signature) return true;
  if (next.start_pts_ms < previous.start_pts_ms) return true;
  return false;
}
