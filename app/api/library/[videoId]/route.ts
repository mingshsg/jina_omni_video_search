import { NextResponse } from 'next/server';
import { getConfig } from '@/lib/config';
import { getAsset } from '@/lib/es/index-assets';
import { removeAssetFromIndex } from '@/lib/es/list-assets';

export const runtime = 'nodejs';

type Params = { params: { videoId: string } };

/** DELETE /api/library/[videoId] — remove from ES only (files kept, NFR-5). */
export async function DELETE(_request: Request, { params }: Params) {
  const videoId = decodeURIComponent(params.videoId ?? '').trim();
  if (!videoId || videoId.includes('/') || videoId.includes('..')) {
    return NextResponse.json(
      { error: { code: 'LIBRARY_INVALID', message: 'Invalid video id' } },
      { status: 400 },
    );
  }

  try {
    getConfig();
    const existing = await getAsset(videoId);
    if (!existing) {
      return NextResponse.json(
        { error: { code: 'LIBRARY_NOT_FOUND', message: 'Video not found' } },
        { status: 404 },
      );
    }
    const result = await removeAssetFromIndex(videoId);
    return NextResponse.json({
      video_id: videoId,
      ...result,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Remove failed';
    const safe = message.replace(/ApiKey\s+\S+/gi, 'ApiKey [redacted]');
    return NextResponse.json(
      { error: { code: 'LIBRARY_FAILED', message: safe } },
      { status: 500 },
    );
  }
}
