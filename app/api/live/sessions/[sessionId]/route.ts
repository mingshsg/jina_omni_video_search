import { NextResponse } from 'next/server';
import { assertWebEnvHasNoLiveSourceSecrets } from '@/lib/live/env-surfaces';
import { LiveApiError, liveErrorResponse, resolveLiveLocale } from '@/lib/live/errors';
import { publicSessionSummary, workerHeartbeatFresh } from '@/lib/live/api-sanitize';
import { getLiveConfig } from '@/lib/live/config';
import { LiveSessionRepository } from '@/lib/live/session-repository';
import { LiveWorkerRepository } from '@/lib/live/worker-repository';

export const runtime = 'nodejs';

export async function GET(
  request: Request,
  context: { params: { sessionId: string } },
) {
  const locale = resolveLiveLocale(request);
  try {
    assertWebEnvHasNoLiveSourceSecrets();
    const sessions = new LiveSessionRepository();
    const workers = new LiveWorkerRepository();
    const cfg = getLiveConfig();
    const doc = await sessions.get(context.params.sessionId);
    if (!doc) return liveErrorResponse('LIVE_SESSION_NOT_FOUND', locale);
    const worker = await workers.getSingleton();
    const available = workerHeartbeatFresh(
      worker?.source,
      cfg.LIVE_WORKER_STALE_MS,
    );
    return NextResponse.json(
      publicSessionSummary(doc.source, available),
    );
  } catch (err) {
    if (err instanceof LiveApiError) return liveErrorResponse(err, locale);
    throw err;
  }
}
