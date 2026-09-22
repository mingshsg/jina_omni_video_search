import { NextResponse } from 'next/server';
import { assertWebEnvHasNoLiveSourceSecrets } from '@/lib/live/env-surfaces';
import { liveErrorResponse, resolveLiveLocale } from '@/lib/live/errors';
import { getLiveConfig } from '@/lib/live/config';
import {
  enabledLiveProtocols,
  transportsForProtocol,
} from '@/lib/live/adapters/registry';

export const runtime = 'nodejs';

/**
 * Public allowlist surface for the live UI.
 * Defaults remain RTSP-only; HLS/SRT/WHIP appear only when enabled in env.
 */
export async function GET(request: Request) {
  try {
    assertWebEnvHasNoLiveSourceSecrets();
    const cfg = getLiveConfig();
    const protocols = enabledLiveProtocols(cfg).map((protocol) => ({
      protocol,
      transports: transportsForProtocol(protocol),
    }));
    return NextResponse.json({
      protocols,
      allowed_hosts: cfg.LIVE_ALLOWED_HOSTS,
      allowed_ports: cfg.LIVE_ALLOWED_PORTS,
      srt_peer_allowlist_configured: cfg.LIVE_SRT_PEER_ALLOWLIST.length > 0,
    });
  } catch (err) {
    const locale = resolveLiveLocale(request);
    if (err instanceof Error && /LIVE_SOURCE_/.test(err.message)) {
      return liveErrorResponse('LIVE_INVALID_REQUEST', locale);
    }
    throw err;
  }
}
