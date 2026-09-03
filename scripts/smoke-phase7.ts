/**
 * Phase 7 smoke: tiny ffmpeg clip → estimate → full pipeline (ES + embed).
 * Usage: yarn tsx scripts/smoke-phase7.ts
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { loadDotenv } from './load-dotenv';

loadDotenv();

async function main(): Promise<void> {
  const { getConfig } = await import('../lib/config');
  const { createIngestJob } = await import('../lib/ingest/job-store');
  const { prepareJobEstimate, runIngestPipeline } = await import(
    '../lib/ingest/pipeline'
  );
  const { chunkingFromConfig } = await import('../lib/ingest/variant');
  const { probeVideo } = await import('../lib/video/probe');

  const cfg = getConfig();
  const dir =
    cfg.LOCAL_IMPORT_ROOT ??
    path.resolve(cfg.MEDIA_ROOT, 'originals');
  fs.mkdirSync(dir, { recursive: true });
  const videoPath = path.join(dir, 'phase7-smoke.mp4');
  const mode = cfg.LOCAL_IMPORT_ROOT ? 'local' : 'upload';
  const r = spawnSync(
    'ffmpeg',
    [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=320x240:rate=1',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:sample_rate=16000',
      '-t',
      '5',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-shortest',
      videoPath,
    ],
    { encoding: 'utf8' },
  );
  if (r.status !== 0) {
    console.error(r.stderr?.slice(-800));
    process.exit(1);
  }

  const probe = await probeVideo(videoPath);
  const job = createIngestJob({
    mode: mode as 'local' | 'upload',
    mediaPath: videoPath,
    probe,
    title: 'phase7-smoke',
    autoStart: true,
    chunking: chunkingFromConfig(cfg),
  });
  await prepareJobEstimate(job);
  console.log(
    JSON.stringify({
      smoke: 'estimate_ok',
      job_id: job.id,
      video_id: job.videoId,
      workload: job.workload,
      variant_id: job.variantId,
    }),
  );

  const t0 = Date.now();
  await runIngestPipeline(job);
  console.log(
    JSON.stringify({
      smoke: 'pipeline_done',
      status: job.status,
      stage: job.stage,
      windows_done: job.windowsDone,
      windows_failed: job.windowsFailed,
      throughput: job.throughputWindowsPerMin,
      elapsed_ms: Date.now() - t0,
      error: job.error ?? null,
    }),
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
