import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getConfig } from '@/lib/config';
import {
  LIBRARY_BATCH_DELETE_MAX,
  removeAssetsFromIndex,
} from '@/lib/es/list-assets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  video_ids: z
    .array(z.string().min(1).max(128))
    .min(1)
    .max(LIBRARY_BATCH_DELETE_MAX),
});

/**
 * POST /api/library/batch-delete — remove many videos from ES only (files kept).
 * Body: `{ "video_ids": ["…"] }`
 */
export async function POST(request: Request) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'LIBRARY_INVALID', message: 'Invalid JSON body' } },
      { status: 400 },
    );
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: 'LIBRARY_INVALID',
          message: `video_ids must be a non-empty array (max ${LIBRARY_BATCH_DELETE_MAX})`,
        },
      },
      { status: 400 },
    );
  }

  const invalidId = parsed.data.video_ids.find(
    (id) => id.includes('/') || id.includes('..') || id.includes('\\'),
  );
  if (invalidId) {
    return NextResponse.json(
      { error: { code: 'LIBRARY_INVALID', message: 'Invalid video id' } },
      { status: 400 },
    );
  }

  try {
    getConfig();
    const summary = await removeAssetsFromIndex(parsed.data.video_ids);
    return NextResponse.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Batch remove failed';
    const safe = message.replace(/ApiKey\s+\S+/gi, 'ApiKey [redacted]');
    return NextResponse.json(
      { error: { code: 'LIBRARY_FAILED', message: safe } },
      { status: 500 },
    );
  }
}
