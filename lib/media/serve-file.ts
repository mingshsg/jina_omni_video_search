import fs from 'node:fs';
import path from 'node:path';
import { getConfig } from '../config';

/**
 * Resolve a media path and ensure it stays under MEDIA_ROOT (or is the
 * configured media root itself). Rejects traversal and absolute escapes.
 */
export function resolveUnderMediaRoot(candidate: string): string | null {
  const cfg = getConfig();
  const root = path.resolve(cfg.MEDIA_ROOT);
  const resolved = path.resolve(candidate);
  const rel = path.relative(root, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return null;
  }
  return resolved;
}

export function contentTypeForPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.mp4':
      return 'video/mp4';
    case '.webm':
      return 'video/webm';
    case '.mov':
      return 'video/quicktime';
    case '.mkv':
      return 'video/x-matroska';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    default:
      return 'application/octet-stream';
  }
}

export interface RangeParse {
  start: number;
  end: number;
}

/** Parse a single `bytes=start-end` Range header. Multi-range not supported. */
export function parseBytesRange(
  header: string | null,
  size: number,
): RangeParse | 'unsatisfiable' | null {
  if (!header || !header.startsWith('bytes=')) return null;
  const spec = header.slice('bytes='.length).trim();
  if (spec.includes(',')) return 'unsatisfiable';
  const m = /^(\d*)-(\d*)$/.exec(spec);
  if (!m) return 'unsatisfiable';
  const startRaw = m[1];
  const endRaw = m[2];
  if (startRaw === '' && endRaw === '') return 'unsatisfiable';

  let start: number;
  let end: number;
  if (startRaw === '') {
    const suffix = Number(endRaw);
    if (!Number.isFinite(suffix) || suffix <= 0) return 'unsatisfiable';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(startRaw);
    end = endRaw === '' ? size - 1 : Number(endRaw);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return 'unsatisfiable';
    if (start < 0 || end < start || start >= size) return 'unsatisfiable';
    end = Math.min(end, size - 1);
  }
  return { start, end };
}

/**
 * Stream a local file with optional HTTP Range (FR-18).
 * Returns a Response suitable for App Router route handlers.
 */
export function serveFileWithRange(
  filePath: string,
  request: Request,
  opts?: { cacheControl?: string },
): Response {
  const safe = resolveUnderMediaRoot(filePath);
  if (!safe || !fs.existsSync(safe) || !fs.statSync(safe).isFile()) {
    return new Response('Not found', { status: 404 });
  }

  const stat = fs.statSync(safe);
  const size = stat.size;
  const contentType = contentTypeForPath(safe);
  const cacheControl = opts?.cacheControl ?? 'private, max-age=3600';
  const rangeHeader = request.headers.get('range');
  const parsed = parseBytesRange(rangeHeader, size);

  if (parsed === 'unsatisfiable') {
    return new Response(null, {
      status: 416,
      headers: {
        'Content-Range': `bytes */${size}`,
        'Accept-Ranges': 'bytes',
      },
    });
  }

  if (parsed) {
    const { start, end } = parsed;
    const chunkSize = end - start + 1;
    const stream = fs.createReadStream(safe, { start, end });
    const webStream = readableToWeb(stream);
    return new Response(webStream, {
      status: 206,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(chunkSize),
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Accept-Ranges': 'bytes',
        'Cache-Control': cacheControl,
      },
    });
  }

  const stream = fs.createReadStream(safe);
  return new Response(readableToWeb(stream), {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(size),
      'Accept-Ranges': 'bytes',
      'Cache-Control': cacheControl,
    },
  });
}

function readableToWeb(
  nodeStream: fs.ReadStream,
): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      nodeStream.on('data', (chunk: string | Buffer) => {
        const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
        controller.enqueue(new Uint8Array(buf));
      });
      nodeStream.on('end', () => controller.close());
      nodeStream.on('error', (err) => controller.error(err));
    },
    cancel() {
      nodeStream.destroy();
    },
  });
}
