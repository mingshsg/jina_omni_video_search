import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getConfig } from '@/lib/config';
import { searchChunksByImage } from '@/lib/es/search';
import {
  decodeImagePayload,
  prepareQueryImage,
  QueryImageError,
  QUERY_IMAGE_UPLOAD_MAX_BYTES,
} from '@/lib/media/prepare-query-image';

export const runtime = 'nodejs';

const jsonBodySchema = z.object({
  image_base64: z.string().min(1),
  mime: z.string().trim().optional(),
  variant_id: z.string().trim().min(1).max(64),
  video_id: z
    .union([z.string().trim().min(1).max(128), z.null()])
    .optional()
    .default(null),
  size: z.number().int().min(1).max(100).optional().default(20),
});

type SearchErrorCode =
  | 'SEARCH_INVALID_REQUEST'
  | 'SEARCH_IMAGE_INVALID'
  | 'SEARCH_IMAGE_TOO_LARGE'
  | 'SEARCH_FAILED';

function errorResponse(
  code: SearchErrorCode,
  message: string,
  status: number,
) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function mapImageError(err: QueryImageError) {
  switch (err.code) {
    case 'IMAGE_INVALID_TYPE':
    case 'IMAGE_EMPTY':
    case 'IMAGE_PREPARE_FAILED':
      return errorResponse('SEARCH_IMAGE_INVALID', err.message, 400);
    case 'IMAGE_TOO_LARGE':
      return errorResponse('SEARCH_IMAGE_TOO_LARGE', err.message, 413);
    default: {
      const _exhaustive: never = err.code;
      return _exhaustive;
    }
  }
}

function parseSize(raw: FormDataEntryValue | null): number | undefined {
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  return Math.trunc(n);
}

async function readMultipart(request: Request): Promise<{
  buffer: Buffer;
  mime?: string;
  variantId: string;
  videoId: string | null;
  size: number;
}> {
  const form = await request.formData();
  const file = form.get('file') ?? form.get('image');
  if (!(file instanceof File)) {
    throw new QueryImageError(
      'IMAGE_EMPTY',
      'multipart field "file" (or "image") is required',
    );
  }
  if (file.size > QUERY_IMAGE_UPLOAD_MAX_BYTES) {
    throw new QueryImageError(
      'IMAGE_TOO_LARGE',
      `Image upload exceeds ${QUERY_IMAGE_UPLOAD_MAX_BYTES} bytes before compression`,
    );
  }
  const variantRaw = form.get('variant_id');
  if (typeof variantRaw !== 'string' || !variantRaw.trim()) {
    throw new Error('variant_id is required');
  }
  const videoRaw = form.get('video_id');
  const videoId =
    typeof videoRaw === 'string' && videoRaw.trim() ? videoRaw.trim() : null;
  const size = parseSize(form.get('size')) ?? 20;
  const ab = await file.arrayBuffer();
  return {
    buffer: Buffer.from(ab),
    mime: file.type || undefined,
    variantId: variantRaw.trim(),
    videoId,
    size,
  };
}

export async function POST(request: Request) {
  const contentType = request.headers.get('content-type') ?? '';
  let rawBuffer: Buffer;
  let declaredMime: string | undefined;
  let variantId: string;
  let videoId: string | null;
  let size: number;

  try {
    if (contentType.includes('multipart/form-data')) {
      const parsed = await readMultipart(request);
      rawBuffer = parsed.buffer;
      declaredMime = parsed.mime;
      variantId = parsed.variantId;
      videoId = parsed.videoId;
      size = parsed.size;
    } else if (contentType.includes('application/json')) {
      const json: unknown = await request.json();
      const parsed = jsonBodySchema.safeParse(json);
      if (!parsed.success) {
        return errorResponse(
          'SEARCH_INVALID_REQUEST',
          parsed.error.issues
            .map((i) => `${i.path.join('.')}: ${i.message}`)
            .join('; '),
          400,
        );
      }
      const decoded = decodeImagePayload(parsed.data.image_base64);
      rawBuffer = decoded.buffer;
      declaredMime = parsed.data.mime ?? decoded.mime;
      variantId = parsed.data.variant_id;
      videoId = parsed.data.video_id;
      size = parsed.data.size;
    } else {
      return errorResponse(
        'SEARCH_INVALID_REQUEST',
        'Content-Type must be multipart/form-data or application/json',
        400,
      );
    }
  } catch (err) {
    if (err instanceof QueryImageError) return mapImageError(err);
    const message = err instanceof Error ? err.message : 'Invalid request';
    return errorResponse('SEARCH_INVALID_REQUEST', message, 400);
  }

  try {
    const cfg = getConfig();
    const prepared = await prepareQueryImage(rawBuffer, declaredMime, cfg);
    const result = await searchChunksByImage({
      image: prepared.buffer,
      variantId,
      videoId,
      size,
    });

    return NextResponse.json({
      hits: result.hits.map((h) => ({
        chunk_id: h.chunk_id,
        video_id: h.video_id,
        variant_id: h.variant_id,
        title: h.title,
        start_ms: h.start_ms,
        end_ms: h.end_ms,
        start_label: h.start_label,
        end_label: h.end_label,
        score: h.score,
        score_visual: h.score_visual,
        score_audio: h.score_audio,
        rank_visual: h.rank_visual,
        rank_audio: h.rank_audio,
        modality_badge: h.modality_badge,
        thumb_url: h.thumb_url,
      })),
      meta: {
        size: result.size,
        rank_window_size: result.rank_window_size,
        modality: result.modality,
        sort_by: result.sort_by,
        variant_id: result.variant_id,
        video_id: result.video_id,
        badge_strategy: result.badge_strategy,
        took_ms: result.took_ms,
        image_bytes: result.image_bytes,
        query_mime: prepared.mime,
      },
    });
  } catch (err) {
    if (err instanceof QueryImageError) return mapImageError(err);
    const message =
      err instanceof Error ? err.message : 'Image search failed unexpectedly';
    const safe = message.replace(/ApiKey\s+\S+/gi, 'ApiKey [redacted]');
    return errorResponse('SEARCH_FAILED', safe, 500);
  }
}
