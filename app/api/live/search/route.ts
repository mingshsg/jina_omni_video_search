import { NextResponse } from 'next/server';
import { z } from 'zod';
import { assertWebEnvHasNoLiveSourceSecrets } from '@/lib/live/env-surfaces';
import {
  LiveApiError,
  liveErrorResponse,
  resolveLiveLocale,
} from '@/lib/live/errors';
import { readLiveJsonBody } from '@/lib/live/http';
import { runLiveSearch } from '@/lib/live/search';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  query: z.string().trim().min(1).max(2000),
  source_ids: z.array(z.string().trim().min(1)).optional().default([]),
  session_ids: z.array(z.string().trim().min(1)).optional().default([]),
  from: z.string().trim().optional().nullable(),
  to: z.string().trim().optional().nullable(),
  variant_id: z.string().trim().min(1).max(64),
  modality: z.enum(['visual', 'audio', 'both']).optional().default('both'),
  sort_by: z.enum(['rrf', 'visual', 'audio']).optional().default('rrf'),
  size: z.number().int().min(1).max(100).optional().default(20),
  follow: z.boolean().optional().default(false),
});

export async function POST(request: Request) {
  const locale = resolveLiveLocale(request);
  try {
    assertWebEnvHasNoLiveSourceSecrets();
    const json = await readLiveJsonBody(request);
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      throw new LiveApiError('LIVE_INVALID_REQUEST', {
        message: parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; '),
      });
    }
    const body = parsed.data;
    const result = await runLiveSearch({
      query: body.query,
      variantId: body.variant_id,
      sourceIds: body.source_ids,
      sessionIds: body.session_ids,
      from: body.from,
      to: body.to,
      modality: body.modality,
      sortBy: body.sort_by,
      size: body.size,
      follow: body.follow,
    });

    return NextResponse.json({
      hits: result.hits,
      query_id: result.query_id,
      query_vector_cache: result.query_vector_cache,
      follow_expires_at: result.follow_expires_at,
      session_cursors: result.session_cursors,
      meta: result.meta,
    });
  } catch (err) {
    if (err instanceof LiveApiError) return liveErrorResponse(err, locale);
    throw err;
  }
}
