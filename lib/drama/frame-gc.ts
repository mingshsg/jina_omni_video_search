/**
 * P3 frame GC (plan/12 OQ-2): delete disposable intermediate frames after the
 * drama run finishes (or fails terminally), keeping SRT / scripts /
 * structure.json / verified face & scene thumbs.
 *
 * Only `drama/<run_id>/frames/` and 1fps-like intermediate dirs are eligible.
 * Deletion is idempotent and safe to re-run. Age guard (DRAMA_GC_MIN_AGE_MS)
 * prevents racing a still-running enrichment.
 */
import fs from 'node:fs';
import path from 'node:path';
import { getConfig } from '../config';
import { getDramaEnv } from './env';

const DISPOSABLE_DIR_NAMES = new Set(['frames', 'work', 'tmp']);

export interface GcResult {
  scanned: number;
  deleted: number;
  freedBytes: number;
  kept: string[];
}

/**
 * Remove disposable dirs under a drama run workspace.
 * `runId` empty ⇒ scan the whole drama root under MEDIA_ROOT/media/<videoId>.
 * `ignoreAgeGuard` bypasses the freshness guard — pass ONLY for the
 * caller's own just-finished (terminal) run: the guard exists to protect
 * *active* runs, and the runner holds the per-video lease until after
 * cleanup, so no other run can be using these frames (F7/R10).
 */
export function cleanupDramaFrames(opts: {
  videoId: string;
  runId?: string;
  now?: number;
  ignoreAgeGuard?: boolean;
}): GcResult {
  const cfg = getConfig();
  const env = getDramaEnv();
  const now = opts.now ?? Date.now();
  const minAge = env.DRAMA_GC_MIN_AGE_MS;

  const dramaRoot = path.resolve(
    cfg.MEDIA_ROOT,
    'media',
    opts.videoId,
    'drama',
  );
  if (!fs.existsSync(dramaRoot)) {
    return { scanned: 0, deleted: 0, freedBytes: 0, kept: [] };
  }

  const runDirs = opts.runId
    ? [path.join(dramaRoot, opts.runId)]
    : fs
        .readdirSync(dramaRoot, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => path.join(dramaRoot, d.name));

  let scanned = 0;
  let deleted = 0;
  let freedBytes = 0;
  const kept: string[] = [];

  for (const runDir of runDirs) {
    if (!fs.existsSync(runDir)) continue;
    const stat = fs.statSync(runDir);
    if (!opts.ignoreAgeGuard && now - stat.mtimeMs < minAge) continue; // still fresh — skip

    for (const entry of fs.readdirSync(runDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (!DISPOSABLE_DIR_NAMES.has(entry.name)) continue;
      const target = path.join(runDir, entry.name);
      const size = dirSize(target);
      try {
        fs.rmSync(target, { recursive: true, force: true });
        deleted += 1;
        freedBytes += size;
      } catch {
        kept.push(target);
      }
      scanned += 1;
    }
  }

  return { scanned, deleted, freedBytes, kept };
}

function dirSize(dir: string): number {
  let total = 0;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        total += dirSize(p);
      } else if (entry.isFile()) {
        total += fs.statSync(p).size;
      }
    }
  } catch {
    /* ignore */
  }
  return total;
}

export interface OrphanSweepResult {
  scannedRuns: number;
  deleted: number;
  freedBytes: number;
  kept: string[];
  stoppedEarly: boolean;
}

/**
 * Bounded operator sweep for aged crash orphans (I7), independent of any
 * later run for the same video. Only disposable dirs (`frames`/`work`/
 * `tmp`) older than the age guard are eligible — the age gate IS the
 * active-run exclusion (an actively-written run is fresh). Deletions and
 * scanned runs are both capped so one invocation cannot roam the disk.
 */
export function sweepAgedDramaOrphans(opts: {
  mediaRoot: string;
  minAgeMs?: number;
  maxDirs?: number;
  maxScanRuns?: number;
  now?: number;
}): OrphanSweepResult {
  const env = getDramaEnv();
  const now = opts.now ?? Date.now();
  const minAge = opts.minAgeMs ?? env.DRAMA_GC_MIN_AGE_MS;
  const maxDirs = opts.maxDirs ?? 100;
  const maxScanRuns = opts.maxScanRuns ?? 500;
  const mediaDir = path.resolve(opts.mediaRoot, 'media');

  const out: OrphanSweepResult = {
    scannedRuns: 0,
    deleted: 0,
    freedBytes: 0,
    kept: [],
    stoppedEarly: false,
  };
  if (maxDirs <= 0 || maxScanRuns <= 0) return { ...out, stoppedEarly: true };

  let videos: string[];
  try {
    videos = fs
      .readdirSync(mediaDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  } catch {
    return out;
  }

  for (const videoId of videos) {
    const dramaRoot = path.join(mediaDir, videoId, 'drama');
    let runs: string[];
    try {
      runs = fs
        .readdirSync(dramaRoot, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort();
    } catch {
      continue;
    }
    for (const runId of runs) {
      if (out.scannedRuns >= maxScanRuns || out.deleted >= maxDirs) {
        return { ...out, stoppedEarly: true };
      }
      const runDir = path.join(dramaRoot, runId);
      out.scannedRuns += 1;
      let stat: fs.Stats;
      try {
        stat = fs.statSync(runDir);
      } catch {
        continue;
      }
      if (now - stat.mtimeMs < minAge) continue; // fresh — possibly active
      let entries;
      try {
        entries = fs.readdirSync(runDir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isDirectory() || !DISPOSABLE_DIR_NAMES.has(entry.name)) {
          continue;
        }
        if (out.deleted >= maxDirs) {
          return { ...out, stoppedEarly: true };
        }
        const target = path.join(runDir, entry.name);
        const size = dirSize(target);
        try {
          fs.rmSync(target, { recursive: true, force: true });
          out.deleted += 1;
          out.freedBytes += size;
        } catch {
          out.kept.push(target);
        }
      }
    }
  }
  return out;
}
