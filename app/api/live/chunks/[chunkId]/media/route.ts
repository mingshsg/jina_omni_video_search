import { assertWebEnvHasNoLiveSourceSecrets } from '@/lib/live/env-surfaces';
import {
  LiveApiError,
  liveErrorResponse,
  resolveLiveLocale,
} from '@/lib/live/errors';
import {
  resolveLiveMediaPath,
  serveLiveSpoolFile,
} from '@/lib/live/serve-media';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  context: { params: { chunkId: string } },
) {
  const locale = resolveLiveLocale(request);
  try {
    assertWebEnvHasNoLiveSourceSecrets();
    const { path } = await resolveLiveMediaPath({
      chunkId: context.params.chunkId,
      kind: 'clip',
    });
    return serveLiveSpoolFile(path, request, {
      cacheControl: 'private, max-age=3600',
    });
  } catch (err) {
    if (err instanceof LiveApiError) return liveErrorResponse(err, locale);
    throw err;
  }
}
