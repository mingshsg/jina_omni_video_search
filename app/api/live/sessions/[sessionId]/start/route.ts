import { NextResponse } from 'next/server';
import { assertWebEnvHasNoLiveSourceSecrets } from '@/lib/live/env-surfaces';
import { LiveApiError, liveErrorResponse, resolveLiveLocale } from '@/lib/live/errors';
import { assertLiveMutationAllowed } from '@/lib/live/http';
import { publicSessionSummary, workerHeartbeatFresh } from '@/lib/live/api-sanitize';
import { LiveControlService } from '@/lib/live/control-service';
import { getLiveConfig } from '@/lib/live/config';
import { LiveWorkerRepository } from '@/lib/live/worker-repository';

export const runtime = 'nodejs';

function clientKey(request: Request): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'local'
  );
}

export async function POST(
  request: Request,
  context: { params: { sessionId: string } },
) {
  const locale = resolveLiveLocale(request);
  try {
    assertWebEnvHasNoLiveSourceSecrets();
    assertLiveMutationAllowed(`live:sessions:${clientKey(request)}`);
    const service = new LiveControlService();
    const session = await service.startSession(context.params.sessionId);
    const workers = new LiveWorkerRepository();
    const cfg = getLiveConfig();
    const worker = await workers.getSingleton();
    const available = workerHeartbeatFresh(
      worker?.source,
      cfg.LIVE_WORKER_STALE_MS,
    );
    return NextResponse.json(publicSessionSummary(session, available), {
      status: 202,
    });
  } catch (err) {
    if (err instanceof LiveApiError) return liveErrorResponse(err, locale);
    throw err;
  }
}
