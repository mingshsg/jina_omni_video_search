/**
 * Extract ASR-oriented audio (16 kHz mono MP3) via ffmpeg.
 */
import path from 'node:path';
import { runFfmpeg } from '../video/run-ffmpeg';

export async function extractDramaAudio(opts: {
  videoPath: string;
  outMp3Path: string;
}): Promise<string> {
  await runFfmpeg('ffmpeg', [
    '-y',
    '-i',
    opts.videoPath,
    '-vn',
    '-ac',
    '1',
    '-ar',
    '16000',
    '-c:a',
    'libmp3lame',
    '-b:a',
    '32k',
    opts.outMp3Path,
  ]);
  return path.resolve(opts.outMp3Path);
}
