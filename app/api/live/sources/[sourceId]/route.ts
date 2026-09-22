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

const patchSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    connection_ref: z.string().min(1).optional(),
    transport: z.enum(['tcp', 'udp', 'caller', 'listener']).optional(),
    enabled: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'empty patch' });

function clientKey(request: Request): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'local'
  );
}

export async function GET(
  request: Request,
  context: { params: { sourceId: string } },
) {
  const locale = resolveLiveLocale(request);
  try {
    assertWebEnvHasNoLiveSourceSecrets();
    const sources = new LiveSourceRepository();
    const sessions = new LiveSessionRepository();
    const doc = await sources.get(context.params.sourceId);
    if (!doc) return liveErrorResponse('LIVE_SOURCE_NOT_FOUND', locale);
    let latest = null;
    if (doc.source.active_session_id) {
      const sess = await sessions.get(doc.source.active_session_id);
      latest = sess?.source ?? null;
    }
    return NextResponse.json({
      source: publicSourceView(doc.source, latest),
    });
  } catch (err) {
    if (err instanceof LiveApiError) return liveErrorResponse(err, locale);
    throw err;
  }
}

export async function PATCH(
  request: Request,
  context: { params: { sourceId: string } },
) {
  const locale = resolveLiveLocale(request);
  try {
    assertWebEnvHasNoLiveSourceSecrets();
    assertLiveMutationAllowed(`live:sources:${clientKey(request)}`);
    const raw = await readLiveJsonBody(request);
    const parsed = patchSchema.safeParse(raw);
    if (!parsed.success) {
      return liveErrorResponse('LIVE_INVALID_REQUEST', locale);
    }
    const service = new LiveControlService();
    const source = await service.patchSource(context.params.sourceId, parsed.data);
    return NextResponse.json({ source: publicSourceView(source) });
  } catch (err) {
    if (err instanceof LiveApiError) return liveErrorResponse(err, locale);
    throw err;
  }
}

/** DELETE /api/live/sources/{sourceId} — remove source control doc. */
export async function DELETE(
  request: Request,
  context: { params: { sourceId: string } },
) {
  const locale = resolveLiveLocale(request);
  try {
    assertWebEnvHasNoLiveSourceSecrets();
    assertLiveMutationAllowed(`live:sources:${clientKey(request)}`);
    const sourceId = context.params.sourceId;
    if (!sourceId || sourceId.includes('/') || sourceId.includes('..')) {
      return liveErrorResponse('LIVE_INVALID_REQUEST', locale);
    }
    const service = new LiveControlService();
    const result = await service.deleteSource(sourceId);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof LiveApiError) return liveErrorResponse(err, locale);
    throw err;
  }
}
