import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

/**
 * Versioned append-only JSONL session manifest (recovery oracle).
 * Schema version 1 — Phase 3 lands recovery-critical record types.
 */

export class ManifestReserveError extends Error {
  readonly code = 'LIVE_MANIFEST_RESERVE' as const;
  constructor(
    message: string,
    readonly freeBytes: number,
    readonly reserveBytes: number,
  ) {
    super(message);
    this.name = 'ManifestReserveError';
  }
}

function freeBytesForDir(dir: string): number {
  const target = fs.existsSync(dir) ? dir : path.dirname(dir);
  const st = fs.statfsSync(target);
  return Number(st.bavail) * Number(st.bsize);
}

export const MANIFEST_SCHEMA_VERSION = 1 as const;

export type ManifestRecordType =
  | 'epoch_started'
  | 'fragment_finalized'
  | 'window_allocated'
  | 'window_finalized'
  | 'window_processed'
  | 'window_abandoned'
  | 'window_incomplete'
  | 'window_failed'
  | 'window_dropped'
  | 'index_attempt'
  | 'event_intent'
  | 'event_ready'
  | 'event_published'
  | 'intent_abandoned'
  | 'index_ack'
  | 'media_expired'
  | 'recovery_event';

export interface ManifestRecordBase {
  schema_version: typeof MANIFEST_SCHEMA_VERSION;
  type: ManifestRecordType;
  record_id: string;
  at: string;
}

export type ManifestRecord = ManifestRecordBase & Record<string, unknown>;

export interface WindowStateSummary {
  chunk_id: string;
  status:
    | 'allocated'
    | 'finalized'
    | 'processed'
    | 'pending_ack'
    | 'acknowledged'
    | 'failed'
    | 'incomplete'
    | 'dropped'
    | 'abandoned'
    | 'expired';
  sequence_no?: number;
  stream_epoch?: number;
  /** A-14: restored from window_finalized / window_processed for idempotent replay. */
  media_path?: string;
  media_sha256?: string;
  duration_ms?: number;
  window_end_at?: string;
  receive_anchor_utc?: string;
  receive_anchor_monotonic_ns?: string;
  immutable_fingerprint?: string;
  start_pts_ms?: number;
  end_pts_ms?: number;
}

function newRecordId(type: string): string {
  return `${type}_${Date.now().toString(36)}_${createHash('sha1')
    .update(Math.random().toString())
    .digest('hex')
    .slice(0, 8)}`;
}

export function manifestPath(sessionDir: string): string {
  return path.join(sessionDir, 'manifest.jsonl');
}

/** Remove a truncated final line; return valid records. */
export function readManifestRecords(filePath: string): ManifestRecord[] {
  if (!fs.existsSync(filePath)) return [];
  const text = fs.readFileSync(filePath, 'utf8');
  if (!text) return [];
  const lines = text.split('\n');
  // Drop trailing empty line from final newline
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  if (lines.length === 0) return [];

  const records: ManifestRecord[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const isLast = i === lines.length - 1;
    try {
      const obj = JSON.parse(line) as ManifestRecord;
      if (!obj || typeof obj !== 'object' || !obj.type) {
        throw new Error('missing type');
      }
      records.push(obj);
    } catch {
      if (isLast) {
        // Truncate corrupt tail
        const keep = lines.slice(0, -1).join('\n');
        fs.writeFileSync(
          filePath,
          keep.length ? `${keep}\n` : '',
          'utf8',
        );
        break;
      }
      throw new Error(
        `Manifest corrupt before final line at index ${i}: ${filePath}`,
      );
    }
  }
  return records;
}

export function appendManifestRecord(
  filePath: string,
  record: Omit<ManifestRecord, 'record_id' | 'at' | 'schema_version'> &
    Partial<Pick<ManifestRecord, 'record_id' | 'at' | 'schema_version'>> & {
      type: ManifestRecordType;
    },
  options?: {
    /**
     * Require at least this many free bytes on the spool filesystem before
     * appending (A-17 / LIVE_MANIFEST_RESERVE_BYTES terminal-record headroom).
     */
    reserveBytes?: number;
    /** Injected for tests. */
    freeBytesReader?: (dir: string) => number;
  },
): ManifestRecord {
  const reserveBytes = options?.reserveBytes;
  if (reserveBytes != null && reserveBytes > 0) {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    const reader = options?.freeBytesReader ?? freeBytesForDir;
    const free = reader(dir);
    if (free < reserveBytes) {
      throw new ManifestReserveError(
        `manifest reserve: free ${free} < ${reserveBytes}`,
        free,
        reserveBytes,
      );
    }
  }
  const recordType = record.type;
  const full: ManifestRecord = {
    ...record,
    schema_version: MANIFEST_SCHEMA_VERSION,
    record_id: record.record_id ?? newRecordId(String(recordType)),
    at: record.at ?? new Date().toISOString(),
    type: recordType,
  };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(full)}\n`, 'utf8');
  // Best-effort directory durability hint (fsync of dir is OS-specific).
  try {
    const fd = fs.openSync(filePath, 'r');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
  } catch {
    // ignore on platforms that disallow
  }
  return full;
}

/**
 * Reduce manifest to per-chunk_id terminal/pending status.
 * Later terminal records win over earlier ones.
 */
export function reduceManifestWindows(
  records: ManifestRecord[],
): Map<string, WindowStateSummary> {
  const byChunk = new Map<string, WindowStateSummary>();

  const setStatus = (
    chunkId: string,
    status: WindowStateSummary['status'],
    extra?: Partial<WindowStateSummary>,
  ) => {
    const prev = byChunk.get(chunkId);
    byChunk.set(chunkId, {
      chunk_id: chunkId,
      status,
      sequence_no: extra?.sequence_no ?? prev?.sequence_no,
      stream_epoch: extra?.stream_epoch ?? prev?.stream_epoch,
      media_path: extra?.media_path ?? prev?.media_path,
      media_sha256: extra?.media_sha256 ?? prev?.media_sha256,
      duration_ms: extra?.duration_ms ?? prev?.duration_ms,
      window_end_at: extra?.window_end_at ?? prev?.window_end_at,
      receive_anchor_utc:
        extra?.receive_anchor_utc ?? prev?.receive_anchor_utc,
      receive_anchor_monotonic_ns:
        extra?.receive_anchor_monotonic_ns ??
        prev?.receive_anchor_monotonic_ns,
      immutable_fingerprint:
        extra?.immutable_fingerprint ?? prev?.immutable_fingerprint,
      start_pts_ms: extra?.start_pts_ms ?? prev?.start_pts_ms,
      end_pts_ms: extra?.end_pts_ms ?? prev?.end_pts_ms,
    });
  };

  const recoveryFieldsFromRecord = (
    r: ManifestRecord,
  ): Partial<WindowStateSummary> => ({
    sequence_no: numberOrUndef(r.sequence_no),
    stream_epoch: numberOrUndef(r.stream_epoch),
    media_path: stringOrUndef(r.media_path),
    media_sha256: stringOrUndef(r.media_sha256),
    duration_ms: numberOrUndef(r.duration_ms),
    window_end_at: stringOrUndef(r.window_end_at),
    receive_anchor_utc: stringOrUndef(r.receive_anchor_utc),
    receive_anchor_monotonic_ns: stringOrUndef(r.receive_anchor_monotonic_ns),
    immutable_fingerprint: stringOrUndef(r.immutable_fingerprint),
    start_pts_ms: numberOrUndef(r.start_pts_ms),
    end_pts_ms: numberOrUndef(r.end_pts_ms),
  });

  for (const r of records) {
    const chunkId = typeof r.chunk_id === 'string' ? r.chunk_id : undefined;
    switch (r.type) {
      case 'window_allocated':
        if (chunkId) {
          setStatus(chunkId, 'allocated', {
            sequence_no: numberOrUndef(r.sequence_no),
            stream_epoch: numberOrUndef(r.stream_epoch),
          });
        }
        break;
      case 'window_finalized':
        if (chunkId) {
          setStatus(chunkId, 'finalized', recoveryFieldsFromRecord(r));
        }
        break;
      case 'window_processed':
        if (chunkId) {
          setStatus(chunkId, 'processed', recoveryFieldsFromRecord(r));
        }
        break;
      case 'event_intent':
        if (chunkId) setStatus(chunkId, 'pending_ack');
        break;
      case 'index_ack':
        if (chunkId) setStatus(chunkId, 'acknowledged');
        break;
      case 'window_failed':
        if (chunkId) setStatus(chunkId, 'failed');
        break;
      case 'window_incomplete':
        if (chunkId) setStatus(chunkId, 'incomplete');
        break;
      case 'window_dropped':
        if (chunkId) setStatus(chunkId, 'dropped');
        break;
      case 'window_abandoned':
        if (chunkId) setStatus(chunkId, 'abandoned');
        break;
      case 'media_expired':
        if (chunkId) setStatus(chunkId, 'expired');
        break;
      default:
        break;
    }
  }
  return byChunk;
}

function numberOrUndef(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function stringOrUndef(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** Windows eligible for indexing replay (finalized/processed, not terminal-excluded). */
export function pendingReplayChunkIds(
  records: ManifestRecord[],
): string[] {
  const states = reduceManifestWindows(records);
  const out: string[] = [];
  for (const s of states.values()) {
    if (
      s.status === 'finalized' ||
      s.status === 'processed' ||
      s.status === 'pending_ack'
    ) {
      out.push(s.chunk_id);
    }
  }
  return out;
}

export function sha256File(filePath: string): string {
  const hash = createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return `sha256:${hash.digest('hex')}`;
}
