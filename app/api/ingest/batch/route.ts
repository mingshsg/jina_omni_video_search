import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { Readable } from 'node:stream';
import { z } from 'zod';
import { getConfig } from '@/lib/config';
import { ingestAcceptResponse } from '@/lib/ingest/api-response';
import {
  ingestChunkingFields,
  parseChunkingFromFormData,
  resolveJobChunking,
  type IngestChunkingFields,
} from '@/lib/ingest/chunking-request';
import type { ChunkingConfig } from '@/lib/ingest/chunk-presets';
import { IngestError, toIngestError } from '@/lib/ingest/errors';
import { createIngestJob, type IngestJob } from '@/lib/ingest/job-store';
import {
  prepareJobEstimate,
  startPipelineAsync,
} from '@/lib/ingest/pipeline';
import {
  BATCH_IMPORT_MAX_FILES,
  copyLocalToOriginals,
  importFromLocalPath,
  importFromUploadStream,
  listVideoFilesInImportFolder,
} from '@/lib/ingest/sources';
import { ingestErrorMessage, resolveLocale } from '@/lib/i18n';

export const runtime = 'nodejs';

const folderBodySchema = z
  .object({
    mode: z.literal('folder'),
    path: z.string().min(1),
    auto_start: z.boolean().optional().default(true),
    ...ingestChunkingFields,
  })
  .superRefine((data, ctx) => {
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

type BatchItemError = {
  source: string;
  code: string;
  message: string;
};

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
    case 'INGEST_LOCAL_TRAVERSAL':
      return 403;
    case 'INGEST_LOCAL_NOT_FOUND':
      return 404;
    case 'INGEST_UPLOAD_SIZE_EXCEEDED':
    case 'INGEST_LOCAL_SIZE_EXCEEDED':
      return 413;
    case 'INGEST_BATCH_TOO_LARGE':
      return 413;
    default:
      return 400;
  }
}

function parseAutoStart(raw: FormDataEntryValue | null): boolean {
  if (typeof raw !== 'string') return true;
  const v = raw.trim().toLowerCase();
  if (v === 'false' || v === '0' || v === 'no') return false;
  return true;
}

function titleFromFilename(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? name;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

async function acceptLocalFileJob(opts: {
  sourcePath: string;
  chunking: ChunkingConfig;
  autoStart: boolean;
  cfg: ReturnType<typeof getConfig>;
}): Promise<IngestJob> {
  const local = await importFromLocalPath(opts.sourcePath, opts.cfg);
  const mediaPath = await copyLocalToOriginals(local.mediaPath, opts.cfg);
  const job = createIngestJob({
    mode: 'local',
    mediaPath,
    title: titleFromFilename(opts.sourcePath),
    probe: local.probe,
    autoStart: opts.autoStart,
    chunking: opts.chunking,
  });
  await prepareJobEstimate(job);
  startPipelineAsync(job);
  return job;
}

async function acceptUploadFileJob(opts: {
  file: File;
  chunking: ChunkingConfig;
  autoStart: boolean;
  cfg: ReturnType<typeof getConfig>;
}): Promise<IngestJob> {
  const webStream = opts.file.stream();
  const nodeStream = Readable.fromWeb(
    webStream as import('node:stream/web').ReadableStream,
  );
  const result = await importFromUploadStream(
    nodeStream,
    opts.file.name,
    opts.cfg,
  );
  const job = createIngestJob({
    mode: 'upload',
    mediaPath: result.mediaPath,
    title: titleFromFilename(opts.file.name),
    probe: result.probe,
    autoStart: opts.autoStart,
    chunking: opts.chunking,
  });
  await prepareJobEstimate(job);
  startPipelineAsync(job);
  return job;
}

function batchResponse(
  jobs: IngestJob[],
  errors: BatchItemError[],
  chunking: ChunkingConfig,
) {
  return {
    batch_id: randomUUID(),
    chunk_preset: chunking.preset,
    chunk_window_ms: chunking.windowMs,
    chunk_overlap_ms: chunking.overlapMs,
    job_ids: jobs.map((j) => j.id),
    jobs: jobs.map((j) => ({
      ...ingestAcceptResponse(j),
      title: j.title,
    })),
    errors,
  };
}

/**
 * Batch ingest: multipart multi-file upload, or JSON folder under
 * LOCAL_IMPORT_ROOT. One file = one video_id; shared chunk_preset.
 */
export async function POST(request: Request) {
  const cfg = getConfig();
  const locale = resolveLocale(
    request.headers.get('accept-language'),
    cfg.DEFAULT_LOCALE,
  );

  const contentType = request.headers.get('content-type') ?? '';

  try {
    if (contentType.includes('multipart/form-data')) {
      return await handleUploadBatch(request, cfg, locale);
    }
    if (contentType.includes('application/json')) {
      return await handleFolderBatch(request, cfg, locale);
    }
    return errorResponse(new IngestError('INGEST_INVALID_MODE'), locale, 400);
  } catch (err) {
    const ingestErr = toIngestError(err);
    return errorResponse(ingestErr, locale, statusForCode(ingestErr.code));
  }
}

async function handleFolderBatch(
  request: Request,
  cfg: ReturnType<typeof getConfig>,
  locale: 'zh' | 'en',
) {
  let body: z.infer<typeof folderBodySchema>;
  try {
    const json: unknown = await request.json();
    const parsed = folderBodySchema.safeParse(json);
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

  const chunking = resolveJobChunking({
    chunk_preset: body.chunk_preset,
    window_ms: body.window_ms,
    overlap_ms: body.overlap_ms,
    min_ms: body.min_ms,
  });

  const files = await listVideoFilesInImportFolder(body.path, cfg);
  const jobs: IngestJob[] = [];
  const errors: BatchItemError[] = [];

  for (const filePath of files) {
    try {
      const job = await acceptLocalFileJob({
        sourcePath: filePath,
        chunking,
        autoStart: body.auto_start,
        cfg,
      });
      jobs.push(job);
    } catch (err) {
      const ingestErr = toIngestError(err);
      errors.push({
        source: filePath.split(/[/\\]/).pop() ?? 'file',
        code: ingestErr.code,
        message: ingestErrorMessage(ingestErr.code, locale),
      });
    }
  }

  if (jobs.length === 0) {
    return errorResponse(new IngestError('INGEST_BATCH_EMPTY'), locale, 400);
  }

  return NextResponse.json(batchResponse(jobs, errors, chunking));
}

async function handleUploadBatch(
  request: Request,
  cfg: ReturnType<typeof getConfig>,
  locale: 'zh' | 'en',
) {
  const form = await request.formData();
  const chunkFields: IngestChunkingFields = parseChunkingFromFormData(form);
  const chunking = resolveJobChunking(chunkFields);
  const autoStart = parseAutoStart(form.get('auto_start'));

  const collected: File[] = [];
  for (const key of ['files', 'file']) {
    for (const entry of form.getAll(key)) {
      if (entry instanceof File && entry.size > 0) {
        collected.push(entry);
      }
    }
  }

  // Dedupe if both keys present with same File references is unlikely;
  // still cap by count.
  if (collected.length === 0) {
    return errorResponse(new IngestError('INGEST_BATCH_EMPTY'), locale, 400);
  }
  if (collected.length > BATCH_IMPORT_MAX_FILES) {
    return errorResponse(
      new IngestError('INGEST_BATCH_TOO_LARGE'),
      locale,
      413,
    );
  }

  const jobs: IngestJob[] = [];
  const errors: BatchItemError[] = [];

  for (const file of collected) {
    try {
      const job = await acceptUploadFileJob({
        file,
        chunking,
        autoStart,
        cfg,
      });
      jobs.push(job);
    } catch (err) {
      const ingestErr = toIngestError(err);
      errors.push({
        source: file.name || 'upload',
        code: ingestErr.code,
        message: ingestErrorMessage(ingestErr.code, locale),
      });
    }
  }

  if (jobs.length === 0) {
    return errorResponse(new IngestError('INGEST_BATCH_EMPTY'), locale, 400);
  }

  return NextResponse.json(batchResponse(jobs, errors, chunking));
}
