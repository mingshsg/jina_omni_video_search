import fs from 'node:fs';
import path from 'node:path';
import { runFfmpeg } from '../video/run-ffmpeg';
import { assertPathInsideRoot } from './spool-paths';

/**
 * Remux four MPEG-TS fragments into a standalone MP4 with stream copy.
 */
export async function remuxFragmentsToMp4(options: {
  fragmentPaths: readonly string[];
  outputPath: string;
  sessionDir: string;
}): Promise<{ outputPath: string; bytes: number }> {
  for (const p of options.fragmentPaths) {
    assertPathInsideRoot(options.sessionDir, p);
  }
  assertPathInsideRoot(options.sessionDir, options.outputPath);

  const listPath = path.join(
    options.sessionDir,
    'tmp',
    `concat_${Date.now()}.txt`,
  );
  fs.mkdirSync(path.dirname(listPath), { recursive: true });
  const listBody = options.fragmentPaths
    .map((p) => `file '${p.replace(/'/g, `'\\''`)}'`)
    .join('\n');
  fs.writeFileSync(listPath, `${listBody}\n`, 'utf8');

  const tmpOut = `${options.outputPath}.partial.mp4`;
  try {
    await runFfmpeg('ffmpeg', [
      '-nostdin',
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-protocol_whitelist',
      'file,concat',
      '-i',
      listPath,
      '-c',
      'copy',
      '-movflags',
      '+faststart',
      tmpOut,
    ]);
    fs.renameSync(tmpOut, options.outputPath);
  } finally {
    try {
      fs.unlinkSync(listPath);
    } catch {
      // ignore
    }
    try {
      if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut);
    } catch {
      // ignore
    }
  }

  const st = fs.statSync(options.outputPath);
  return { outputPath: options.outputPath, bytes: st.size };
}

/** Probe first/last packet PTS coverage for a media file (ms). */
export async function probePtsCoverageMs(
  mediaPath: string,
): Promise<{ start_pts_ms: number; end_pts_ms: number; duration_ms: number }> {
  const { stdout } = await runFfmpeg('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration:stream=start_time',
    '-select_streams',
    'v:0',
    '-of',
    'json',
    mediaPath,
  ]);
  const json = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: Array<{ start_time?: string }>;
  };
  const durationSec = Number(json.format?.duration ?? 0);
  const startSec = Number(json.streams?.[0]?.start_time ?? 0);
  const start_pts_ms = Math.round(startSec * 1000);
  const duration_ms = Math.round(durationSec * 1000);
  return {
    start_pts_ms,
    end_pts_ms: start_pts_ms + duration_ms,
    duration_ms,
  };
}

/** True when the container has at least one audio stream. */
export async function probeHasAudioStream(mediaPath: string): Promise<boolean> {
  try {
    const { stdout } = await runFfmpeg('ffprobe', [
      '-v',
      'error',
      '-select_streams',
      'a',
      '-show_entries',
      'stream=index',
      '-of',
      'csv=p=0',
      mediaPath,
    ]);
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}
