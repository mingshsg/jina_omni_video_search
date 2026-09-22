import { getLiveConfig } from '@/lib/live/config';
import { assertWebEnvHasNoLiveSourceSecrets } from '@/lib/live/env-surfaces';
import {
  LiveApiError,
  liveErrorResponse,
  resolveLiveLocale,
} from '@/lib/live/errors';
import { LiveEventRepository } from '@/lib/live/event-repository';
import {
  deleteFollowSearchHandle,
  getFollowSearchHandle,
} from '@/lib/live/follow-search';
import {
  rerunLiveSearchWithVector,
  type LiveSearchHit,
} from '@/lib/live/search';
import type { LiveEventDocument } from '@/lib/live/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function sseFrame(
  event: string,
  data: unknown,
  id?: string,
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

/**
 * Follow-search SSE: consume durable events per selected session cursor.
 * searchable → re-evaluate with cached query_vector; replace full top-K.
 */
export async function GET(
  request: Request,
  context: { params: { queryId: string } },
) {
  const locale = resolveLiveLocale(request);
  try {
    assertWebEnvHasNoLiveSourceSecrets();
    const cfg = getLiveConfig();
    const handle = getFollowSearchHandle(context.params.queryId);
    const events = new LiveEventRepository();

    const encoder = new TextEncoder();
    let closed = false;
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
    let evaluating = false;
    let pendingMax: Record<string, number> = {};

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

        const advanceCursor = (sessionId: string, revision: number) => {
          const prev = handle.sessionCursors[sessionId] ?? 0;
          if (revision > prev) handle.sessionCursors[sessionId] = revision;
        };

        const emitResults = (
          hits: LiveSearchHit[],
          cursors: Record<string, number>,
          reason: string,
        ) => {
          send(
            sseFrame('results', {
              query_id: handle.queryId,
              reason,
              session_cursors: cursors,
              hits,
              meta: {
                size: handle.size,
                modality: handle.modality,
                sort_by: handle.sortBy,
                variant_id: handle.variantId,
              },
            }),
          );
        };

        const emitCursor = (sessionId: string, revision: number) => {
          send(
            sseFrame(
              'cursor',
              {
                query_id: handle.queryId,
                session_id: sessionId,
                revision,
                session_cursors: { ...handle.sessionCursors },
              },
              `${sessionId}:${revision}`,
            ),
          );
        };

        const evaluateFromPending = async () => {
          if (evaluating || closed) return;
          evaluating = true;
          try {
            while (Object.keys(pendingMax).length > 0 && !closed) {
              const batch = pendingMax;
              pendingMax = {};
              let needsRerun = false;
              for (const [sessionId, maxRev] of Object.entries(batch)) {
                const after = handle.sessionCursors[sessionId] ?? 0;
                if (maxRev <= after) continue;
                const page = await events.listAfterRevision(
                  sessionId,
                  after,
                  100,
                );
                for (const ev of page) {
                  if (ev.revision > maxRev) break;
                  if (ev.type === 'searchable') {
                    needsRerun = true;
                  }
                  advanceCursor(sessionId, ev.revision);
                  if (ev.type !== 'searchable') {
                    emitCursor(sessionId, ev.revision);
                  }
                }
              }
              if (needsRerun) {
                const hits = await rerunLiveSearchWithVector({ handle });
                for (const h of hits) handle.seenChunkIds.add(h.chunk_id);
                emitResults(hits, { ...handle.sessionCursors }, 'searchable');
              }
            }
          } catch (err) {
            if (err instanceof LiveApiError && err.code === 'LIVE_QUERY_EXPIRED') {
              send(
                sseFrame('error', {
                  code: err.code,
                  message: err.message,
                }),
              );
              closed = true;
              try {
                controller.close();
              } catch {
                /* ignore */
              }
              return;
            }
            send(
              sseFrame('error', {
                code: 'LIVE_INDEX_FAILED',
                message:
                  err instanceof Error ? err.message : 'follow evaluate failed',
              }),
            );
          } finally {
            evaluating = false;
            if (Object.keys(pendingMax).length > 0) {
              void evaluateFromPending();
            }
          }
        };

        const poll = async () => {
          if (closed) return;
          try {
            getFollowSearchHandle(handle.queryId);
          } catch {
            send(
              sseFrame('error', {
                code: 'LIVE_QUERY_EXPIRED',
                message: 'Follow-search handle is unavailable',
              }),
            );
            closed = true;
            try {
              controller.close();
            } catch {
              /* ignore */
            }
            return;
          }

          for (const sessionId of handle.sessionIds) {
            const after = handle.sessionCursors[sessionId] ?? 0;
            let page: LiveEventDocument[] = [];
            try {
              page = await events.listAfterRevision(sessionId, after, 50);
            } catch {
              continue;
            }
            if (page.length === 0) continue;
            const maxRev = Math.max(...page.map((e) => e.revision));
            const prevPending = pendingMax[sessionId] ?? after;
            pendingMax[sessionId] = Math.max(prevPending, maxRev);
          }
          if (Object.keys(pendingMax).length > 0) {
            void evaluateFromPending();
          }
        };

        send(
          sseFrame('ready', {
            query_id: handle.queryId,
            session_cursors: { ...handle.sessionCursors },
            expires_at: new Date(handle.expiresAtMs).toISOString(),
          }),
        );

        void poll();
        pollTimer = setInterval(() => {
          void poll();
        }, cfg.LIVE_EVENT_POLL_MS);
        heartbeatTimer = setInterval(() => {
          send(sseFrame('heartbeat', { ts: new Date().toISOString() }));
        }, Math.max(5_000, cfg.LIVE_EVENT_POLL_MS * 10));
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
