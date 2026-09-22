import { assertWebEnvHasNoLiveSourceSecrets } from '@/lib/live/env-surfaces';
import {
  LiveApiError,
  liveErrorResponse,
  resolveLiveLocale,
} from '@/lib/live/errors';
import {
  deleteFollowSearchHandle,
} from '@/lib/live/follow-search';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** End a follow-search handle explicitly. */
export async function DELETE(
  request: Request,
  context: { params: { queryId: string } },
) {
  const locale = resolveLiveLocale(request);
  try {
    assertWebEnvHasNoLiveSourceSecrets();
    const deleted = deleteFollowSearchHandle(context.params.queryId);
    if (!deleted) {
      return liveErrorResponse('LIVE_QUERY_EXPIRED', locale);
    }
    return new Response(null, { status: 204 });
  } catch (err) {
    if (err instanceof LiveApiError) return liveErrorResponse(err, locale);
    throw err;
  }
}
