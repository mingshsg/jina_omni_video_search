/**
 * Extract JPEG stills at given seconds via ffmpeg (for directors windows).
 */
import fs from 'node:fs';
import path from 'node:path';
import { runFfmpeg } from '../video/run-ffmpeg';

export async function extractStillAtSec(opts: {
  videoPath: string;
  sec: number;
  outPath: string;
  maxLongEdge?: number;
}): Promise<string> {
  const edge = opts.maxLongEdge ?? 640;
  fs.mkdirSync(path.dirname(opts.outPath), { recursive: true });
  await runFfmpeg('ffmpeg', [
    '-y',
    '-ss',
    String(Math.max(0, opts.sec).toFixed(3)),
    '-i',
    opts.videoPath,
    '-frames:v',
    '1',
    '-vf',
    `scale='min(${edge},iw)':-2`,
    '-q:v',
    '5',
    opts.outPath,
  ]);
  return opts.outPath;
}

/** Evenly sample `count` timestamps in [startSec, endSec). */
export function sampleTimestamps(
  startSec: number,
  endSec: number,
  count: number,
): number[] {
  const a = Math.max(0, startSec);
  const b = Math.max(a + 0.5, endSec);
  const n = Math.max(1, count);
  if (n === 1) return [Math.floor((a + b) / 2)];
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = a + ((b - a) * (i + 0.5)) / n;
    out.push(Math.floor(t));
  }
  return out;
}
