import { NextResponse } from 'next/server';
import { Readable } from 'node:stream';
import { getConfig } from '@/lib/config';
import { ingestAcceptResponse } from '@/lib/ingest/api-response';
import { createIngestJob } from '@/lib/ingest/job-store';
import {
  prepareJobEstimate,
  startPipelineAsync,
} from '@/lib/ingest/pipeline';
import { importFromUploadStream } from '@/lib/ingest/sources';
import { IngestError, toIngestError } from '@/lib/ingest/errors';
import {
  parseChunkingFromFormData,
  resolveJobChunking,
} from '@/lib/ingest/chunking-request';
import { ingestErrorMessage, resolveLocale } from '@/lib/i18n';

export const runtime = 'nodejs';

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

function parseAutoStart(raw: FormDataEntryValue | null): boolean {
  if (typeof raw !== 'string') return true;
  const v = raw.trim().toLowerCase();
  if (v === 'false' || v === '0' || v === 'no') return false;
  return true;
}

export async function POST(request: Request) {
  const cfg = getConfig();
  const locale = resolveLocale(
    request.headers.get('accept-language'),
    cfg.DEFAULT_LOCALE,
  );

  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('multipart/form-data')) {
    return errorResponse(new IngestError('INGEST_UPLOAD_NO_FILE'), locale, 400);
  }

  try {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return errorResponse(new IngestError('INGEST_UPLOAD_NO_FILE'), locale, 400);
    }

    const chunking = resolveJobChunking(parseChunkingFromFormData(form));

    const webStream = file.stream();
    const nodeStream = Readable.fromWeb(
      webStream as import('node:stream/web').ReadableStream,
    );
    const result = await importFromUploadStream(
      nodeStream,
      file.name,
      cfg,
    );

    const titleField = form.get('title');
    const title =
      typeof titleField === 'string' && titleField.trim()
        ? titleField.trim()
        : undefined;

    const job = createIngestJob({
      mode: 'upload',
      mediaPath: result.mediaPath,
      title,
      probe: result.probe,
      autoStart: parseAutoStart(form.get('auto_start')),
      chunking,
    });
    await prepareJobEstimate(job);
    startPipelineAsync(job);

    return NextResponse.json(ingestAcceptResponse(job));
  } catch (err) {
    const ingestErr = toIngestError(err);
    const status =
      ingestErr.code === 'INGEST_UPLOAD_SIZE_EXCEEDED'
        ? 413
        : ingestErr.code === 'INGEST_INVALID_CHUNKING'
          ? 400
          : 400;
    return errorResponse(ingestErr, locale, status);
  }
}
