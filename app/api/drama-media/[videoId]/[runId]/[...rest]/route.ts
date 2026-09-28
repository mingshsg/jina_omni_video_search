import { getConfig } from '@/lib/config';
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
 * Serve drama enrichment artifacts (verified face cards, key scene stills,
 * directors script markdown) from the drama run workspace.
 *
 * Path is anchored under MEDIA_ROOT/media/<videoId>/drama/<runId>/ and is
 * validated with the same traversal guard used by other media routes.
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
    const rel = rest.join('/');
    const filePath = `${cfg.MEDIA_ROOT}/media/${videoId}/drama/${runId}/${rel}`;
    return serveFileWithRange(filePath, request, {
      cacheControl: 'private, max-age=86400',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Drama media serve failed';
    const safe = message.replace(/ApiKey\s+\S+/gi, 'ApiKey [redacted]');
    return new Response(safe, { status: 500 });
  }
}

export async function HEAD(request: Request, ctx: Params) {
  const res = await GET(request, ctx);
  return new Response(null, { status: res.status, headers: res.headers });
}
