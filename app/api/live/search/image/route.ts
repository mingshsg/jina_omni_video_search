import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getConfig } from '@/lib/config';
import { getLiveConfig } from '@/lib/live/config';
import { assertWebEnvHasNoLiveSourceSecrets } from '@/lib/live/env-surfaces';
import {
  LiveApiError,
  liveErrorResponse,
  resolveLiveLocale,
} from '@/lib/live/errors';
import { runLiveSearch } from '@/lib/live/search';
import {
  decodeImagePayload,
  prepareQueryImage,
  QueryImageError,
} from '@/lib/media/prepare-query-image';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const jsonBodySchema = z.object({
  image_base64: z.string().min(1),
  mime: z.string().trim().optional(),
  source_ids: z.array(z.string().trim().min(1)).optional().default([]),
  session_ids: z.array(z.string().trim().min(1)).optional().default([]),
  from: z.string().trim().optional().nullable(),
  to: z.string().trim().optional().nullable(),
  variant_id: z.string().trim().min(1).max(64),
  size: z.number().int().min(1).max(100).optional().default(20),
  follow: z.boolean().optional().default(false),
});

function parseSize(raw: FormDataEntryValue | null): number | undefined {
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  return Math.trunc(n);
}

function parseStringList(raw: FormDataEntryValue | null): string[] {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map(String).map((s) => s.trim()).filter(Boolean);
    }
  } catch {
    // comma-separated fallback
  }
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseOptionalString(
  raw: FormDataEntryValue | null,
): string | null | undefined {
  if (raw == null) return undefined;
  if (typeof raw !== 'string') return undefined;
  const t = raw.trim();
  return t === '' ? null : t;
}

async function readMultipart(request: Request, maxImageBytes: number) {
  const form = await request.formData();
  const file = form.get('file') ?? form.get('image');
  if (!(file instanceof File)) {
    throw new LiveApiError('LIVE_INVALID_REQUEST', {
      message: 'multipart field "file" (or "image") is required',
    });
  }
  if (file.size > maxImageBytes) {
    throw new LiveApiError('LIVE_PAYLOAD_TOO_LARGE', {
      message: `Image upload exceeds ${maxImageBytes} bytes`,
    });
  }
  const variantRaw = form.get('variant_id');
  if (typeof variantRaw !== 'string' || !variantRaw.trim()) {
    throw new LiveApiError('LIVE_INVALID_REQUEST', {
      message: 'variant_id is required',
    });
  }
  const followRaw = form.get('follow');
  const follow =
    typeof followRaw === 'string'
      ? followRaw.trim().toLowerCase() === 'true' || followRaw.trim() === '1'
      : false;
  const ab = await file.arrayBuffer();
  return {
    buffer: Buffer.from(ab),
    mime: file.type || undefined,
    variantId: variantRaw.trim(),
    sourceIds: parseStringList(form.get('source_ids')),
    sessionIds: parseStringList(form.get('session_ids')),
    from: parseOptionalString(form.get('from')),
    to: parseOptionalString(form.get('to')),
    size: parseSize(form.get('size')) ?? 20,
    follow,
  };
}

export async function POST(request: Request) {
  const locale = resolveLiveLocale(request);
  try {
    assertWebEnvHasNoLiveSourceSecrets();
    const liveCfg = getLiveConfig();
    const appCfg = getConfig();
    const contentType = request.headers.get('content-type') ?? '';

    let rawBuffer: Buffer;
    let declaredMime: string | undefined;
    let variantId: string;
    let sourceIds: string[];
    let sessionIds: string[];
    let from: string | null | undefined;
    let to: string | null | undefined;
    let size: number;
    let follow: boolean;

    if (contentType.includes('multipart/form-data')) {
      const parsed = await readMultipart(
        request,
        liveCfg.LIVE_IMAGE_QUERY_MAX_BYTES,
      );
      rawBuffer = parsed.buffer;
      declaredMime = parsed.mime;
      variantId = parsed.variantId;
      sourceIds = parsed.sourceIds;
      sessionIds = parsed.sessionIds;
      from = parsed.from;
      to = parsed.to;
      size = parsed.size;
      follow = parsed.follow;
    } else if (contentType.includes('application/json')) {
      const json: unknown = await request.json();
      const parsed = jsonBodySchema.safeParse(json);
      if (!parsed.success) {
        throw new LiveApiError('LIVE_INVALID_REQUEST', {
          message: parsed.error.issues
            .map((i) => `${i.path.join('.')}: ${i.message}`)
            .join('; '),
        });
      }
      const decoded = decodeImagePayload(parsed.data.image_base64);
      if (decoded.buffer.byteLength > liveCfg.LIVE_IMAGE_QUERY_MAX_BYTES) {
        throw new LiveApiError('LIVE_PAYLOAD_TOO_LARGE');
      }
      rawBuffer = decoded.buffer;
      declaredMime = parsed.data.mime ?? decoded.mime;
      variantId = parsed.data.variant_id;
      sourceIds = parsed.data.source_ids;
      sessionIds = parsed.data.session_ids;
      from = parsed.data.from;
      to = parsed.data.to;
      size = parsed.data.size;
      follow = parsed.data.follow;
    } else {
      throw new LiveApiError('LIVE_INVALID_REQUEST', {
        message:
          'Content-Type must be multipart/form-data or application/json',
      });
    }

    const prepared = await prepareQueryImage(rawBuffer, declaredMime, appCfg);
    const result = await runLiveSearch({
      image: prepared.buffer,
      imageWidth: prepared.widthHint,
      imageHeight: prepared.widthHint,
      variantId,
      sourceIds,
      sessionIds,
      from,
      to,
      size,
      follow,
    });

    return NextResponse.json({
      hits: result.hits,
      query_id: result.query_id,
      query_vector_cache: result.query_vector_cache,
      follow_expires_at: result.follow_expires_at,
      session_cursors: result.session_cursors,
      meta: {
        ...result.meta,
        query_mime: prepared.mime,
      },
    });
  } catch (err) {
    if (err instanceof LiveApiError) return liveErrorResponse(err, locale);
    if (err instanceof QueryImageError) {
      const status =
        err.code === 'IMAGE_TOO_LARGE' ? 413 : 400;
      return liveErrorResponse(
        new LiveApiError('LIVE_INVALID_REQUEST', {
          message: err.message,
          status,
        }),
        locale,
      );
    }
    const message =
      err instanceof Error ? err.message : 'Live image search failed';
    const safe = message.replace(/ApiKey\s+\S+/gi, 'ApiKey [redacted]');
    return liveErrorResponse(
      new LiveApiError('LIVE_EMBED_FAILED', { message: safe }),
      locale,
    );
  }
}
