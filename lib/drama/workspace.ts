/**
 * Drama run workspace under MEDIA_ROOT (plan/12).
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getConfig } from '../config';

export interface DramaWorkspace {
  runId: string;
  rootDir: string;
  audioDir: string;
  subtitlesDir: string;
  metaPath: string;
  structurePath: string;
}

export function createDramaWorkspace(videoId: string): DramaWorkspace {
  return openDramaWorkspace(videoId, newDramaRunId());
}

/** Fresh random run ID (12 hex chars). */
export function newDramaRunId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 12);
}

/**
 * Run IDs travel through ES docs and retry requests — validate before
 * using one as a path segment so a crafted value cannot escape the
 * drama root (F1).
 */
export function isSafeDramaRunId(v: unknown): v is string {
  return typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v);
}

/**
 * Reopen the workspace of an existing run (retry path). Same run ID ⇒
 * same artifact paths and same subtitle bulk `_id`s, so a retry
 * overwrites rather than duplicates (F1).
 */
export function openDramaWorkspace(
  videoId: string,
  runId: string,
): DramaWorkspace {
  if (!isSafeDramaRunId(runId)) {
    throw new Error(`Unsafe drama run_id: ${String(runId).slice(0, 40)}`);
  }
  const cfg = getConfig();
  const rootDir = path.resolve(cfg.MEDIA_ROOT, 'media', videoId, 'drama', runId);
  const audioDir = path.join(rootDir, 'audio');
  const subtitlesDir = path.join(rootDir, 'subtitles');
  fs.mkdirSync(audioDir, { recursive: true });
  fs.mkdirSync(subtitlesDir, { recursive: true });
  return {
    runId,
    rootDir,
    audioDir,
    subtitlesDir,
    metaPath: path.join(rootDir, 'meta.json'),
    structurePath: path.join(rootDir, 'structure.json'),
  };
}

export function writeDramaJson(filePath: string, value: unknown): void {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
