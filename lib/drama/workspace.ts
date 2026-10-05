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

/** Open the workspace assigned to this generation (including a prepared handoff). */
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

/** Preserve manually prepared host transcripts when a retry creates a new generation. */
export function copyRetryHostSubtitles(previousRunId: string | undefined, ws: DramaWorkspace): void {
  if (!isSafeDramaRunId(previousRunId) || previousRunId === ws.runId) return;
  const oldRoot = path.join(path.dirname(ws.rootDir), previousRunId);
  if (!fs.existsSync(oldRoot) || fs.lstatSync(oldRoot).isSymbolicLink()) return;
  const oldSubtitles = path.join(oldRoot, 'subtitles');
  if (!fs.existsSync(oldSubtitles) || fs.lstatSync(oldSubtitles).isSymbolicLink()) return;
  for (const lang of ['en', 'zh', 'ko', 'th']) {
    const source = path.join(oldSubtitles, `host_${lang}.srt`);
    if (!fs.existsSync(source) || !fs.lstatSync(source).isFile()) continue;
    const target = path.join(ws.subtitlesDir, `host_${lang}.srt`);
    fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
  }
}
