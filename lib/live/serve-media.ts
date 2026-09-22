import fs from 'node:fs';
import path from 'node:path';
import {
  contentTypeForPath,
  parseBytesRange,
} from '../media/serve-file';
import { getLiveConfig, type LiveConfig } from './config';
import { LiveChunkRepository } from './chunk-repository';
import { LiveApiError } from './errors';
import {
  resolveSpoolFileForServe,
  sessionSpoolDir,
} from './spool-paths';
import type { LiveChunkDocument } from './types';

export type LiveMediaKind = 'clip' | 'thumb';

function candidatePaths(
  sessionDir: string,
  chunkId: string,
  kind: LiveMediaKind,
): string[] {
  if (kind === 'clip') {
    return [path.join(sessionDir, 'media', `${chunkId}.mp4`)];
  }
  // M4: thumbs are retained under media/ only (tmp/ is working scratch).
  return [path.join(sessionDir, 'media', `${chunkId}.thumb.jpg`)];
}

/**
 * Atomically promote a generated thumb from tmp/ into retained media/
 * before indexing (M4). Returns the retained absolute path.
 */
export function promoteThumbToRetainedMedia(args: {
  sessionDir: string;
  chunkId: string;
  tmpThumbPath: string;
}): string {
  const dest = path.join(
    args.sessionDir,
    'media',
    `${args.chunkId}.thumb.jpg`,
  );
  if (!fs.existsSync(args.tmpThumbPath) || !fs.statSync(args.tmpThumbPath).isFile()) {
    throw new Error(`thumb missing at ${args.tmpThumbPath}`);
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try {
    fs.renameSync(args.tmpThumbPath, dest);
  } catch {
    fs.copyFileSync(args.tmpThumbPath, dest);
    try {
      fs.unlinkSync(args.tmpThumbPath);
    } catch {
      // ignore
    }
  }
  return dest;
}

function isExpired(
  doc: LiveChunkDocument,
  kind: LiveMediaKind,
  nowMs: number,
): boolean {
  const raw =
    kind === 'clip'
      ? doc.media.clip_expires_at
      : doc.media.thumb_expires_at;
  if (raw == null || raw === '') return false;
  const ts = Date.parse(raw);
  return Number.isFinite(ts) && ts <= nowMs;
}

/**
 * Resolve a retained clip/thumb under the session spool with symlink/traversal checks.
 * Missing or soft-expired media → LIVE_MEDIA_EXPIRED (410). Forever retention uses null expiry.
 */
export async function resolveLiveMediaPath(args: {
  chunkId: string;
  kind: LiveMediaKind;
  liveCfg?: LiveConfig;
  nowMs?: number;
  chunks?: LiveChunkRepository;
}): Promise<{ path: string; doc: LiveChunkDocument }> {
  const liveCfg = args.liveCfg ?? getLiveConfig();
  const nowMs = args.nowMs ?? Date.now();
  const chunks = args.chunks ?? new LiveChunkRepository();
  const doc = await chunks.findByChunkId(args.chunkId);
  if (!doc) {
    throw new LiveApiError('LIVE_MEDIA_EXPIRED');
  }
  if (isExpired(doc, args.kind, nowMs)) {
    throw new LiveApiError('LIVE_MEDIA_EXPIRED');
  }

  const sessionDir = sessionSpoolDir(liveCfg.LIVE_SPOOL_DIR, doc.session_id);
  let resolved: string | null = null;
  for (const candidate of candidatePaths(sessionDir, args.chunkId, args.kind)) {
    try {
      if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) {
        continue;
      }
      resolved = resolveSpoolFileForServe(sessionDir, candidate);
      break;
    } catch {
      // Symlink escape or missing realpath — try next candidate.
    }
  }
  if (!resolved) {
    throw new LiveApiError('LIVE_MEDIA_EXPIRED');
  }
  return { path: resolved, doc };
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

/** Stream live retained media with HTTP Range (same semantics as file serve). */
export function serveLiveSpoolFile(
  filePath: string,
  request: Request,
  opts?: { cacheControl?: string },
): Response {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return new Response('Gone', { status: 410 });
  }
  const stat = fs.statSync(filePath);
  const size = stat.size;
  const contentType = contentTypeForPath(filePath);
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
    const stream = fs.createReadStream(filePath, { start, end });
    return new Response(readableToWeb(stream), {
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

  const stream = fs.createReadStream(filePath);
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
