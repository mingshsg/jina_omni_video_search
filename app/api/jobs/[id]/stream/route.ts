import type { NextRequest } from 'next/server';
import {
  emitJobEvent,
  resolveIngestJob,
  subscribeJob,
  toProgressEvent,
  type JobEventName,
  type JobProgressEvent,
} from '@/lib/ingest/job-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HEARTBEAT_MS = 15_000;

export async function GET(
  request: NextRequest,
  context: { params: { id: string } },
) {
  const jobId = context.params.id;
  const job = await resolveIngestJob(jobId);
  if (!job) {
    return new Response(JSON.stringify({ error: { code: 'JOB_NOT_FOUND', message: 'Job not found' } }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const encoder = new TextEncoder();
  let closed = false;
  let unsubscribe: (() => void) | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: JobEventName, payload: JobProgressEvent) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(
              `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`,
            ),
          );
        } catch {
          closed = true;
        }
      };

      send('snapshot', toProgressEvent(job));

      unsubscribe = subscribeJob(jobId, (event, payload) => {
        send(event, payload);
        if (event === 'complete' || event === 'error') {
          // Allow a short flush then close
          setTimeout(() => {
            if (closed) return;
            closed = true;
            if (heartbeat) clearInterval(heartbeat);
            unsubscribe?.();
            try {
              controller.close();
            } catch {
              /* already closed */
            }
          }, 100);
        }
      });

      heartbeat = setInterval(() => {
        if (closed) return;
        emitJobEvent(job, 'heartbeat');
      }, HEARTBEAT_MS);

      request.signal.addEventListener('abort', () => {
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        unsubscribe?.();
        try {
          controller.close();
        } catch {
          /* ignore */
        }
      });
    },
    cancel() {
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      unsubscribe?.();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
