/** Start drama enrichment for an already indexed, ready video. */
import fs from 'node:fs';
import { getAsset } from '../es/index-assets';
import {
  initialDramaJobState,
  assertDramaDurationAllowed,
  type DramaRequestOptions,
} from '../ingest/drama-request';
import { resolveIngestJob } from '../ingest/job-store';
import {
  isDramaRunActive,
  prepareDramaHandoff,
  startDramaEnrichmentAsync,
} from './runner';

export class ExistingDramaStartError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Serializes starts on this process; the runner owns the subsequent lease. */
const starting = new Set<string>();

export async function startExistingDrama(
  videoId: string,
  options: DramaRequestOptions,
): Promise<{ job_id: string; video_id: string; run_id: string | null }> {
  if (starting.has(videoId)) {
    throw new ExistingDramaStartError('DRAMA_RUN_ACTIVE', 409, 'Drama enrichment is already starting');
  }
  starting.add(videoId);
  try {
    const asset = await getAsset(videoId);
    if (!asset) {
      throw new ExistingDramaStartError('LIBRARY_NOT_FOUND', 404, 'Video not found');
    }
    if (asset.status !== 'ready') {
      throw new ExistingDramaStartError('DRAMA_NOT_READY', 409, 'Video must be ready before drama enrichment');
    }
    const drama = (asset.meta as { drama?: unknown } | undefined)?.drama;
    if (drama) {
      throw new ExistingDramaStartError(
        'DRAMA_ALREADY_REQUESTED',
        409,
        'Drama enrichment was already requested for this video; use its retry action if needed',
      );
    }
    if (isDramaRunActive(videoId)) {
      throw new ExistingDramaStartError('DRAMA_RUN_ACTIVE', 409, 'Drama enrichment is already running');
    }
    if (!asset.media_path || !fs.existsSync(asset.media_path) || !fs.statSync(asset.media_path).isFile()) {
      throw new ExistingDramaStartError(
        'DRAMA_MEDIA_UNAVAILABLE',
        409,
        'The original video file is not available to this server',
      );
    }
    assertDramaDurationAllowed(asset.duration_ms);
    const jobId = asset.job?.job_id;
    const job = jobId ? await resolveIngestJob(jobId) : null;
    if (!job || job.videoId !== videoId || job.status !== 'ready') {
      throw new ExistingDramaStartError(
        'DRAMA_JOB_UNAVAILABLE',
        409,
        'This video has no recoverable ready job',
      );
    }
    const previousDrama = job.drama;
    job.drama = initialDramaJobState(options);
    let runId: string | null = null;
    try {
      // Durable marker before responding: a restart leaves a retryable run.
      const ws = await prepareDramaHandoff(job);
      runId = ws.runId;
    } catch (err) {
      job.drama = previousDrama;
      throw err;
    }
    startDramaEnrichmentAsync(job);
    return { job_id: job.id, video_id: videoId, run_id: runId };
  } finally {
    starting.delete(videoId);
  }
}
