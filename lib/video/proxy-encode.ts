import fs from 'node:fs';
import path from 'node:path';
import type { ProxySettings } from '../ingest/variant';
import { runFfmpeg } from './run-ffmpeg';
import {
  DEFAULT_CRF_LADDER,
  FRAME_REDUCTION_LADDER,
  RESOLUTION_RUNGS,
  ProxyBudgetExhaustedError,
  msToFfmpegTime,
  scaleFilterForLongEdge,
  windowDurationSec,
  type AudioProxyMetadata,
  type ProxyStrategy,
  type VideoProxyMetadata,
} from './types';

export {
  ProxyBudgetExhaustedError,
  type AudioProxyMetadata,
  type VideoProxyMetadata,
} from './types';

export interface EncodeVideoProxyOptions {
  inputPath: string;
  outputPath: string;
  startMs: number;
  endMs: number;
  budgetBytes: number;
  proxySettings?: Partial<ProxySettings>;
}

export interface EncodeAudioProxyOptions {
  inputPath: string;
  outputPath: string;
  startMs: number;
  endMs: number;
  hasAudio: boolean;
}

interface AttemptResult {
  bytes: number;
  width: number;
  height: number;
  crf: number;
  frames: number;
  strategy: ProxyStrategy;
}

async function probeOutputDimensions(
  outputPath: string,
): Promise<{ width: number; height: number }> {
  const { stdout } = await runFfmpeg('ffprobe', [
    '-v',
    'quiet',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=width,height',
    '-of',
    'csv=p=0:s=x',
    outputPath,
  ]);
  const [w, h] = stdout.trim().split('x').map(Number);
  return {
    width: Number.isFinite(w) ? w : 0,
    height: Number.isFinite(h) ? h : 0,
  };
}

async function encodeAttempt(
  opts: EncodeVideoProxyOptions,
  longEdge: number,
  crf: number,
  frames: number,
): Promise<AttemptResult> {
  const durationSec = windowDurationSec(opts.startMs, opts.endMs);
  if (durationSec <= 0) {
    throw new Error('Window duration must be positive');
  }

  const fps = frames / durationSec;
  const scale = scaleFilterForLongEdge(longEdge);
  const vf = `${scale},fps=${fps}`;

  fs.mkdirSync(path.dirname(opts.outputPath), { recursive: true });

  await runFfmpeg('ffmpeg', [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-ss',
    msToFfmpegTime(opts.startMs),
    '-i',
    opts.inputPath,
    '-t',
    durationSec.toFixed(3),
    '-an',
    '-vf',
    vf,
    '-frames:v',
    String(frames),
    '-c:v',
    'libx264',
    '-crf',
    String(crf),
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    opts.outputPath,
  ]);

  const stat = fs.statSync(opts.outputPath);
  const dims = await probeOutputDimensions(opts.outputPath);

  return {
    bytes: stat.size,
    width: dims.width,
    height: dims.height,
    crf,
    frames,
    strategy: 'ladder',
  };
}

function frameCounts(baseFrames: number): number[] {
  const allowed = FRAME_REDUCTION_LADDER as readonly number[];
  const counts = allowed.filter((n) => n <= baseFrames);
  if (!counts.includes(baseFrames)) {
    counts.unshift(baseFrames);
  }
  return [...new Set(counts)].sort((a, b) => b - a);
}

/**
 * Budget-adaptive 32-frame (configurable) visual proxy encoder (FR-8).
 * Resolution outer, CRF inner; terminal frame reduction 32→24→16.
 */
export async function encodeVideoProxy(
  opts: EncodeVideoProxyOptions,
): Promise<VideoProxyMetadata> {
  const started = Date.now();
  const settings = {
    videoFrames: opts.proxySettings?.videoFrames ?? 32,
    crfLadder: opts.proxySettings?.crfLadder ?? DEFAULT_CRF_LADDER,
    resolutionLadder:
      opts.proxySettings?.resolutionLadder ??
      RESOLUTION_RUNGS.map((r) => r.longEdge),
  };

  const tmpPath = `${opts.outputPath}.tmp.mp4`;
  let smallest: AttemptResult | null = null;
  const frameLadder = frameCounts(settings.videoFrames);

  for (const frames of frameLadder) {
    for (const longEdge of settings.resolutionLadder) {
      for (const crf of settings.crfLadder) {
        const result = await encodeAttempt(
          { ...opts, outputPath: tmpPath },
          longEdge,
          crf,
          frames,
        );

        if (!smallest || result.bytes < smallest.bytes) {
          smallest = {
            ...result,
            strategy: frames < settings.videoFrames ? 'frame_reduced' : 'ladder',
          };
        }

        if (result.bytes <= opts.budgetBytes) {
          fs.renameSync(tmpPath, opts.outputPath);
          return {
            bytes: result.bytes,
            width: result.width,
            height: result.height,
            frames: result.frames,
            crf: result.crf,
            strategy: result.strategy,
            ladder_exhausted: false,
            encode_ms: Date.now() - started,
            output_path: opts.outputPath,
          };
        }
      }
    }
  }

  if (fs.existsSync(tmpPath)) {
    fs.unlinkSync(tmpPath);
  }

  throw new ProxyBudgetExhaustedError(
    `Visual proxy exceeds budget ${opts.budgetBytes} B after full ladder ` +
      `(smallest observed ${smallest?.bytes ?? 0} B at ` +
      `${smallest?.width ?? 0}x${smallest?.height ?? 0} CRF${smallest?.crf ?? 0} ` +
      `${smallest?.frames ?? 0} frames)`,
    opts.budgetBytes,
    smallest?.bytes ?? 0,
  );
}

/**
 * 16 kHz mono Opus audio proxy for the same window. Skipped when no audio.
 */
export async function encodeAudioProxy(
  opts: EncodeAudioProxyOptions,
): Promise<AudioProxyMetadata | null> {
  if (!opts.hasAudio) return null;

  const started = Date.now();
  const durationSec = windowDurationSec(opts.startMs, opts.endMs);
  if (durationSec <= 0) {
    throw new Error('Window duration must be positive');
  }

  fs.mkdirSync(path.dirname(opts.outputPath), { recursive: true });

  await runFfmpeg('ffmpeg', [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-ss',
    msToFfmpegTime(opts.startMs),
    '-i',
    opts.inputPath,
    '-t',
    durationSec.toFixed(3),
    '-vn',
    '-ac',
    '1',
    '-ar',
    '16000',
    '-c:a',
    'libopus',
    '-b:a',
    '16k',
    opts.outputPath,
  ]);

  const stat = fs.statSync(opts.outputPath);
  return {
    bytes: stat.size,
    bitrate: '16k',
    codec: 'opus',
    encode_ms: Date.now() - started,
    output_path: opts.outputPath,
  };
}
