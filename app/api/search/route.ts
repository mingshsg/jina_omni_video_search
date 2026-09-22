import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getConfig } from '@/lib/config';
import { searchChunks } from '@/lib/es/search';

export const runtime = 'nodejs';

const bodySchema = z.object({
  query: z.string().trim().min(1).max(2000),
  modality: z.enum(['visual', 'audio', 'both']).default('visual'),
  variant_id: z.string().trim().min(1).max(64),
  video_id: z
    .union([z.string().trim().min(1).max(128), z.null()])
    .optional()
    .default(null),
  size: z.number().int().min(1).max(100).optional().default(20),
  sort_by: z.enum(['rrf', 'visual', 'audio']).optional().default('visual'),
});

type SearchErrorCode =
  | 'SEARCH_INVALID_REQUEST'
  | 'SEARCH_FAILED';

function errorResponse(
  code: SearchErrorCode,
  message: string,
  status: number,
) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function POST(request: Request) {
  let body: z.infer<typeof bodySchema>;
  try {
    const json: unknown = await request.json();
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return errorResponse(
        'SEARCH_INVALID_REQUEST',
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
        400,
      );
    }
    body = parsed.data;
  } catch {
    return errorResponse(
      'SEARCH_INVALID_REQUEST',
      'Request body must be JSON',
      400,
    );
  }

  try {
    // Touch config early so missing env fails with a clear 500, not mid-flight.
    getConfig();
    const sortBy =
      body.modality !== 'both' && body.sort_by === 'rrf'
        ? body.modality
        : body.sort_by;
    const result = await searchChunks({
      query: body.query,
      modality: body.modality,
      variantId: body.variant_id,
      videoId: body.video_id,
      size: body.size,
      sortBy,
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
      },
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Search failed unexpectedly';
    // Never echo credentials / raw env.
    const safe = message.replace(/ApiKey\s+\S+/gi, 'ApiKey [redacted]');
    return errorResponse('SEARCH_FAILED', safe, 500);
  }
}
