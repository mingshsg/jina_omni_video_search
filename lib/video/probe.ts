import fs from 'node:fs';
import { runFfmpeg } from './run-ffmpeg';

export interface VideoProbeResult {
  duration_ms: number;
  width: number;
  height: number;
  fps: number;
  video_codec: string;
  container: string;
  has_audio: boolean;
  size_bytes: number;
}

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  avg_frame_rate?: string;
}

interface FfprobeFormat {
  duration?: string;
  format_name?: string;
  size?: string;
}

interface FfprobeJson {
  streams?: FfprobeStream[];
  format?: FfprobeFormat;
}

function parseFps(rate?: string): number {
  if (!rate || rate === '0/0') return 0;
  const [num, den] = rate.split('/').map(Number);
  if (!den || !Number.isFinite(num)) return 0;
  return num / den;
}

function pickFps(stream: FfprobeStream): number {
  const avg = parseFps(stream.avg_frame_rate);
  if (avg > 0) return avg;
  return parseFps(stream.r_frame_rate);
}

/**
 * Probe a media file with ffprobe — duration, geometry, fps, codecs, audio.
 */
export async function probeVideo(inputPath: string): Promise<VideoProbeResult> {
  const { stdout } = await runFfmpeg('ffprobe', [
    '-v',
    'quiet',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    inputPath,
  ]);

  let parsed: FfprobeJson;
  try {
    parsed = JSON.parse(stdout) as FfprobeJson;
  } catch {
    throw new Error(`ffprobe returned invalid JSON for ${inputPath}`);
  }

  const videoStream = parsed.streams?.find((s) => s.codec_type === 'video');
  if (!videoStream) {
    throw new Error(`No video stream found in ${inputPath}`);
  }

  const hasAudio = parsed.streams?.some((s) => s.codec_type === 'audio') ?? false;
  const durationSec = Number(parsed.format?.duration ?? 0);
  const stat = fs.statSync(inputPath);

  const container =
    parsed.format?.format_name?.split(',')[0]?.trim() || 'unknown';

  return {
    duration_ms: Math.round(durationSec * 1000),
    width: videoStream.width ?? 0,
    height: videoStream.height ?? 0,
    fps: pickFps(videoStream),
    video_codec: videoStream.codec_name ?? 'unknown',
    container,
    has_audio: hasAudio,
    size_bytes: Number(parsed.format?.size ?? stat.size),
  };
}
