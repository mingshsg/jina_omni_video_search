import { NextResponse } from 'next/server';
import { getConfig } from '@/lib/config';
import { ingestAcceptResponse } from '@/lib/ingest/api-response';
import {
  createIngestJob,
  getIngestJob,
  resolveIngestJob,
} from '@/lib/ingest/job-store';
import {
  prepareJobEstimate,
  startPipelineAsync,
} from '@/lib/ingest/pipeline';
import { resolveLocale } from '@/lib/i18n';

export const runtime = 'nodejs';

/**
 * Idempotent manual retry (FR-20): new job_id, same video_id + media;
 * chunk upserts replace by composite _id.
 */
export async function POST(
  request: Request,
  context: { params: { id: string } },
) {
  const cfg = getConfig();
  const locale = resolveLocale(
    request.headers.get('accept-language'),
    cfg.DEFAULT_LOCALE,
  );

  const prev =
    getIngestJob(context.params.id) ??
    (await resolveIngestJob(context.params.id));

  if (!prev) {
    return NextResponse.json(
      {
        error: {
          code: 'JOB_NOT_FOUND',
          message: locale === 'zh' ? '任务不存在' : 'Job not found',
        },
      },
      { status: 404 },
    );
  }

  const job = createIngestJob({
    mode: prev.mode,
    mediaPath: prev.mediaPath,
    probe: prev.probe,
    title: prev.title,
    provenance: prev.provenance,
    autoStart: true,
    videoId: prev.videoId,
    chunking: prev.chunking,
  });
  // Carry forward prior variants so upsert merges correctly
  job.variants = prev.variants.map((v) => ({ ...v }));
  job.playbackPath = prev.playbackPath;

  await prepareJobEstimate(job);
  startPipelineAsync(job);

  return NextResponse.json(ingestAcceptResponse(job));
}
