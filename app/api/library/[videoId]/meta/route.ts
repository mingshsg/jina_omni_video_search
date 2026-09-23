import { NextResponse } from 'next/server';
import { getConfig } from '@/lib/config';
import {
  MetaConflictError,
  MetaNotFoundError,
  MetaTransportConflictError,
  patchAssetMeta,
} from '@/lib/es/asset-meta';
import {
  MetaValidationError,
  parseMetaPatchBody,
} from '@/lib/metadata/validate';

export const runtime = 'nodejs';

type Params = { params: { videoId: string } };

function parseVideoId(raw: string | undefined): string | null {
  const videoId = decodeURIComponent(raw ?? '').trim();
  if (!videoId || videoId.includes('/') || videoId.includes('..')) {
    return null;
  }
  return videoId;
}

function localeFromRequest(request: Request): string {
  const header = request.headers.get('accept-language') ?? 'en';
  return header.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

/** PATCH /api/library/{videoId}/meta — atomic editorial metadata update. */
export async function PATCH(request: Request, { params }: Params) {
  const videoId = parseVideoId(params.videoId);
  if (!videoId) {
    return NextResponse.json(
      { error: { code: 'LIBRARY_INVALID', message: 'Invalid video id' } },
      { status: 400 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'META_INVALID', message: 'Invalid JSON body' } },
      { status: 400 },
    );
  }

  try {
    getConfig();
    const apply = parseMetaPatchBody(body, localeFromRequest(request));
    const result = await patchAssetMeta(videoId, apply);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof MetaValidationError) {
      return NextResponse.json(
        {
          error: {
            code: err.code,
            message: err.message,
            details: err.details,
          },
        },
        { status: err.status },
      );
    }
    if (err instanceof MetaNotFoundError) {
      return NextResponse.json(
        { error: { code: err.code, message: 'Video not found' } },
        { status: 404 },
      );
    }
    if (err instanceof MetaConflictError) {
      return NextResponse.json(
        {
          error: {
            code: err.code,
            message: err.message,
            current_revision: err.current_revision,
          },
        },
        { status: 409 },
      );
    }
    if (err instanceof MetaTransportConflictError) {
      return NextResponse.json(
        {
          error: {
            code: err.code,
            message: err.message,
            current_revision: err.current_revision,
            retryable: true,
          },
        },
        { status: 409 },
      );
    }
    const message = err instanceof Error ? err.message : 'Metadata save failed';
    return NextResponse.json(
      {
        error: {
          code: 'META_FAILED',
          message: message.replace(/ApiKey\s+\S+/gi, 'ApiKey [redacted]'),
        },
      },
      { status: 500 },
    );
  }
}
