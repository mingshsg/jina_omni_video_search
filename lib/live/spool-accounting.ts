import fs from 'node:fs';
import path from 'node:path';

/**
 * Spool usage accounting + retention interface.
 * Product decision: retain until explicit delete (no age-based purge).
 * Optional byte caps may be unset (unlimited retained growth).
 * Soft free-space floor (default 50 GiB) applies backpressure before the disk fills.
 */

export type RetentionMode = 'until_explicit_delete';

/** Default soft free-space floor: 50 GiB. */
export const DEFAULT_SPOOL_MIN_FREE_BYTES = 50 * 1024 * 1024 * 1024;

export interface SpoolUsageSnapshot {
  root: string;
  totalBytes: number;
  pendingBytes: number;
  retainedMediaBytes: number;
  fileCount: number;
}

export interface RetentionPolicy {
  mode: RetentionMode;
  pendingMaxBytes?: number;
  retainedMediaMaxBytes?: number;
  /** Soft free-space floor; undefined/0 = disabled. */
  minFreeBytes?: number;
}

export function defaultRetentionPolicy(options?: {
  pendingMaxBytes?: number;
  retainedMediaMaxBytes?: number;
  minFreeBytes?: number;
}): RetentionPolicy {
  return {
    mode: 'until_explicit_delete',
    pendingMaxBytes: options?.pendingMaxBytes,
    retainedMediaMaxBytes: options?.retainedMediaMaxBytes,
    minFreeBytes: options?.minFreeBytes,
  };
}

export function directoryByteSize(dir: string): {
  bytes: number;
  files: number;
} {
  if (!fs.existsSync(dir)) return { bytes: 0, files: 0 };
  let bytes = 0;
  let files = 0;
  const walk = (d: string) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.isFile()) {
        bytes += fs.statSync(p).size;
        files += 1;
      }
    }
  };
  walk(dir);
  return { bytes, files };
}

export function measureSpoolUsage(sessionDir: string): SpoolUsageSnapshot {
  const fragments = directoryByteSize(path.join(sessionDir, 'fragments'));
  const media = directoryByteSize(path.join(sessionDir, 'media'));
  const tmp = directoryByteSize(path.join(sessionDir, 'tmp'));
  return {
    root: sessionDir,
    totalBytes: fragments.bytes + media.bytes + tmp.bytes,
    pendingBytes: fragments.bytes + tmp.bytes,
    retainedMediaBytes: media.bytes,
    fileCount: fragments.files + media.files + tmp.files,
  };
}

export type SpoolPressure =
  | { level: 'ok' }
  | { level: 'pending_soft'; pendingBytes: number; max: number }
  | { level: 'pending_hard'; pendingBytes: number; max: number }
  | { level: 'retained_hard'; retainedBytes: number; max: number }
  | {
      level: 'disk_free_low';
      freeBytes: number;
      minFreeBytes: number;
    };

export type DiskFreeReader = (dir: string) => number;

/**
 * Read free bytes for the filesystem containing `dir`.
 * Uses Node `fs.statfsSync` (Node 18.15+ / 20+).
 */
export function readDiskFreeBytes(dir: string): number {
  const target = fs.existsSync(dir) ? dir : path.dirname(dir);
  const st = fs.statfsSync(target);
  return Number(st.bavail) * Number(st.bsize);
}

/** Soft free-space floor: free < min → disk_free_low. Unlimited min never pressures. */
export function evaluateDiskFreePressure(
  freeBytes: number,
  minFreeBytes: number | undefined,
): Extract<SpoolPressure, { level: 'ok' } | { level: 'disk_free_low' }> {
  if (minFreeBytes == null || minFreeBytes <= 0) {
    return { level: 'ok' };
  }
  if (freeBytes < minFreeBytes) {
    return { level: 'disk_free_low', freeBytes, minFreeBytes };
  }
  return { level: 'ok' };
}

/** Soft = 80% of cap; hard = at/over cap. Unlimited caps never pressure. */
export function evaluateSpoolPressure(
  usage: SpoolUsageSnapshot,
  policy: RetentionPolicy,
  options?: { freeBytes?: number },
): SpoolPressure {
  if (options?.freeBytes !== undefined) {
    const disk = evaluateDiskFreePressure(
      options.freeBytes,
      policy.minFreeBytes,
    );
    if (disk.level !== 'ok') return disk;
  }
  if (
    policy.pendingMaxBytes != null &&
    policy.pendingMaxBytes > 0 &&
    usage.pendingBytes >= policy.pendingMaxBytes
  ) {
    return {
      level: 'pending_hard',
      pendingBytes: usage.pendingBytes,
      max: policy.pendingMaxBytes,
    };
  }
  if (
    policy.pendingMaxBytes != null &&
    policy.pendingMaxBytes > 0 &&
    usage.pendingBytes >= policy.pendingMaxBytes * 0.8
  ) {
    return {
      level: 'pending_soft',
      pendingBytes: usage.pendingBytes,
      max: policy.pendingMaxBytes,
    };
  }
  if (
    policy.retainedMediaMaxBytes != null &&
    policy.retainedMediaMaxBytes > 0 &&
    usage.retainedMediaBytes >= policy.retainedMediaMaxBytes
  ) {
    return {
      level: 'retained_hard',
      retainedBytes: usage.retainedMediaBytes,
      max: policy.retainedMediaMaxBytes,
    };
  }
  return { level: 'ok' };
}

/**
 * Age-based expiry is disabled by default. Explicit ops age-delete (A-20)
 * via `runLiveAgeDelete` / `POST /api/live/ops/age-delete` is the reclaim path;
 * protect ranges (`POST /api/live/ops/protect-ranges`) exclude kept windows.
 * This helper remains a typed no-op for silent wall-clock purge.
 */
export function listExpiredMediaRefs(_args: {
  now: Date;
  policy: RetentionPolicy;
}): string[] {
  return [];
}
