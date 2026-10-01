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
import { isDramaRunActive, startDramaEnrichmentAsync } from '@/lib/drama/runner';
import { DramaRetryPolicyError, resolveDramaRetryPolicy } from '@/lib/drama/retry-policy';
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

  // An omitted body retains the original retry contract. A supplied body
  // explicitly changes only the subtitle policy of a failed enrichment run.
  let retryPolicy: ReturnType<typeof resolveDramaRetryPolicy> | undefined;
  const body = await request.text();
  if (body.trim()) {
    if (body.length > 4096) {
      return NextResponse.json(
        { error: { code: 'DRAMA_RETRY_POLICY_INVALID', message: 'Invalid subtitle retry options' } },
        { status: 400 },
      );
    }
    if (prev.status !== 'ready' || !prev.drama ||
        ['succeeded', 'skipped'].includes(prev.drama.status)) {
      return NextResponse.json(
        { error: { code: 'DRAMA_RETRY_POLICY_UNAVAILABLE', message: 'Subtitle options can only be changed when retrying unfinished enrichment' } },
        { status: 409 },
      );
    }
    try {
      retryPolicy = resolveDramaRetryPolicy(prev.drama, JSON.parse(body) as unknown);
    } catch (err) {
      const policyError = err instanceof DramaRetryPolicyError
        ? err
        : new DramaRetryPolicyError('DRAMA_RETRY_POLICY_INVALID', 400, 'Invalid subtitle retry options');
      return NextResponse.json(
        { error: { code: policyError.code, message: policyError.message } },
        { status: policyError.status },
      );
    }
  }

  // Drama-only resume (R7): base ingest already reached `ready`, so rerun
  // just the follow-on enrichment instead of re-embedding every chunk.
  // The stable run ID is kept so subtitle bulk `_id`s overwrite rather
  // than duplicate; the per-video lease (F1) rejects overlapping runs.
  if (
    prev.status === 'ready' &&
    prev.drama &&
    prev.drama.status !== 'succeeded' &&
    prev.drama.status !== 'skipped'
  ) {
    // F1: refuse when a run is active. This check and the runner's
    // lease acquisition below execute with no `await` between them, so
    // the pair is atomic on a single process (no interleaving request
    // can slip in). Cross-replica overlap remains explicitly open.
    if (isDramaRunActive(prev.videoId)) {
      return NextResponse.json(
        {
          error: {
            code: 'DRAMA_RUN_ACTIVE',
            message:
              locale === 'zh'
                ? '该视频的增强正在运行，请等待完成后再重试'
                : 'Enrichment is already running for this video; wait for it to finish before retrying',
          },
        },
        { status: 409 },
      );
    }
    prev.drama = {
      status: 'pending',
      languages: prev.drama.languages,
      modules: prev.drama.modules,
      modules_done: [],
      run_id: prev.drama.run_id,
      // Default to the original policy; an explicit retry request may revise it.
      subtitleSource: retryPolicy?.subtitleSource ?? prev.drama.subtitleSource,
      sourceLanguage: retryPolicy?.sourceLanguage ?? prev.drama.sourceLanguage,
      directorCoverage: prev.drama.directorCoverage,
    };
    prev.pipelineRunning = false;
    // The runner acquires the lease and releases it in `finally`.
    startDramaEnrichmentAsync(prev);
    return NextResponse.json(ingestAcceptResponse(prev));
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
    // Carry an unfinished drama request so base retry still enriches (R7).
    // The stable run ID is carried too (F1) so a later drama rerun
    // overwrites the same subtitle documents.
    drama:
      prev.drama &&
      prev.drama.status !== 'succeeded' &&
      prev.drama.status !== 'skipped'
        ? {
            status: 'pending',
            languages: prev.drama.languages,
            modules: prev.drama.modules,
            modules_done: [],
            run_id: prev.drama.run_id,
            // P4: keep the original per-run policy on base retry too.
            subtitleSource: prev.drama.subtitleSource,
            sourceLanguage: prev.drama.sourceLanguage,
            directorCoverage: prev.drama.directorCoverage,
          }
        : undefined,
  });
  // Carry forward prior variants so upsert merges correctly
  job.variants = prev.variants.map((v) => ({ ...v }));
  job.playbackPath = prev.playbackPath;

  await prepareJobEstimate(job);
  startPipelineAsync(job);

  return NextResponse.json(ingestAcceptResponse(job));
}
