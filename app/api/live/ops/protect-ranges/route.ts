import { NextResponse } from 'next/server';
import { z } from 'zod';
import { assertWebEnvHasNoLiveSourceSecrets } from '@/lib/live/env-surfaces';
import { LiveApiError, liveErrorResponse, resolveLiveLocale } from '@/lib/live/errors';
import { assertLiveMutationAllowed, readLiveJsonBody } from '@/lib/live/http';
import {
  assertValidProtectRangeBounds,
  mintProtectRangeId,
  publicProtectRangeView,
} from '@/lib/live/protect-ranges';
import { LiveProtectRangeRepository } from '@/lib/live/protect-range-repository';
import type { LiveProtectRangeDocument } from '@/lib/live/types';

export const runtime = 'nodejs';

const createSchema = z.object({
  start_at: z.string().min(1),
  end_at: z.string().min(1),
  session_id: z.string().min(1).optional(),
  note: z.string().max(500).optional(),
});

function clientKey(request: Request): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'local'
  );
}

/** GET /api/live/ops/protect-ranges — list protect/keep ranges. */
export async function GET(request: Request) {
  try {
    assertWebEnvHasNoLiveSourceSecrets();
    const repo = new LiveProtectRangeRepository();
    const list = await repo.listAll(500);
    return NextResponse.json({
      protect_ranges: list.map((d) => publicProtectRangeView(d.source)),
    });
  } catch (err) {
    const locale = resolveLiveLocale(request);
    if (err instanceof LiveApiError) return liveErrorResponse(err, locale);
    throw err;
  }
}

/** POST /api/live/ops/protect-ranges — pin an absolute UTC keep range. */
export async function POST(request: Request) {
  const locale = resolveLiveLocale(request);
  try {
    assertWebEnvHasNoLiveSourceSecrets();
    assertLiveMutationAllowed(`live:protect:${clientKey(request)}`);
    const raw = await readLiveJsonBody(request);
    const parsed = createSchema.safeParse(raw);
    if (!parsed.success) {
      return liveErrorResponse('LIVE_INVALID_REQUEST', locale);
    }
    try {
      assertValidProtectRangeBounds(parsed.data.start_at, parsed.data.end_at);
    } catch {
      return liveErrorResponse('LIVE_INVALID_REQUEST', locale, {
        detail: 'start_at/end_at must be valid ISO-8601 with end_at >= start_at',
      });
    }
    const now = new Date().toISOString();
    const doc: LiveProtectRangeDocument = {
      range_id: mintProtectRangeId(),
      start_at: new Date(parsed.data.start_at).toISOString(),
      end_at: new Date(parsed.data.end_at).toISOString(),
      session_id: parsed.data.session_id,
      note: parsed.data.note,
      created_at: now,
      updated_at: now,
    };
    const repo = new LiveProtectRangeRepository();
    const created = await repo.create(doc);
    return NextResponse.json(
      { protect_range: publicProtectRangeView(created.source) },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof LiveApiError) return liveErrorResponse(err, locale);
    throw err;
  }
}
