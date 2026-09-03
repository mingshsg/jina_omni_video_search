import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createReadStream, createWriteStream } from 'node:fs';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import type { AppConfig } from '../config';
import type { VideoProbeResult } from '../video/probe';
import { IngestError } from './errors';
import { extensionOf, isAllowedVideoExtension } from './extensions';
import {
  ensureDir,
  newMediaFilename,
  originalsDir,
  quarantinePartial,
  uploadsDir,
} from './paths';
import { sanitizeUrlProvenance, type UrlProvenance } from './url-sanitize';
import { downloadUrlToFile, headUrlHint } from './url-fetch';
import { validateMediaProbe } from './validate-probe';

export type SourceMode = 'url' | 'local' | 'upload';

export interface ValidatedImport {
  mode: SourceMode;
  mediaPath: string;
  probe: VideoProbeResult;
  provenance?: UrlProvenance;
}

export interface LocalImportResult {
  mediaPath: string;
  probe: VideoProbeResult;
}

export interface UrlImportResult {
  mediaPath: string;
  probe: VideoProbeResult;
  provenance: UrlProvenance;
}

export interface UploadImportResult {
  mediaPath: string;
  probe: VideoProbeResult;
}

/** Validate absolute path, realpath containment, extension, and size. */
export async function validateLocalPath(
  rawPath: string,
  cfg: AppConfig,
): Promise<string> {
  if (!cfg.LOCAL_IMPORT_ROOT) {
    throw new IngestError('INGEST_LOCAL_NOT_CONFIGURED');
  }
  if (!path.isAbsolute(rawPath)) {
    throw new IngestError('INGEST_LOCAL_NOT_ABSOLUTE');
  }
  if (rawPath.includes('\0')) {
    throw new IngestError('INGEST_LOCAL_TRAVERSAL');
  }

  let resolved: string;
  try {
    resolved = await fsp.realpath(rawPath);
  } catch {
    throw new IngestError('INGEST_LOCAL_NOT_FOUND');
  }

  const root = await fsp.realpath(cfg.LOCAL_IMPORT_ROOT);
  const relative = path.relative(root, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new IngestError('INGEST_LOCAL_TRAVERSAL');
  }

  let stat: fs.Stats;
  try {
    stat = await fsp.stat(resolved);
  } catch {
    throw new IngestError('INGEST_LOCAL_NOT_FOUND');
  }
  if (!stat.isFile()) {
    throw new IngestError('INGEST_LOCAL_NOT_FILE');
  }
  if (!isAllowedVideoExtension(resolved)) {
    throw new IngestError('INGEST_LOCAL_EXTENSION');
  }
  if (stat.size > cfg.MAX_SOURCE_BYTES) {
    throw new IngestError('INGEST_LOCAL_SIZE_EXCEEDED');
  }
  return resolved;
}

/** Full local import: path validation + ffprobe. */
export async function importFromLocalPath(
  rawPath: string,
  cfg: AppConfig,
): Promise<LocalImportResult> {
  const mediaPath = await validateLocalPath(rawPath, cfg);
  const probe = await validateMediaProbe(mediaPath);
  return { mediaPath, probe };
}

/** Full URL import: optional HEAD hint, download, probe, sanitized provenance. */
export async function importFromUrl(
  rawUrl: string,
  cfg: AppConfig,
): Promise<UrlImportResult> {
  await headUrlHint(rawUrl, { maxBytes: cfg.MAX_SOURCE_BYTES }).catch((err) => {
    if (err instanceof IngestError && err.code === 'INGEST_URL_SIZE_EXCEEDED') {
      throw err;
    }
  });

  const { destPath } = await downloadUrlToFile(rawUrl, cfg, {
    maxBytes: cfg.MAX_SOURCE_BYTES,
  });
  const probe = await validateMediaProbe(destPath);
  const provenance = sanitizeUrlProvenance(rawUrl);
  return { mediaPath: destPath, probe, provenance };
}

class ByteCapTransform extends Transform {
  private total = 0;

  constructor(
    private readonly maxBytes: number,
    private readonly cfg: AppConfig,
    private readonly tmpPath: string,
  ) {
    super();
  }

  _transform(
    chunk: Buffer,
    _enc: BufferEncoding,
    cb: (error?: Error | null, data?: Buffer) => void,
  ) {
    this.total += chunk.length;
    if (this.total > this.maxBytes) {
      quarantinePartial(this.cfg, this.tmpPath);
      cb(new IngestError('INGEST_UPLOAD_SIZE_EXCEEDED'));
      return;
    }
    cb(null, chunk);
  }
}

/** Stream upload body to disk with byte cap; then probe. */
export async function importFromUploadStream(
  stream: Readable,
  originalFilename: string,
  cfg: AppConfig,
): Promise<UploadImportResult> {
  if (!originalFilename.trim()) {
    throw new IngestError('INGEST_UPLOAD_NO_FILE');
  }
  if (!isAllowedVideoExtension(originalFilename)) {
    throw new IngestError('INGEST_UPLOAD_EXTENSION');
  }

  const ext = extensionOf(originalFilename) || '.mp4';
  ensureDir(uploadsDir(cfg));
  const mediaPath = path.join(uploadsDir(cfg), newMediaFilename(ext));
  const tmpPath = `${mediaPath}.part`;
  ensureDir(path.dirname(tmpPath));

  try {
    const cap = new ByteCapTransform(cfg.MAX_SOURCE_BYTES, cfg, tmpPath);
    await pipeline(stream, cap, createWriteStream(tmpPath));
    fs.renameSync(tmpPath, mediaPath);
  } catch (err) {
    quarantinePartial(cfg, tmpPath);
    if (err instanceof IngestError) throw err;
    throw new IngestError('INGEST_INTERNAL');
  }

  const probe = await validateMediaProbe(mediaPath);
  return { mediaPath, probe };
}

/** Copy validated local file into originals store (Phase 6 retention for playback parity). */
export async function copyLocalToOriginals(
  sourcePath: string,
  cfg: AppConfig,
): Promise<string> {
  const ext = extensionOf(sourcePath) || '.mp4';
  ensureDir(originalsDir(cfg));
  const dest = path.join(originalsDir(cfg), newMediaFilename(ext));
  await fsp.copyFile(sourcePath, dest);
  return dest;
}

/** Max video files accepted in one batch request. */
export const BATCH_IMPORT_MAX_FILES = 20;

/**
 * Validate folder under LOCAL_IMPORT_ROOT and list immediate child video files
 * (non-recursive). One file = one movie for batch import.
 */
export async function listVideoFilesInImportFolder(
  rawPath: string,
  cfg: AppConfig,
): Promise<string[]> {
  if (!cfg.LOCAL_IMPORT_ROOT) {
    throw new IngestError('INGEST_LOCAL_NOT_CONFIGURED');
  }
  if (!path.isAbsolute(rawPath)) {
    throw new IngestError('INGEST_LOCAL_NOT_ABSOLUTE');
  }
  if (rawPath.includes('\0')) {
    throw new IngestError('INGEST_LOCAL_TRAVERSAL');
  }

  let resolved: string;
  try {
    resolved = await fsp.realpath(rawPath);
  } catch {
    throw new IngestError('INGEST_LOCAL_NOT_FOUND');
  }

  const root = await fsp.realpath(cfg.LOCAL_IMPORT_ROOT);
  const relative = path.relative(root, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new IngestError('INGEST_LOCAL_TRAVERSAL');
  }

  let stat: fs.Stats;
  try {
    stat = await fsp.stat(resolved);
  } catch {
    throw new IngestError('INGEST_LOCAL_NOT_FOUND');
  }
  if (!stat.isDirectory()) {
    throw new IngestError('INGEST_LOCAL_NOT_DIR');
  }

  const entries = await fsp.readdir(resolved, { withFileTypes: true });
  const videos: string[] = [];
  for (const ent of entries) {
    if (!ent.isFile()) continue;
    const full = path.join(resolved, ent.name);
    if (!isAllowedVideoExtension(full)) continue;
    videos.push(full);
  }
  videos.sort((a, b) =>
    path.basename(a).localeCompare(path.basename(b), undefined, {
      sensitivity: 'base',
    }),
  );

  if (videos.length === 0) {
    throw new IngestError('INGEST_BATCH_EMPTY');
  }
  if (videos.length > BATCH_IMPORT_MAX_FILES) {
    throw new IngestError('INGEST_BATCH_TOO_LARGE');
  }
  return videos;
}
