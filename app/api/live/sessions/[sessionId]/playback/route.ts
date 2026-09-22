import { NextResponse } from 'next/server';
import { assertWebEnvHasNoLiveSourceSecrets } from '@/lib/live/env-surfaces';
import {
  LiveApiError,
  liveErrorResponse,
  resolveLiveLocale,
} from '@/lib/live/errors';
import { LiveSessionRepository } from '@/lib/live/session-repository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Gateway playback descriptor only — does not relay media through Next.js.
 * Optional env templates: LIVE_PLAYBACK_HLS_URL_TEMPLATE / LIVE_PLAYBACK_WEBRTC_URL_TEMPLATE
 * may include `{sessionId}` and `{sourceId}` placeholders.
 */
export async function GET(
  request: Request,
  context: { params: { sessionId: string } },
) {
  const locale = resolveLiveLocale(request);
  try {
    assertWebEnvHasNoLiveSourceSecrets();
    const sessions = new LiveSessionRepository();
    const doc = await sessions.get(context.params.sessionId);
    if (!doc) return liveErrorResponse('LIVE_SESSION_NOT_FOUND', locale);

    const session = doc.source;
    const hlsTemplate = process.env.LIVE_PLAYBACK_HLS_URL_TEMPLATE?.trim() ?? '';
    const webrtcTemplate =
      process.env.LIVE_PLAYBACK_WEBRTC_URL_TEMPLATE?.trim() ?? '';

    const fill = (tpl: string): string | null => {
      if (!tpl) return null;
      return tpl
        .replaceAll('{sessionId}', session.session_id)
        .replaceAll('{sourceId}', session.source_id);
    };

    const hlsUrl = fill(hlsTemplate);
    const webrtcUrl = fill(webrtcTemplate);

    return NextResponse.json({
      session_id: session.session_id,
      source_id: session.source_id,
      observed_state: session.observed_state,
      gateway: {
        configured: Boolean(hlsUrl || webrtcUrl),
        hls_url: hlsUrl,
        webrtc_url: webrtcUrl,
      },
    });
  } catch (err) {
    if (err instanceof LiveApiError) return liveErrorResponse(err, locale);
    throw err;
  }
}
