import { getLiveConfig } from '@/lib/live/config';
import { assertWebEnvHasNoLiveSourceSecrets } from '@/lib/live/env-surfaces';
import {
  LiveApiError,
  liveErrorResponse,
  resolveLiveLocale,
} from '@/lib/live/errors';
import { publicSessionSummary, workerHeartbeatFresh } from '@/lib/live/api-sanitize';
import { LiveEventRepository } from '@/lib/live/event-repository';
import { LiveSessionRepository } from '@/lib/live/session-repository';
import { LiveWorkerRepository } from '@/lib/live/worker-repository';
import type { LiveEventDocument } from '@/lib/live/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseLastEventId(
  raw: string | null,
  publishedRevision: number,
): number {
  if (raw == null || raw.trim() === '') return 0;
  if (!/^\d+$/.test(raw.trim())) {
    throw new LiveApiError('LIVE_EVENT_CURSOR_INVALID');
  }
  const n = Number(raw.trim());
  if (!Number.isInteger(n) || n < 0) {
    throw new LiveApiError('LIVE_EVENT_CURSOR_INVALID');
  }
  if (n > publishedRevision) {
    throw new LiveApiError('LIVE_EVENT_CURSOR_INVALID');
  }
  // Forever retention: no age-based cursor expiry in MVP.
  return n;
}

function sseFrame(
  event: string,
  data: unknown,
  id?: number,
): string {
  const lines = [
    ...(id !== undefined ? [`id: ${id}`] : []),
    `event: ${event}`,
    `data: ${JSON.stringify(data)}`,
    '',
    '',
  ];
  return lines.join('\n');
}

function eventPayload(ev: LiveEventDocument): Record<string, unknown> {
  return {
    session_id: ev.session_id,
    revision: ev.revision,
    ts: ev['@timestamp'],
    payload: {
      ...ev.payload,
      ...(ev.chunk_id ? { chunk_id: ev.chunk_id } : {}),
      ...(ev.searchable_at ? { searchable_at: ev.searchable_at } : {}),
      ...(ev.processing_lag_ms !== undefined
        ? { processing_lag_ms: ev.processing_lag_ms }
        : {}),
    },
  };
}

export async function GET(
  request: Request,
  context: { params: { sessionId: string } },
) {
  const locale = resolveLiveLocale(request);
  try {
    assertWebEnvHasNoLiveSourceSecrets();
    const cfg = getLiveConfig();
    const sessions = new LiveSessionRepository();
    const events = new LiveEventRepository();
    const workers = new LiveWorkerRepository();

    const session = await sessions.get(context.params.sessionId);
    if (!session) {
      return liveErrorResponse('LIVE_SESSION_NOT_FOUND', locale);
    }

    const lastEventId = request.headers.get('last-event-id');
    let cursor = parseLastEventId(
      lastEventId,
      session.source.published_revision,
    );

    const encoder = new TextEncoder();
    let closed = false;
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
    let pollInFlight = false;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (chunk: string) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(chunk));
          } catch {
            closed = true;
          }
        };

        void (async () => {
          const worker = await workers.getSingleton();
          const available = workerHeartbeatFresh(
            worker?.source,
            cfg.LIVE_WORKER_STALE_MS,
          );
          send(
            sseFrame(
              'snapshot',
              publicSessionSummary(session.source, available),
            ),
          );

          const replay = await events.listAfterRevision(
            session.source.session_id,
            cursor,
            200,
          );
          for (const ev of replay) {
            // Detect gap: expected next revision
            if (ev.revision > cursor + 1) {
              send(
                sseFrame('recovery_gap', {
                  session_id: session.source.session_id,
                  from_revision: cursor,
                  to_revision: ev.revision,
                }),
              );
              send(
                sseFrame(
                  'snapshot',
                  publicSessionSummary(session.source, available),
                ),
              );
            }
            send(sseFrame(ev.type, eventPayload(ev), ev.revision));
            cursor = ev.revision;
          }

          // Catch-up again after attaching (contract: replay between ops)
          const again = await events.listAfterRevision(
            session.source.session_id,
            cursor,
            200,
          );
          for (const ev of again) {
            send(sseFrame(ev.type, eventPayload(ev), ev.revision));
            cursor = ev.revision;
          }

          pollTimer = setInterval(() => {
            // A-19 / M6: single-flight — skip if prior ES poll still in flight.
            if (pollInFlight || closed) return;
            pollInFlight = true;
            void (async () => {
              try {
                if (closed) return;
                const batch = await events.listAfterRevision(
                  session.source.session_id,
                  cursor,
                  50,
                );
                for (const ev of batch) {
                  if (ev.revision > cursor + 1) {
                    send(
                      sseFrame('recovery_gap', {
                        session_id: session.source.session_id,
                        from_revision: cursor,
                        to_revision: ev.revision,
                      }),
                    );
                  }
                  send(sseFrame(ev.type, eventPayload(ev), ev.revision));
                  cursor = ev.revision;
                }
              } catch {
                // keep stream alive; next poll retries
              } finally {
                pollInFlight = false;
              }
            })();
          }, cfg.LIVE_EVENT_POLL_MS);

          heartbeatTimer = setInterval(() => {
            send(
              sseFrame('heartbeat', {
                session_id: session.source.session_id,
                ts: new Date().toISOString(),
                cursor,
              }),
            );
          }, 15_000);
        })();

        request.signal.addEventListener('abort', () => {
          closed = true;
          if (pollTimer) clearInterval(pollTimer);
          if (heartbeatTimer) clearInterval(heartbeatTimer);
          try {
            controller.close();
          } catch {
            // ignore
          }
        });
      },
      cancel() {
        closed = true;
        if (pollTimer) clearInterval(pollTimer);
        if (heartbeatTimer) clearInterval(heartbeatTimer);
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  } catch (err) {
    if (err instanceof LiveApiError) return liveErrorResponse(err, locale);
    throw err;
  }
}
