import fs from 'node:fs';
import path from 'node:path';
import { runFfmpeg } from './run-ffmpeg';
import { msToFfmpegTime, windowDurationSec } from './types';

export interface ThumbnailOptions {
  inputPath: string;
  outputPath: string;
  startMs: number;
  endMs: number;
  /** Target width in pixels (height scales proportionally). */
  width?: number;
}

export interface ThumbnailResult {
  output_path: string;
  width: number;
  bytes: number;
  encode_ms: number;
}

/**
 * Extract the middle frame of a window as a JPEG thumbnail (~320 px wide).
 */
export async function extractThumbnail(
  opts: ThumbnailOptions,
): Promise<ThumbnailResult> {
  const started = Date.now();
  const targetWidth = opts.width ?? 320;
  const durationSec = windowDurationSec(opts.startMs, opts.endMs);
  const midSec = durationSec / 2;
  const seekMs = opts.startMs + midSec * 1000;

  fs.mkdirSync(path.dirname(opts.outputPath), { recursive: true });

  await runFfmpeg('ffmpeg', [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-ss',
    msToFfmpegTime(seekMs),
    '-i',
    opts.inputPath,
    '-frames:v',
    '1',
    '-vf',
    `scale=${targetWidth}:-2`,
    '-q:v',
    '3',
    opts.outputPath,
  ]);

  const stat = fs.statSync(opts.outputPath);

  const { stdout } = await runFfmpeg('ffprobe', [
    '-v',
    'quiet',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=width',
    '-of',
    'csv=p=0',
    opts.outputPath,
  ]);

  return {
    output_path: opts.outputPath,
    width: Number(stdout.trim()) || targetWidth,
    bytes: stat.size,
    encode_ms: Date.now() - started,
  };
}
