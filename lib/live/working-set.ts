import fs from 'node:fs';
import {
  FRAGMENT_STEP,
  FRAGMENTS_PER_WINDOW,
  assembleWindowsFromFragments,
  type FinalizedFragment,
} from './window-assembler';

/**
 * Capture working-set bounds (A-10).
 * Retained media/ stays forever; this only bounds HLS playlist + in-memory
 * fragment/window bookkeeping and deletes consumed MPEG-TS fragments.
 */

/** HLS playlist entries kept by FFmpeg (no delete_segments — we prune .ts ourselves). */
export function hlsPlaylistListSize(
  fragmentsPerWindow: number = FRAGMENTS_PER_WINDOW,
  fragmentStep: number = FRAGMENT_STEP,
): number {
  // One full window + next step + small margin so the watcher can observe
  // segments before they rotate out of the playlist text.
  return Math.max(8, fragmentsPerWindow + fragmentStep + 1);
}

export interface PruneWorkingSetResult {
  fragments: FinalizedFragment[];
  emittedWindows: Set<string>;
  /** Absolute paths of pruned fragment files (caller may unlink). */
  prunedPaths: string[];
  /** Lowest sequence retained; undefined when nothing pruned. */
  retainFromSequence?: number;
}

/**
 * After windows are finalized, keep only the overlap needed for the next window
 * (fragments with sequence_no >= last emitted window end) plus any incomplete tail.
 */
export function pruneCaptureWorkingSet(args: {
  fragments: FinalizedFragment[];
  emittedWindows: Set<string>;
  sessionId: string;
}): PruneWorkingSetResult {
  if (args.fragments.length === 0) {
    return {
      fragments: [],
      emittedWindows: new Set(args.emittedWindows),
      prunedPaths: [],
    };
  }

  const { windows } = assembleWindowsFromFragments(args.fragments, {
    nominalFragmentMs: 2000,
  });
  if (windows.length === 0) {
    return {
      fragments: [...args.fragments],
      emittedWindows: new Set(args.emittedWindows),
      prunedPaths: [],
    };
  }

  const lastEnd = windows[windows.length - 1]!.sequence_no;
  // Next window starts at lastEnd (overlap = FRAGMENTS_PER_WINDOW - FRAGMENT_STEP).
  const retainFrom = lastEnd;
  const kept: FinalizedFragment[] = [];
  const prunedPaths: string[] = [];
  for (const f of args.fragments) {
    if (f.sequence_no >= retainFrom) {
      kept.push(f);
    } else {
      prunedPaths.push(f.path);
    }
  }

  const emitted = new Set<string>();
  const prefix = `${args.sessionId}_`;
  for (const chunkId of args.emittedWindows) {
    if (!chunkId.startsWith(prefix)) {
      emitted.add(chunkId);
      continue;
    }
    const parts = chunkId.split('_');
    const seqStr = parts[parts.length - 1];
    const seq = Number(seqStr);
    // Keep guards for the overlap end sequence and any still-future IDs.
    if (!Number.isFinite(seq) || seq >= retainFrom) {
      emitted.add(chunkId);
    }
  }

  return {
    fragments: kept,
    emittedWindows: emitted,
    prunedPaths,
    retainFromSequence: retainFrom,
  };
}

/** Best-effort unlink of pruned capture fragments (not retained media/). */
export function unlinkPrunedFragmentFiles(paths: readonly string[]): number {
  let removed = 0;
  for (const p of paths) {
    try {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) {
        fs.unlinkSync(p);
        removed += 1;
      }
    } catch {
      // Ignore races with FFmpeg or already-deleted segments.
    }
  }
  return removed;
}
