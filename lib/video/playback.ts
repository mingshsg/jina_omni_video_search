import fs from 'node:fs';
import path from 'node:path';
import type { VideoProbeResult } from './probe';
import { runFfmpeg } from './run-ffmpeg';

/** Codecs commonly unsupported for inline `<video>` playback in browsers. */
const POOR_BROWSER_CODECS = new Set([
  'hevc',
  'h265',
  'vp9',
  'av1',
  'av01',
  'prores',
  'ffv1',
  'mpeg2video',
  'mpeg4',
]);

export interface PlaybackProxyOptions {
  inputPath: string;
  outputPath: string;
  probe: VideoProbeResult;
  maxHeight?: number;
}

export interface PlaybackProxyResult {
  skipped: boolean;
  reason?: string;
  output_path: string;
  encode_ms: number;
  bytes: number;
}

export function needsPlaybackProxy(
  probe: VideoProbeResult,
  maxHeight = 720,
): boolean {
  if (probe.height > maxHeight) return true;
  const codec = probe.video_codec.toLowerCase();
  if (POOR_BROWSER_CODECS.has(codec)) return true;
  if (codec !== 'h264' && codec !== 'avc') return true;
  return false;
}

/**
 * Build a 720p H.264 faststart playback proxy when source exceeds max height
 * or uses a browser-unfriendly codec; otherwise skip (serve original).
 */
export async function encodePlaybackProxy(
  opts: PlaybackProxyOptions,
): Promise<PlaybackProxyResult> {
  const maxHeight = opts.maxHeight ?? 720;

  if (!needsPlaybackProxy(opts.probe, maxHeight)) {
    return {
      skipped: true,
      reason: 'source suitable for direct playback',
      output_path: opts.inputPath,
      encode_ms: 0,
      bytes: opts.probe.size_bytes,
    };
  }

  const started = Date.now();
  fs.mkdirSync(path.dirname(opts.outputPath), { recursive: true });

  await runFfmpeg('ffmpeg', [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    opts.inputPath,
    '-c:v',
    'libx264',
    '-preset',
    'fast',
    '-crf',
    '23',
    '-pix_fmt',
    'yuv420p',
    '-vf',
    `scale=-2:'min(${maxHeight},ih)'`,
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-movflags',
    '+faststart',
    opts.outputPath,
  ]);

  const stat = fs.statSync(opts.outputPath);
  return {
    skipped: false,
    output_path: opts.outputPath,
    encode_ms: Date.now() - started,
    bytes: stat.size,
  };
}
