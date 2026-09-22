import { NextResponse } from 'next/server';
import { z } from 'zod';
import { assertWebEnvHasNoLiveSourceSecrets } from '@/lib/live/env-surfaces';
import { LiveApiError, liveErrorResponse, resolveLiveLocale } from '@/lib/live/errors';
import { assertLiveMutationAllowed, readLiveJsonBody } from '@/lib/live/http';
import { LiveControlService } from '@/lib/live/control-service';

export const runtime = 'nodejs';

const createSchema = z.object({
  source_id: z.string().min(1),
  idempotency_key: z.string().min(1).max(128),
  force_new: z.boolean().optional(),
  window: z
    .object({
      fragment_ms: z.number().int().positive().optional(),
      window_ms: z.number().int().positive().optional(),
      overlap_ms: z.number().int().nonnegative().optional(),
    })
    .optional(),
  retention: z
    .object({
      clip_hours: z.number().optional(),
      thumbnail_hours: z.number().optional(),
    })
    .optional(),
});

function clientKey(request: Request): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'local'
  );
}

export async function POST(request: Request) {
  const locale = resolveLiveLocale(request);
  try {
    assertWebEnvHasNoLiveSourceSecrets();
    assertLiveMutationAllowed(`live:sessions:${clientKey(request)}`);
    const raw = await readLiveJsonBody(request);
    const parsed = createSchema.safeParse(raw);
    if (!parsed.success) {
      return liveErrorResponse('LIVE_INVALID_REQUEST', locale);
    }
    // Product decision: forever retention — ignore age-based retention fields.
    void parsed.data.retention;

    const url = new URL(request.url);
    const forceNew =
      parsed.data.force_new === true ||
      url.searchParams.get('force_new') === 'true';

    const service = new LiveControlService();
    const result = await service.createSession({
      source_id: parsed.data.source_id,
      idempotency_key: parsed.data.idempotency_key,
      force_new: forceNew,
      window: parsed.data.window,
    });
    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    if (err instanceof LiveApiError) return liveErrorResponse(err, locale);
    throw err;
  }
}
