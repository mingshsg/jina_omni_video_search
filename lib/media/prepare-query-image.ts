import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../config';
import { embedBudgetBytes } from '../video/budget';
import { runFfmpeg } from '../video/run-ffmpeg';

/** Upload ceiling before we bother decoding / compressing (raw request bytes). */
export const QUERY_IMAGE_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
]);

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

export type PreparedQueryImage = {
  /** JPEG bytes ready for embedding (under provider binary budget). */
  buffer: Buffer;
  mime: 'image/jpeg';
  /** Original declared mime (after normalization). */
  sourceMime: string;
  widthHint: number;
  bytes: number;
};

export class QueryImageError extends Error {
  readonly code:
    | 'IMAGE_INVALID_TYPE'
    | 'IMAGE_TOO_LARGE'
    | 'IMAGE_EMPTY'
    | 'IMAGE_PREPARE_FAILED';

  constructor(
    code: QueryImageError['code'],
    message: string,
  ) {
    super(message);
    this.name = 'QueryImageError';
    this.code = code;
  }
}

function normalizeMime(raw: string | undefined | null): string {
  if (!raw) return '';
  const base = raw.split(';')[0]?.trim().toLowerCase() ?? '';
  if (base === 'image/jpg') return 'image/jpeg';
  return base;
}

function sniffMime(buf: Buffer): string | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return 'image/png';
  }
  if (
    buf.length >= 12 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (buf.length >= 6) {
    const head = buf.toString('ascii', 0, 6);
    if (head === 'GIF87a' || head === 'GIF89a') return 'image/gif';
  }
  return null;
}

/**
 * Validate + resize/recompress a query image so decoded JPEG bytes stay under
 * the active provider budget (EIS ~1 MB) and long edge ≤ EMBED_MAX_LONG_EDGE.
 */
export async function prepareQueryImage(
  raw: Buffer,
  declaredMime: string | undefined,
  cfg: AppConfig,
): Promise<PreparedQueryImage> {
  if (!raw.length) {
    throw new QueryImageError('IMAGE_EMPTY', 'Image payload is empty');
  }
  if (raw.length > QUERY_IMAGE_UPLOAD_MAX_BYTES) {
    throw new QueryImageError(
      'IMAGE_TOO_LARGE',
      `Image upload exceeds ${QUERY_IMAGE_UPLOAD_MAX_BYTES} bytes before compression`,
    );
  }

  const sniffed = sniffMime(raw);
  const mime = normalizeMime(declaredMime) || sniffed || '';
  if (!ALLOWED_MIME.has(mime) && !sniffed) {
    throw new QueryImageError(
      'IMAGE_INVALID_TYPE',
      'Supported image types: JPEG, PNG, WebP, GIF',
    );
  }
  const sourceMime = sniffed ?? mime;
  if (!ALLOWED_MIME.has(sourceMime)) {
    throw new QueryImageError(
      'IMAGE_INVALID_TYPE',
      'Supported image types: JPEG, PNG, WebP, GIF',
    );
  }

  const budget = embedBudgetBytes(cfg);
  const maxEdge = cfg.EMBED_MAX_LONG_EDGE;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jina-qimg-'));
  const inExt = EXT_BY_MIME[sourceMime] ?? '.bin';
  const inputPath = path.join(tmpDir, `in${inExt}`);
  const outputPath = path.join(tmpDir, 'out.jpg');

  try {
    fs.writeFileSync(inputPath, raw);

    // Quality ladder: lower q:v = better JPEG (ffmpeg scale). Escalate if over budget.
    const qualities = [3, 5, 8, 12, 18, 24];
    let lastBytes = Infinity;

    for (const q of qualities) {
      await runFfmpeg('ffmpeg', [
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        inputPath,
        '-frames:v',
        '1',
        '-vf',
        `scale=${maxEdge}:${maxEdge}:force_original_aspect_ratio=decrease`,
        '-q:v',
        String(q),
        outputPath,
      ]);
      const buf = fs.readFileSync(outputPath);
      lastBytes = buf.length;
      if (buf.length <= budget) {
        return {
          buffer: buf,
          mime: 'image/jpeg',
          sourceMime,
          widthHint: maxEdge,
          bytes: buf.length,
        };
      }
    }

    throw new QueryImageError(
      'IMAGE_TOO_LARGE',
      `Could not compress image under provider budget (${budget} bytes); last size ${lastBytes}`,
    );
  } catch (err) {
    if (err instanceof QueryImageError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new QueryImageError(
      'IMAGE_PREPARE_FAILED',
      `Failed to prepare query image: ${message}`,
    );
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

/** Parse a data URL or bare base64 string into bytes + mime. */
export function decodeImagePayload(
  value: string,
): { buffer: Buffer; mime?: string } {
  const trimmed = value.trim();
  const dataUrl = /^data:([^;,]+)?(;base64)?,([\s\S]+)$/i.exec(trimmed);
  if (dataUrl) {
    const mime = dataUrl[1] ? normalizeMime(dataUrl[1]) : undefined;
    const isB64 = Boolean(dataUrl[2]);
    const payload = dataUrl[3] ?? '';
    const buffer = isB64
      ? Buffer.from(payload.replace(/\s/g, ''), 'base64')
      : Buffer.from(decodeURIComponent(payload), 'utf8');
    return { buffer, mime };
  }
  // Bare base64
  return {
    buffer: Buffer.from(trimmed.replace(/\s/g, ''), 'base64'),
    mime: undefined,
  };
}

/** Stable temp name helper (tests / callers that need a path). */
export function queryImageTempName(ext = '.jpg'): string {
  return `qimg-${randomUUID()}${ext}`;
}
