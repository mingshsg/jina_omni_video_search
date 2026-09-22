import { NextResponse } from 'next/server';
import { assertWebEnvHasNoLiveSourceSecrets } from '@/lib/live/env-surfaces';
import { LiveApiError, liveErrorResponse, resolveLiveLocale } from '@/lib/live/errors';
import { assertLiveMutationAllowed } from '@/lib/live/http';
import { LiveProtectRangeRepository } from '@/lib/live/protect-range-repository';

export const runtime = 'nodejs';

function clientKey(request: Request): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'local'
  );
}

type RouteCtx = { params: { rangeId: string } };

/** DELETE /api/live/ops/protect-ranges/{rangeId} */
export async function DELETE(request: Request, ctx: RouteCtx) {
  const locale = resolveLiveLocale(request);
  try {
    assertWebEnvHasNoLiveSourceSecrets();
    assertLiveMutationAllowed(`live:protect:${clientKey(request)}`);
    const rangeId = ctx.params.rangeId;
    if (!rangeId || rangeId.includes('/') || rangeId.includes('..')) {
      return liveErrorResponse('LIVE_INVALID_REQUEST', locale);
    }
    const repo = new LiveProtectRangeRepository();
    const ok = await repo.delete(rangeId);
    if (!ok) {
      return liveErrorResponse('LIVE_INVALID_REQUEST', locale, {
        detail: 'protect range not found',
      });
    }
    return NextResponse.json({ deleted: true, range_id: rangeId });
  } catch (err) {
    if (err instanceof LiveApiError) return liveErrorResponse(err, locale);
    throw err;
  }
}
