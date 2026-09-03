import { getAsset } from '@/lib/es/index-assets';
import { getConfig } from '@/lib/config';
import { serveFileWithRange } from '@/lib/media/serve-file';

export const runtime = 'nodejs';

type Params = { params: { videoId: string } };

/**
 * Stream playback media with HTTP Range support (FR-18).
 * Prefers `playback_path`, falls back to `media_path`.
 */
export async function GET(request: Request, { params }: Params) {
  const videoId = decodeURIComponent(params.videoId ?? '').trim();
  if (!videoId || videoId.includes('/') || videoId.includes('..')) {
    return new Response('Bad request', { status: 400 });
  }

  try {
    getConfig();
    const asset = await getAsset(videoId);
    if (!asset) {
      return new Response('Not found', { status: 404 });
    }
    const filePath = asset.playback_path || asset.media_path;
    if (!filePath) {
      return new Response('Not found', { status: 404 });
    }
    return serveFileWithRange(filePath, request, {
      cacheControl: 'private, max-age=86400',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Media serve failed';
    const safe = message.replace(/ApiKey\s+\S+/gi, 'ApiKey [redacted]');
    return new Response(safe, { status: 500 });
  }
}

export async function HEAD(request: Request, ctx: Params) {
  const res = await GET(request, ctx);
  return new Response(null, { status: res.status, headers: res.headers });
}
