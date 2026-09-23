import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getConfig } from '@/lib/config';
import {
  getAssetMetaEditorDto,
  MetaNotFoundError,
} from '@/lib/es/asset-meta';
import { buildLocalSuggestions } from '@/lib/metadata/suggest-local';
import { enrichSuggestionsWithWeb } from '@/lib/metadata/suggest-web';
import {
  assertSuggestRateLimit,
  cancelSuggestJob,
  createSuggestJob,
  getSuggestJob,
  SuggestQueueFullError,
  SuggestRateLimitError,
  type SuggestJobSnapshot,
} from '@/lib/metadata/suggest-jobs';

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

const suggestBodySchema = z
  .object({
    draft: z
      .object({
        year: z.union([z.number().int(), z.null()]).optional(),
        video_type: z.union([z.string(), z.null()]).optional(),
        primary_language: z.union([z.string(), z.null()]).optional(),
        country: z.union([z.string(), z.null()]).optional(),
        description: z.union([z.string(), z.null()]).optional(),
        abstract: z.union([z.string(), z.null()]).optional(),
        tags: z.union([z.array(z.string()), z.null()]).optional(),
      })
      .strict()
      .optional(),
    /** Optional caller language hint; labeled caller_hint, never media_tag. */
    media_language: z.union([z.string(), z.null()]).optional(),
  })
  .strict()
  .optional();

const requestIdSchema = z.string().uuid();

function clientKey(request: Request, videoId: string): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return `${forwarded || 'local'}:${videoId}`;
}

function snapshotResponse(snapshot: SuggestJobSnapshot) {
  return {
    ...snapshot,
    ...(snapshot.result && typeof snapshot.result === 'object'
      ? {
          result: {
            ...(snapshot.result as Record<string, unknown>),
            request_id: snapshot.request_id,
          },
        }
      : {}),
  };
}

/**
 * POST /api/library/{videoId}/meta/suggest — Phase 4a/4b draft suggestions.
 * Never writes the asset. Local title clues always run; default enrichment is
 * Agent Builder converse (web → agent → Jina MCP). Falls back to local on failure.
 */
export async function POST(request: Request, { params }: Params) {
  const videoId = parseVideoId(params.videoId);
  if (!videoId) {
    return NextResponse.json(
      { error: { code: 'LIBRARY_INVALID', message: 'Invalid video id' } },
      { status: 400 },
    );
  }

  let body: unknown = {};
  const text = await request.text();
  if (text.length > 64 * 1024) {
    return NextResponse.json(
      { error: { code: 'META_INVALID', message: 'Suggest body too large' } },
      { status: 413 },
    );
  }
  if (text.trim()) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      return NextResponse.json(
        { error: { code: 'META_INVALID', message: 'Invalid JSON body' } },
        { status: 400 },
      );
    }
  }

  const parsed = suggestBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: 'META_INVALID',
          message: 'Invalid suggest body',
          details: parsed.error.flatten(),
        },
      },
      { status: 400 },
    );
  }

  try {
    const cfg = getConfig();
    const dto = await getAssetMetaEditorDto(videoId);
    const draft = parsed.data?.draft ?? {
      year: dto.meta.year ?? null,
      video_type: dto.meta.video_type ?? null,
      primary_language: dto.meta.primary_language ?? null,
      country: dto.meta.country ?? null,
      description: dto.meta.description ?? null,
      abstract: dto.meta.abstract ?? null,
      tags: dto.meta.tags ?? null,
    };
    const local = buildLocalSuggestions({
      title: dto.title,
      media_language: parsed.data?.media_language,
      draft,
      locale: localeFromRequest(request),
    });
    assertSuggestRateLimit(clientKey(request, videoId));
    const locale = localeFromRequest(request);
    const cacheKey = JSON.stringify([
      videoId,
      dto.meta_revision,
      locale,
      parsed.data?.draft ?? null,
      parsed.data?.media_language ?? null,
      cfg.SUGGEST_WEB_PROVIDER,
      cfg.SUGGEST_AGENT_ID,
      cfg.SUGGEST_AGENT_CONNECTOR_ID,
    ]);
    const job = createSuggestJob({
      videoId,
      metaRevision: dto.meta_revision,
      cacheKey,
      run: async ({ signal, report }) => {
        const enriched = await enrichSuggestionsWithWeb({
          local,
          cfg,
          signal,
          onProgress: report,
        });
        const count = Object.keys(enriched.suggestions).length;
        return {
          video_id: videoId,
          title: dto.title,
          meta_revision: dto.meta_revision,
          retrieved_at: new Date().toISOString(),
          status: count === 0 ? 'empty' : 'ok',
          provider: enriched.provider,
          title_clues: enriched.title_clues,
          suggestions: enriched.suggestions,
          web: enriched.web ?? null,
        };
      },
    });
    return NextResponse.json(snapshotResponse(job), {
      status: job.status === 'complete' ? 200 : 202,
    });
  } catch (err) {
    if (err instanceof MetaNotFoundError) {
      return NextResponse.json(
        { error: { code: err.code, message: 'Video not found' } },
        { status: 404 },
      );
    }
    if (err instanceof SuggestRateLimitError) {
      return NextResponse.json(
        { error: { code: err.code, message: err.message } },
        { status: 429, headers: { 'Retry-After': '60' } },
      );
    }
    if (err instanceof SuggestQueueFullError) {
      return NextResponse.json(
        { error: { code: err.code, message: err.message } },
        { status: 503, headers: { 'Retry-After': '5' } },
      );
    }
    // Never echo provider secrets or raw upstream bodies to the client.
    return NextResponse.json(
      {
        error: {
          code: 'META_SUGGEST_FAILED',
          message: 'Suggest failed',
        },
      },
      { status: 500 },
    );
  }
}

export async function GET(request: Request, { params }: Params) {
  const videoId = parseVideoId(params.videoId);
  if (!videoId) {
    return NextResponse.json(
      { error: { code: 'LIBRARY_INVALID', message: 'Invalid video id' } },
      { status: 400 },
    );
  }
  const requestId = new URL(request.url).searchParams.get('request_id');
  const parsedId = requestIdSchema.safeParse(requestId);
  if (!parsedId.success) {
    return NextResponse.json(
      { error: { code: 'META_INVALID', message: 'Invalid request id' } },
      { status: 400 },
    );
  }
  const job = getSuggestJob(parsedId.data, videoId);
  if (!job) {
    return NextResponse.json(
      { error: { code: 'META_SUGGEST_NOT_FOUND', message: 'Suggest request not found' } },
      { status: 404 },
    );
  }
  return NextResponse.json(snapshotResponse(job));
}

export async function DELETE(request: Request, { params }: Params) {
  const videoId = parseVideoId(params.videoId);
  if (!videoId) {
    return NextResponse.json(
      { error: { code: 'LIBRARY_INVALID', message: 'Invalid video id' } },
      { status: 400 },
    );
  }
  const requestId = new URL(request.url).searchParams.get('request_id');
  const parsedId = requestIdSchema.safeParse(requestId);
  if (!parsedId.success) {
    return NextResponse.json(
      { error: { code: 'META_INVALID', message: 'Invalid request id' } },
      { status: 400 },
    );
  }
  const job = cancelSuggestJob(parsedId.data, videoId);
  if (!job) {
    return NextResponse.json(
      { error: { code: 'META_SUGGEST_NOT_FOUND', message: 'Suggest request not found' } },
      { status: 404 },
    );
  }
  return NextResponse.json(snapshotResponse(job));
}
