import { NextResponse } from 'next/server';
import { getConfig } from '@/lib/config';
import { ingestAcceptResponse } from '@/lib/ingest/api-response';
import { getIngestJob, resolveIngestJob } from '@/lib/ingest/job-store';
import { confirmAndStartJob } from '@/lib/ingest/pipeline';
import { resolveLocale } from '@/lib/i18n';

export const runtime = 'nodejs';

export async function POST(
  request: Request,
  context: { params: { id: string } },
) {
  const cfg = getConfig();
  const locale = resolveLocale(
    request.headers.get('accept-language'),
    cfg.DEFAULT_LOCALE,
  );

  const job =
    getIngestJob(context.params.id) ??
    (await resolveIngestJob(context.params.id));

  if (!job) {
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

  if (job.status === 'awaiting_confirm' || job.status === 'pending') {
    await confirmAndStartJob(job);
  }

  return NextResponse.json(ingestAcceptResponse(job));
}
