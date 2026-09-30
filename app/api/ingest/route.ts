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
import { titleFromFilename } from '@/lib/ingest/media-name';
import { titleFromUrlPath } from '@/lib/ingest/url-title';
import { IngestError, toIngestError } from '@/lib/ingest/errors';
import {
  ingestChunkingFields,
  resolveJobChunking,
} from '@/lib/ingest/chunking-request';
import {
  ingestGroupIdField,
  resolveIngestGroupId,
} from '@/lib/ingest/group-request';
import {
  ingestDramaField,
} from '@/lib/ingest/drama-request';
import { acceptDramaForIngest } from '@/lib/ingest/drama-accept';
import { ingestErrorMessage, resolveLocale } from '@/lib/i18n';

export const runtime = 'nodejs';

const bodySchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('url'),
    source: z.string().min(1),
    title: z.string().optional(),
    auto_start: z.boolean().optional().default(true),
    ...ingestChunkingFields,
    ...ingestGroupIdField,
    ...ingestDramaField,
  }),
  z.object({
    mode: z.literal('local'),
    source: z.string().min(1),
    title: z.string().optional(),
    auto_start: z.boolean().optional().default(true),
    ...ingestChunkingFields,
    ...ingestGroupIdField,
    ...ingestDramaField,
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
    case 'INGEST_INVALID_GROUP':
    case 'INGEST_DRAMA_EMPTY':
    case 'INGEST_DRAMA_INVALID':
    case 'INGEST_DRAMA_TOO_LONG':
    case 'INGEST_DRAMA_URL_NOT_SUPPORTED':
    case 'INGEST_DRAMA_NEEDS_DIRECTORS':
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
      const groupIssue = parsed.error.issues.some((i) =>
        i.path.includes('group_id'),
      );
      const dramaIssue = parsed.error.issues.some((i) =>
        i.path.includes('drama'),
      );
      return errorResponse(
        new IngestError(
          chunkIssue
            ? 'INGEST_INVALID_CHUNKING'
            : groupIssue
              ? 'INGEST_INVALID_GROUP'
              : dramaIssue
                ? 'INGEST_DRAMA_INVALID'
                : 'INGEST_INVALID_MODE',
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
    const groupId = resolveIngestGroupId(body.group_id);

    if (body.mode === 'url') {
      // Reject drama before download (OQ-4: URL drama later via Library).
      acceptDramaForIngest({
        mode: 'url',
        durationMs: 1,
        raw: body.drama,
      });
      const result = await importFromUrl(body.source, cfg);
      const job = createIngestJob({
        mode: 'url',
        mediaPath: result.mediaPath,
        // No explicit title: use the URL's last path segment. `mediaPath` is a
        // UUID-named download, so falling back to it would show a UUID.
        title:
          body.title ||
          titleFromUrlPath(result.provenance.source_origin_path) ||
          undefined,
        provenance: result.provenance,
        probe: result.probe,
        autoStart: body.auto_start,
        chunking,
        groupId,
      });
      await prepareJobEstimate(job);
      startPipelineAsync(job);
      return NextResponse.json(ingestAcceptResponse(job));
    }

    const local = await importFromLocalPath(body.source, cfg);
    const mediaPath = await copyLocalToOriginals(local.mediaPath, cfg);
    const drama = acceptDramaForIngest({
      mode: 'local',
      durationMs: local.probe.duration_ms,
      raw: body.drama,
    });
    const job = createIngestJob({
      mode: 'local',
      mediaPath,
      title: body.title || titleFromFilename(body.source) || undefined,
      probe: local.probe,
      autoStart: body.auto_start,
      chunking,
      groupId,
      drama,
    });
    await prepareJobEstimate(job);
    startPipelineAsync(job);
    return NextResponse.json(ingestAcceptResponse(job));
  } catch (err) {
    const ingestErr = toIngestError(err);
    return errorResponse(ingestErr, locale, statusForCode(ingestErr.code));
  }
}
