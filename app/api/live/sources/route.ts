import { NextResponse } from 'next/server';
import { z } from 'zod';
import { assertWebEnvHasNoLiveSourceSecrets } from '@/lib/live/env-surfaces';
import { LiveApiError, liveErrorResponse, resolveLiveLocale } from '@/lib/live/errors';
import { assertLiveMutationAllowed, readLiveJsonBody } from '@/lib/live/http';
import { publicSourceView } from '@/lib/live/api-sanitize';
import { LiveControlService } from '@/lib/live/control-service';
import { LiveSourceRepository } from '@/lib/live/source-repository';
import { LiveSessionRepository } from '@/lib/live/session-repository';

export const runtime = 'nodejs';

const createSchema = z.object({
  name: z.string().min(1).max(200),
  /** Opt-in via LIVE_ALLOWED_PROTOCOLS; default deployment remains RTSP-only. */
  protocol: z.enum(['rtsp', 'hls', 'srt', 'whip']),
  connection_ref: z.string().min(1),
  transport: z.enum(['tcp', 'udp', 'caller', 'listener']).optional(),
  enabled: z.boolean().optional(),
});

function clientKey(request: Request): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'local'
  );
}

export async function GET(request: Request) {
  try {
    assertWebEnvHasNoLiveSourceSecrets();
    const sources = new LiveSourceRepository();
    const sessions = new LiveSessionRepository();
    const list = await sources.listAll(100);
    const out = [];
    for (const s of list) {
      let latest = null;
      if (s.source.active_session_id) {
        const sess = await sessions.get(s.source.active_session_id);
        latest = sess?.source ?? null;
      }
      out.push(publicSourceView(s.source, latest));
    }
    return NextResponse.json({ sources: out });
  } catch (err) {
    const locale = resolveLiveLocale(request);
    if (err instanceof LiveApiError) return liveErrorResponse(err, locale);
    if (err instanceof Error && /LIVE_SOURCE_/.test(err.message)) {
      return liveErrorResponse('LIVE_INVALID_REQUEST', locale);
    }
    throw err;
  }
}

export async function POST(request: Request) {
  const locale = resolveLiveLocale(request);
  try {
    assertWebEnvHasNoLiveSourceSecrets();
    assertLiveMutationAllowed(`live:sources:${clientKey(request)}`);
    const raw = await readLiveJsonBody(request);
    const parsed = createSchema.safeParse(raw);
    if (!parsed.success) {
      return liveErrorResponse('LIVE_INVALID_REQUEST', locale);
    }
    const service = new LiveControlService();
    const source = await service.createSource(parsed.data);
    return NextResponse.json({ source: publicSourceView(source) }, { status: 201 });
  } catch (err) {
    if (err instanceof LiveApiError) return liveErrorResponse(err, locale);
    throw err;
  }
}
