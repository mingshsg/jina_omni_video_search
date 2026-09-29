import fs from 'node:fs';
import path from 'node:path';
import { getConfig } from '@/lib/config';
import { getAsset } from '@/lib/es/index-assets';
import { approvedDramaMediaPath } from '@/lib/drama/media-access';
import type { DramaMetaPayload } from '@/lib/drama/persist-meta';
import { serveFileWithRange } from '@/lib/media/serve-file';

export const runtime = 'nodejs';

type Params = {
  params: {
    videoId: string;
    runId: string;
    /** Relative path under the drama run root, e.g. `faces/xxx.jpg` or `scenes/xxx.jpg`. */
    rest: string[];
  };
};

function badRequest(message = 'Bad request'): Response {
  return new Response(message, { status: 400 });
}

/**
 * Serve only published, approved drama artifacts from the run workspace.
 */
export async function GET(request: Request, { params }: Params) {
  const videoId = decodeURIComponent(params.videoId ?? '').trim();
  const runId = decodeURIComponent(params.runId ?? '').trim();
  const rest = (params.rest ?? [])
    .map((seg) => decodeURIComponent(seg))
    .filter(Boolean);

  if (
    !videoId ||
    !runId ||
    rest.length === 0 ||
    videoId.includes('/') ||
    videoId.includes('..') ||
    runId.includes('/') ||
    runId.includes('..')
  ) {
    return badRequest();
  }
  if (rest.some((seg) => seg.includes('..') || seg.includes('/'))) {
    return badRequest();
  }

  try {
    const cfg = getConfig();
    const asset = await getAsset(videoId);
    const drama = (asset?.meta as { drama?: DramaMetaPayload } | undefined)?.drama;
    const filePath = approvedDramaMediaPath({
      mediaRoot: cfg.MEDIA_ROOT,
      videoId,
      runId,
      rest,
      drama,
    });
    if (!filePath) return new Response('Not found', { status: 404 });
    // A symlink inside the workspace must not expose a file outside it.
    const runRoot = path.resolve(cfg.MEDIA_ROOT, 'media', videoId, 'drama', runId);
    const realRoot = fs.realpathSync(runRoot);
    const realFile = fs.realpathSync(filePath);
    const rel = path.relative(realRoot, realFile);
    if (!rel || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
      return new Response('Not found', { status: 404 });
    }
    return serveFileWithRange(filePath, request, {
      cacheControl: 'private, max-age=86400',
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}

export async function HEAD(request: Request, ctx: Params) {
  const res = await GET(request, ctx);
  return new Response(null, { status: res.status, headers: res.headers });
}
