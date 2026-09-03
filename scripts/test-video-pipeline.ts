/**
 * Phase 5 smoke — generate a tiny test clip and exercise probe / plan /
 * budget-adaptive proxies / thumbnail / playback.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../lib/config';
import { embedBudgetBytes } from '../lib/video/budget';
import { planChunks } from '../lib/video/plan-chunks';
import { encodePlaybackProxy } from '../lib/video/playback';
import { probeVideo } from '../lib/video/probe';
import {
  encodeAudioProxy,
  encodeVideoProxy,
  ProxyBudgetExhaustedError,
} from '../lib/video/proxy-encode';
import { extractThumbnail } from '../lib/video/thumbnail';
import { loadDotenv } from './load-dotenv';

loadDotenv();

function hasFfmpeg(): boolean {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: ['ignore', 'ignore', 'pipe'] });
    return true;
  } catch {
    return false;
  }
}

function generateTestVideo(outPath: string, durationSec: number): void {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      `testsrc=duration=${durationSec}:size=1280x720:rate=24`,
      '-f',
      'lavfi',
      '-i',
      `sine=f=440:duration=${durationSec}`,
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-shortest',
      outPath,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
}

async function main(): Promise<void> {
  if (!hasFfmpeg()) {
    console.error('ffmpeg not found on PATH — skipping smoke test');
    process.exit(1);
  }

  const cfg = loadConfig();
  const budget = embedBudgetBytes(cfg);
  const tmpRoot = path.join(process.cwd(), 'data', 'uploads', 'video-pipeline-smoke');
  const sourcePath = path.join(tmpRoot, 'source.mp4');
  const durationSec = 70;

  console.log('=== Phase 5 video pipeline smoke ===');
  console.log(`Provider: ${cfg.EMBED_PROVIDER}`);
  console.log(`Budget: ${budget} bytes (${(budget / 1024).toFixed(1)} KiB)`);

  generateTestVideo(sourcePath, durationSec);

  const probe = await probeVideo(sourcePath);
  console.log('\n--- probe ---');
  console.log(JSON.stringify(probe, null, 2));

  const windows = planChunks({
    durationMs: probe.duration_ms,
    windowMs: cfg.CHUNK_WINDOW_MS,
    overlapMs: cfg.CHUNK_OVERLAP_MS,
    minMs: cfg.CHUNK_MIN_MS,
  });
  console.log('\n--- plan-chunks ---');
  console.log(`Windows: ${windows.length}`);
  for (const w of windows) {
    console.log(
      `  #${w.chunk_index} ${w.start_ms}-${w.end_ms} ms (${w.end_ms - w.start_ms} ms)`,
    );
  }

  const window = windows[0]!;
  const proxyDir = path.join(tmpRoot, 'proxies');
  const videoOut = path.join(proxyDir, 'w0-video.mp4');
  const audioOut = path.join(proxyDir, 'w0-audio.opus');
  const thumbOut = path.join(tmpRoot, 'thumbs', 'w0.jpg');
  const playbackOut = path.join(tmpRoot, 'playback', '720p.mp4');

  let videoMeta;
  try {
    videoMeta = await encodeVideoProxy({
      inputPath: sourcePath,
      outputPath: videoOut,
      startMs: window.start_ms,
      endMs: window.end_ms,
      budgetBytes: budget,
    });
  } catch (err) {
    if (err instanceof ProxyBudgetExhaustedError) {
      console.error('\n--- video proxy FAILED (ladder exhausted) ---');
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  const audioMeta = await encodeAudioProxy({
    inputPath: sourcePath,
    outputPath: audioOut,
    startMs: window.start_ms,
    endMs: window.end_ms,
    hasAudio: probe.has_audio,
  });

  const thumbMeta = await extractThumbnail({
    inputPath: sourcePath,
    outputPath: thumbOut,
    startMs: window.start_ms,
    endMs: window.end_ms,
  });

  const playbackMeta = await encodePlaybackProxy({
    inputPath: sourcePath,
    outputPath: playbackOut,
    probe,
    maxHeight: cfg.PLAYBACK_MAX_HEIGHT,
  });

  console.log('\n--- video proxy (window 0) ---');
  console.log(JSON.stringify(videoMeta, null, 2));
  console.log(
    `  vs budget: ${videoMeta.bytes} / ${budget} B (${((videoMeta.bytes / budget) * 100).toFixed(1)}%)`,
  );

  console.log('\n--- audio proxy (window 0) ---');
  console.log(JSON.stringify(audioMeta, null, 2));
  if (audioMeta) {
    console.log(
      `  vs budget: ${audioMeta.bytes} / ${budget} B (${((audioMeta.bytes / budget) * 100).toFixed(1)}%)`,
    );
  }

  console.log('\n--- thumbnail ---');
  console.log(JSON.stringify(thumbMeta, null, 2));

  console.log('\n--- playback proxy ---');
  console.log(JSON.stringify(playbackMeta, null, 2));

  const ok =
    videoMeta.bytes <= budget &&
    videoMeta.ladder_exhausted === false &&
    (!audioMeta || audioMeta.bytes <= budget);

  console.log(`\n=== ${ok ? 'PASS' : 'FAIL'} ===`);
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
