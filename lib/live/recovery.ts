import fs from 'node:fs';
import path from 'node:path';
import {
  appendManifestRecord,
  manifestPath,
  pendingReplayChunkIds,
  readManifestRecords,
  reduceManifestWindows,
  type ManifestRecord,
  type WindowStateSummary,
} from './fragment-manifest';
import type { LiveWorkItem } from './queue';
import { sessionSpoolDir } from './spool-paths';
import type { LiveObservedState, LiveSessionDocument } from './types';

/**
 * Build a work-queue item from durable finalize/processed manifest metadata (A-14 / V-05).
 * Does not invent window_end_at / media_sha256 when the manifest already recorded them.
 */
export function buildRecoveryWorkItem(args: {
  sessionId: string;
  sessionDir: string;
  state: WindowStateSummary;
  defaultDurationMs: number;
  streamEpochFallback: number;
  nowIso?: string;
}): LiveWorkItem {
  const nowIso = args.nowIso ?? new Date().toISOString();
  const defaultMediaPath = path.join(
    args.sessionDir,
    'media',
    `${args.state.chunk_id}.mp4`,
  );
  const mediaPath =
    (args.state.media_path && fs.existsSync(args.state.media_path)
      ? args.state.media_path
      : undefined) ??
    (fs.existsSync(defaultMediaPath) ? defaultMediaPath : undefined);
  const monoRaw = args.state.receive_anchor_monotonic_ns;
  const monoNum =
    monoRaw != null && /^\d+$/.test(monoRaw)
      ? Number(BigInt(monoRaw) % BigInt(Number.MAX_SAFE_INTEGER))
      : undefined;
  return {
    chunk_id: args.state.chunk_id,
    session_id: args.sessionId,
    stream_epoch: args.state.stream_epoch ?? args.streamEpochFallback,
    sequence_no: args.state.sequence_no ?? 0,
    media_path: mediaPath,
    media_sha256: args.state.media_sha256,
    duration_ms: args.state.duration_ms ?? args.defaultDurationMs,
    window_end_at: args.state.window_end_at ?? nowIso,
    receive_anchor_utc: args.state.receive_anchor_utc ?? nowIso,
    receive_anchor_monotonic_ns: monoNum,
    enqueued_at: nowIso,
    state: 'queued',
    attempt: 1,
  };
}

/**
 * Global startup recovery: scan every session spool manifest before capture.
 * Manifest is the oracle for epoch/sequence and nonterminal replay.
 */

export const TERMINAL_OBSERVED: ReadonlySet<LiveObservedState> = new Set([
  'stopped',
  'failed',
]);

export interface SessionRecoveryPlan {
  session_id: string;
  session_dir: string;
  manifest_path: string;
  records: ManifestRecord[];
  windows: Map<string, WindowStateSummary>;
  replay_chunk_ids: string[];
  abandoned_chunk_ids: string[];
  next_stream_epoch: number;
  next_sequence_hint: number;
  corrupt: boolean;
  corrupt_error?: string;
}

export interface SourceClaimReconciliation {
  source_id: string;
  active_session_id: string;
  action: 'keep' | 'clear_missing_session' | 'clear_terminal_session';
}

function listSessionDirs(spoolRoot: string): string[] {
  const sessionsRoot = path.join(path.resolve(spoolRoot), 'sessions');
  if (!fs.existsSync(sessionsRoot)) return [];
  return fs
    .readdirSync(sessionsRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(sessionsRoot, d.name));
}

function maxEpochAndSequence(
  windows: Map<string, WindowStateSummary>,
  records: ManifestRecord[],
): { nextEpoch: number; nextSequenceHint: number } {
  let maxEpoch = 0;
  let maxSeqInMaxEpoch = 0;
  for (const w of windows.values()) {
    const epoch = w.stream_epoch ?? 0;
    const seq = w.sequence_no ?? 0;
    if (epoch > maxEpoch) {
      maxEpoch = epoch;
      maxSeqInMaxEpoch = seq;
    } else if (epoch === maxEpoch && seq > maxSeqInMaxEpoch) {
      maxSeqInMaxEpoch = seq;
    }
  }
  for (const r of records) {
    if (r.type === 'epoch_started' && typeof r.stream_epoch === 'number') {
      maxEpoch = Math.max(maxEpoch, r.stream_epoch);
    }
  }
  return {
    nextEpoch: Math.max(1, maxEpoch),
    nextSequenceHint: maxSeqInMaxEpoch + 1,
  };
}

/**
 * Reconcile allocated-but-not-finalized windows: append window_abandoned and
 * delete matching temporary publish paths when present.
 */
export function abandonOrphanAllocations(
  sessionDir: string,
  records: ManifestRecord[],
): string[] {
  const windows = reduceManifestWindows(records);
  const abandoned: string[] = [];
  const mp = manifestPath(sessionDir);

  for (const [chunkId, state] of windows) {
    if (state.status !== 'allocated') continue;
    appendManifestRecord(mp, {
      type: 'window_abandoned',
      chunk_id: chunkId,
      stream_epoch: state.stream_epoch,
      sequence_no: state.sequence_no,
      reason: 'recovery_orphan_allocation',
    });
    abandoned.push(chunkId);

    // Best-effort cleanup of partial remux / tmp files for this chunk.
    const tmpDir = path.join(sessionDir, 'tmp');
    if (fs.existsSync(tmpDir)) {
      for (const name of fs.readdirSync(tmpDir)) {
        if (name.includes(chunkId)) {
          try {
            fs.unlinkSync(path.join(tmpDir, name));
          } catch {
            // ignore
          }
        }
      }
    }
  }
  return abandoned;
}

export function recoverSessionDir(sessionDir: string): SessionRecoveryPlan {
  const session_id = path.basename(sessionDir);
  const mp = manifestPath(sessionDir);
  let records: ManifestRecord[] = [];
  let corrupt = false;
  let corrupt_error: string | undefined;
  try {
    records = readManifestRecords(mp);
  } catch (err) {
    corrupt = true;
    corrupt_error = err instanceof Error ? err.message : String(err);
  }

  const abandoned_chunk_ids = corrupt
    ? []
    : abandonOrphanAllocations(sessionDir, records);

  // Re-read after abandon appends.
  if (!corrupt && abandoned_chunk_ids.length > 0) {
    records = readManifestRecords(mp);
  }

  const windows = reduceManifestWindows(records);
  const replay_chunk_ids = corrupt ? [] : pendingReplayChunkIds(records);
  const { nextEpoch, nextSequenceHint } = maxEpochAndSequence(windows, records);

  appendManifestRecord(mp, {
    type: 'recovery_event',
    session_id,
    abandoned_count: abandoned_chunk_ids.length,
    replay_count: replay_chunk_ids.length,
    corrupt,
    ...(corrupt_error ? { corrupt_error } : {}),
  });

  return {
    session_id,
    session_dir: sessionDir,
    manifest_path: mp,
    records: readManifestRecords(mp),
    windows: reduceManifestWindows(readManifestRecords(mp)),
    replay_chunk_ids,
    abandoned_chunk_ids,
    next_stream_epoch: nextEpoch,
    next_sequence_hint: nextSequenceHint,
    corrupt,
    corrupt_error,
  };
}

/**
 * Scan all session spools under LIVE_SPOOL_DIR before accepting new capture.
 */
export function scanAllSessionManifests(spoolRoot: string): SessionRecoveryPlan[] {
  const dirs = listSessionDirs(spoolRoot);
  return dirs.map((dir) => recoverSessionDir(dir));
}

export function planForSession(
  spoolRoot: string,
  sessionId: string,
): SessionRecoveryPlan {
  return recoverSessionDir(sessionSpoolDir(spoolRoot, sessionId));
}

/**
 * Decide whether a source active_session_id claim should be cleared.
 * Clear when the session document is missing or terminal.
 */
export function reconcileSourceClaim(args: {
  source_id: string;
  active_session_id: string;
  session: LiveSessionDocument | null;
}): SourceClaimReconciliation {
  if (!args.session) {
    return {
      source_id: args.source_id,
      active_session_id: args.active_session_id,
      action: 'clear_missing_session',
    };
  }
  if (TERMINAL_OBSERVED.has(args.session.observed_state)) {
    return {
      source_id: args.source_id,
      active_session_id: args.active_session_id,
      action: 'clear_terminal_session',
    };
  }
  return {
    source_id: args.source_id,
    active_session_id: args.active_session_id,
    action: 'keep',
  };
}
