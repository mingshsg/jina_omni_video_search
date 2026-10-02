/**
 * Operator sweep for drama run workspaces that no longer back any result
 * (todo/50 F8). `persistDramaMeta` keeps the current run plus the newest
 * `DRAMA_RUN_HISTORY_MAX` prior runs; an older run drops out of
 * `meta.drama.runs` but its `MEDIA_ROOT/media/<videoId>/drama/<runId>/`
 * directory, including published subtitles and scripts, stays on disk.
 *
 * Report-only unless `apply` is set. A run directory is deleted only when
 * the asset exists, no persisted drama status for it is active, no field on
 * the asset references the run, and nothing in the directory tree is newer
 * than the age guard. The in-process run lease is not visible from a script, so the
 * active-status and age checks stand in for it.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { VideoAssetDocument } from '../es/index-assets';
import { DRAMA_ACTIVE_STATUSES } from '../ingest/drama-options';
import type { DramaMetaPayload } from './persist-meta';

export interface TrimmedRunCandidate {
  videoId: string;
  runId: string;
  bytes: number;
}

export interface TrimmedRunSkip {
  videoId: string;
  reason: 'asset_missing' | 'run_active' | 'scan_error';
  runId?: string;
}

export interface TrimmedRunSweepResult {
  applied: boolean;
  scannedVideos: number;
  candidates: TrimmedRunCandidate[];
  deleted: number;
  freedBytes: number;
  kept: string[];
  skipped: TrimmedRunSkip[];
  stoppedEarly: boolean;
}

const SAFE_SEGMENT = /^[\w.-]+$/;

function metaDrama(asset: VideoAssetDocument): DramaMetaPayload | undefined {
  return (asset.meta as { drama?: DramaMetaPayload } | undefined)?.drama;
}

/** Every run ID the asset still points at (current, history, job record). */
export function referencedDramaRunIds(asset: VideoAssetDocument): Set<string> {
  const ids = new Set<string>();
  const drama = metaDrama(asset);
  if (drama?.run_id) ids.add(drama.run_id);
  for (const run of drama?.runs ?? []) {
    if (run.run_id) ids.add(run.run_id);
  }
  if (asset.job?.drama?.run_id) ids.add(asset.job.drama.run_id);
  return ids;
}

function hasActiveDramaStatus(asset: VideoAssetDocument): boolean {
  const active = DRAMA_ACTIVE_STATUSES as readonly string[];
  const metaStatus = metaDrama(asset)?.enrichment_status;
  const jobStatus = asset.job?.drama?.status;
  return Boolean(
    (metaStatus && active.includes(metaStatus)) ||
      (jobStatus && active.includes(jobStatus)),
  );
}

/**
 * Total size and newest mtime anywhere in the tree. A long run writing only
 * into subdirectories leaves the run directory's own mtime old, so the age
 * guard must use the newest entry.
 *
 * Fails closed: any entry this can't fully stat (an unreadable subdirectory,
 * or a file that vanished between `readdir` and `stat` — evidence of
 * concurrent activity either way) sets `complete: false`, so the caller
 * skips the run instead of treating the unreadable part as "nothing newer"
 * (G1 — a GC guard must not silently under-report recency).
 */
function treeStats(dir: string): {
  bytes: number;
  newestMtimeMs: number;
  complete: boolean;
} {
  let bytes = 0;
  let newestMtimeMs: number;
  try {
    newestMtimeMs = fs.statSync(dir).mtimeMs;
  } catch {
    return { bytes: 0, newestMtimeMs: 0, complete: false };
  }
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return { bytes, newestMtimeMs, complete: false };
  }
  let complete = true;
  for (const entry of entries) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = treeStats(p);
      bytes += sub.bytes;
      newestMtimeMs = Math.max(newestMtimeMs, sub.newestMtimeMs);
      if (!sub.complete) complete = false;
    } else if (entry.isFile()) {
      try {
        const stat = fs.statSync(p);
        bytes += stat.size;
        newestMtimeMs = Math.max(newestMtimeMs, stat.mtimeMs);
      } catch {
        complete = false;
      }
    }
  }
  return { bytes, newestMtimeMs, complete };
}

function listDirs(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && SAFE_SEGMENT.test(d.name))
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
}

export async function sweepTrimmedDramaRuns(opts: {
  mediaRoot: string;
  getAsset: (videoId: string) => Promise<VideoAssetDocument | null>;
  minAgeMs: number;
  apply?: boolean;
  maxRuns?: number;
  maxScanVideos?: number;
  now?: number;
}): Promise<TrimmedRunSweepResult> {
  const now = opts.now ?? Date.now();
  const maxRuns = opts.maxRuns ?? 50;
  const maxScanVideos = opts.maxScanVideos ?? 500;
  const mediaDir = path.resolve(opts.mediaRoot, 'media');
  const out: TrimmedRunSweepResult = {
    applied: Boolean(opts.apply),
    scannedVideos: 0,
    candidates: [],
    deleted: 0,
    freedBytes: 0,
    kept: [],
    skipped: [],
    stoppedEarly: false,
  };

  for (const videoId of listDirs(mediaDir)) {
    const dramaRoot = path.join(mediaDir, videoId, 'drama');
    const runIds = listDirs(dramaRoot);
    if (runIds.length === 0) continue;
    if (out.scannedVideos >= maxScanVideos) {
      out.stoppedEarly = true;
      break;
    }
    out.scannedVideos += 1;

    const asset = await opts.getAsset(videoId);
    if (!asset) {
      out.skipped.push({ videoId, reason: 'asset_missing' });
      continue;
    }
    if (hasActiveDramaStatus(asset)) {
      out.skipped.push({ videoId, reason: 'run_active' });
      continue;
    }
    const referenced = referencedDramaRunIds(asset);

    for (const runId of runIds) {
      if (referenced.has(runId)) continue;
      const runDir = path.join(dramaRoot, runId);
      const { bytes, newestMtimeMs, complete } = treeStats(runDir);
      if (!complete) {
        out.skipped.push({ videoId, runId, reason: 'scan_error' });
        continue;
      }
      if (newestMtimeMs === 0 || now - newestMtimeMs < opts.minAgeMs) continue;
      if (out.candidates.length >= maxRuns) {
        out.stoppedEarly = true;
        return out;
      }
      out.candidates.push({ videoId, runId, bytes });
      if (!opts.apply) continue;
      try {
        fs.rmSync(runDir, { recursive: true, force: true });
        out.deleted += 1;
        out.freedBytes += bytes;
      } catch {
        out.kept.push(runDir);
      }
    }
  }
  return out;
}
