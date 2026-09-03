import path from 'node:path';
import { getConfig } from '@/lib/config';
import { getEsClient } from '@/lib/es/client';
import { chunkDocumentId } from '@/lib/ingest/variant';
import { resolveUnderMediaRoot, serveFileWithRange } from '@/lib/media/serve-file';

export const runtime = 'nodejs';

type Params = {
  params: { videoId: string; variantId: string; chunkIndex: string };
};

/**
 * Serve a chunk thumbnail JPEG.
 * Resolves via chunk `thumb_path` when present; else conventional path under
 * `MEDIA_ROOT/thumbs/{videoId}/{variantId}/{chunkIndex}.jpg`.
 */
export async function GET(request: Request, { params }: Params) {
  const videoId = decodeURIComponent(params.videoId ?? '').trim();
  const variantId = decodeURIComponent(params.variantId ?? '').trim();
  const chunkIndex = Number(params.chunkIndex);

  if (
    !videoId ||
    !variantId ||
    !Number.isInteger(chunkIndex) ||
    chunkIndex < 0 ||
    videoId.includes('/') ||
    variantId.includes('/')
  ) {
    return new Response('Bad request', { status: 400 });
  }

  try {
    const cfg = getConfig();
    let filePath: string | null = null;

    try {
      const client = getEsClient();
      const id = chunkDocumentId(videoId, variantId, chunkIndex);
      const res = await client.get<{ thumb_path?: string }>({
        index: cfg.ES_INDEX_CHUNKS,
        id,
        _source: ['thumb_path'],
      });
      const stored = res._source?.thumb_path;
      if (stored && resolveUnderMediaRoot(stored)) {
        filePath = stored;
      }
    } catch {
      /* fall through to conventional path */
    }

    if (!filePath) {
      filePath = path.join(
        path.resolve(cfg.MEDIA_ROOT),
        'thumbs',
        videoId,
        variantId,
        `${chunkIndex}.jpg`,
      );
    }

    return serveFileWithRange(filePath, request, {
      cacheControl: 'private, max-age=86400',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Thumb serve failed';
    const safe = message.replace(/ApiKey\s+\S+/gi, 'ApiKey [redacted]');
    return new Response(safe, { status: 500 });
  }
}
