import { NextResponse } from 'next/server';
import { z } from 'zod';
import { runLiveAgeDelete } from '@/lib/live/age-delete';
import { assertWebEnvHasNoLiveSourceSecrets } from '@/lib/live/env-surfaces';
import { LiveApiError, liveErrorResponse, resolveLiveLocale } from '@/lib/live/errors';
import { assertLiveMutationAllowed, readLiveJsonBody } from '@/lib/live/http';

export const runtime = 'nodejs';

const bodySchema = z.object({
  /** Duration token (`24h`, `7d`) — delete data with key timestamp older than now − duration. */
  older_than: z.union([z.string().min(1), z.number().positive()]),
  session_id: z.string().min(1).optional(),
  /** When true (default), only report counters; no ES/spool deletes. */
  dry_run: z.boolean().optional().default(true),
});

function clientKey(request: Request): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'local'
  );
}

/**
 * POST /api/live/ops/age-delete
 * Explicit ops reclaim. Default forever retention; this never runs automatically.
 * Defaults to dry_run=true — set dry_run=false to execute.
 */
export async function POST(request: Request) {
  const locale = resolveLiveLocale(request);
  try {
    assertWebEnvHasNoLiveSourceSecrets();
    assertLiveMutationAllowed(`live:age-delete:${clientKey(request)}`);
    const raw = await readLiveJsonBody(request);
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      return liveErrorResponse('LIVE_INVALID_REQUEST', locale);
    }
    let audit;
    try {
      audit = await runLiveAgeDelete({
        olderThan: parsed.data.older_than,
        sessionId: parsed.data.session_id,
        dryRun: parsed.data.dry_run,
      });
    } catch (err) {
      if (err instanceof Error && /duration|olderThan/i.test(err.message)) {
        return liveErrorResponse('LIVE_INVALID_REQUEST', locale, {
          detail: err.message,
        });
      }
      throw err;
    }
    return NextResponse.json({ age_delete: audit });
  } catch (err) {
    if (err instanceof LiveApiError) return liveErrorResponse(err, locale);
    throw err;
  }
}
