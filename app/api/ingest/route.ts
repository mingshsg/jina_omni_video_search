import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getConfig } from '@/lib/config';
import { ingestAcceptResponse } from '@/lib/ingest/api-response';
import { createIngestJob } from '@/lib/ingest/job-store';
import {
  prepareJobEstimate,
  startPipelineAsync,
} from '@/lib/ingest/pipeline';
import {
  copyLocalToOriginals,
  importFromLocalPath,
  importFromUrl,
} from '@/lib/ingest/sources';
import { IngestError, toIngestError } from '@/lib/ingest/errors';
import {
  ingestChunkingFields,
  resolveJobChunking,
} from '@/lib/ingest/chunking-request';
import { ingestErrorMessage, resolveLocale } from '@/lib/i18n';

export const runtime = 'nodejs';

const bodySchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('url'),
    source: z.string().min(1),
    title: z.string().optional(),
    auto_start: z.boolean().optional().default(true),
    ...ingestChunkingFields,
  }),
  z.object({
    mode: z.literal('local'),
    source: z.string().min(1),
    title: z.string().optional(),
    auto_start: z.boolean().optional().default(true),
    ...ingestChunkingFields,
  }),
]).superRefine((data, ctx) => {
  const hasW = data.window_ms !== undefined;
  const hasO = data.overlap_ms !== undefined;
  if (hasW !== hasO) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'window_ms and overlap_ms must be provided together',
      path: ['window_ms'],
    });
  }
});

function errorResponse(err: IngestError, locale: 'zh' | 'en', status: number) {
  return NextResponse.json(
    {
      error: {
        code: err.code,
        message: ingestErrorMessage(err.code, locale),
      },
    },
    { status },
  );
}

function statusForCode(code: IngestError['code']): number {
  switch (code) {
    case 'INGEST_URL_SSRF_BLOCKED':
    case 'INGEST_URL_CREDENTIALS':
    case 'INGEST_LOCAL_TRAVERSAL':
      return 403;
    case 'INGEST_LOCAL_NOT_FOUND':
      return 404;
    case 'INGEST_URL_SIZE_EXCEEDED':
    case 'INGEST_LOCAL_SIZE_EXCEEDED':
    case 'INGEST_UPLOAD_SIZE_EXCEEDED':
      return 413;
    case 'INGEST_URL_TIMEOUT':
      return 504;
    case 'INGEST_INVALID_MODE':
    case 'INGEST_INVALID_CHUNKING':
      return 400;
    default:
      return 400;
  }
}

export async function POST(request: Request) {
  const cfg = getConfig();
  const locale = resolveLocale(
    request.headers.get('accept-language'),
    cfg.DEFAULT_LOCALE,
  );

  let body: z.infer<typeof bodySchema>;
  try {
    const json: unknown = await request.json();
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      const chunkIssue = parsed.error.issues.some(
        (i) =>
          i.path.includes('chunk_preset') ||
          i.path.includes('window_ms') ||
          i.path.includes('overlap_ms') ||
          i.path.includes('min_ms') ||
          i.message.includes('window_ms'),
      );
      return errorResponse(
        new IngestError(
          chunkIssue ? 'INGEST_INVALID_CHUNKING' : 'INGEST_INVALID_MODE',
        ),
        locale,
        400,
      );
    }
    body = parsed.data;
  } catch {
    return errorResponse(new IngestError('INGEST_INVALID_MODE'), locale, 400);
  }

  try {
    const chunking = resolveJobChunking({
      chunk_preset: body.chunk_preset,
      window_ms: body.window_ms,
      overlap_ms: body.overlap_ms,
      min_ms: body.min_ms,
    });

    if (body.mode === 'url') {
      const result = await importFromUrl(body.source, cfg);
      const job = createIngestJob({
        mode: 'url',
        mediaPath: result.mediaPath,
        title: body.title,
        provenance: result.provenance,
        probe: result.probe,
        autoStart: body.auto_start,
        chunking,
      });
      await prepareJobEstimate(job);
      startPipelineAsync(job);
      return NextResponse.json(ingestAcceptResponse(job));
    }

    const local = await importFromLocalPath(body.source, cfg);
    const mediaPath = await copyLocalToOriginals(local.mediaPath, cfg);
    const job = createIngestJob({
      mode: 'local',
      mediaPath,
      title: body.title,
      probe: local.probe,
      autoStart: body.auto_start,
      chunking,
    });
    await prepareJobEstimate(job);
    startPipelineAsync(job);
    return NextResponse.json(ingestAcceptResponse(job));
  } catch (err) {
    const ingestErr = toIngestError(err);
    return errorResponse(ingestErr, locale, statusForCode(ingestErr.code));
  }
}
