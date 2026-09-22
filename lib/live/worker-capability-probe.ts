import { createHash } from 'node:crypto';
import { runFfmpeg } from '../video/run-ffmpeg';
import type { LiveWorkerCapabilityManifest } from './worker-manifest';
import { emptyWorkerManifest } from './worker-manifest';

/** Collect indented protocol names under Input:/Output: sections. */
function parseProtocolNames(stdout: string): string[] {
  const lines = stdout.split(/\r?\n/);
  const out: string[] = [];
  let inList = false;
  for (const line of lines) {
    if (/^(Input|Output):/.test(line.trim())) {
      inList = true;
      continue;
    }
    if (!inList) continue;
    if (/^[A-Za-z].*:/.test(line) && !/^\s/.test(line)) {
      inList = /^(Input|Output):/.test(line.trim());
      continue;
    }
    const name = line.trim();
    if (name && !name.includes(' ')) out.push(name);
  }
  return out;
}

/** Collect demuxer/muxer names from `ffmpeg -demuxers` (Formats table). */
function parseFormatNames(stdout: string): string[] {
  const out: string[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const m = line.match(/^\s*[D.E\s]{1,4}\s+(\S+)\s+/);
    if (m?.[1] && m[1] !== '---') out.push(m[1]);
  }
  return out;
}

function parseEncoderNames(stdout: string): string[] {
  const out: string[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    // e.g. " V....D libx264 ..."
    const m = line.match(/^\s*[VAS\.]{1,8}\s+(\S+)\s+/);
    if (m?.[1]) out.push(m[1]);
  }
  return out;
}

/**
 * Probe local/worker FFmpeg capabilities for the live worker manifest.
 * FFmpeg 8.x lists RTSP as a demuxer, not under `-protocols`.
 */
export async function probeWorkerCapabilities(options?: {
  imageDigest?: string;
  nodeVersion?: string;
}): Promise<LiveWorkerCapabilityManifest> {
  const base = emptyWorkerManifest(options?.nodeVersion ?? process.version);
  try {
    const version = await runFfmpeg('ffmpeg', ['-version']);
    const versionLine = (version.stdout.split('\n')[0] ?? version.stdout).trim();
    const buildconf = await runFfmpeg('ffmpeg', ['-hide_banner', '-buildconf']);
    const protocolsOut = await runFfmpeg('ffmpeg', [
      '-hide_banner',
      '-protocols',
    ]);
    const demuxersOut = await runFfmpeg('ffmpeg', [
      '-hide_banner',
      '-demuxers',
    ]);
    const encodersOut = await runFfmpeg('ffmpeg', [
      '-hide_banner',
      '-encoders',
    ]);

    const protocols = [...new Set(parseProtocolNames(protocolsOut.stdout))].sort();
    const demuxers = [...new Set(parseFormatNames(demuxersOut.stdout))].sort();
    const encoders = [...new Set(parseEncoderNames(encodersOut.stdout))].sort();

    const capabilities_hash = createHash('sha256')
      .update(
        [
          versionLine,
          buildconf.stdout,
          protocols.join(','),
          demuxers.join(','),
          encoders.join(','),
        ].join('\n'),
      )
      .digest('hex');

    return {
      ...base,
      ffmpeg_version: versionLine,
      ffmpeg_buildconf: buildconf.stdout.trim().slice(0, 4000),
      protocols,
      demuxers,
      encoders,
      image_digest: options?.imageDigest,
      capabilities_hash,
      recorded_at: new Date().toISOString(),
    };
  } catch (err) {
    return {
      ...base,
      recorded_at: new Date().toISOString(),
      image_digest: options?.imageDigest,
      ffmpeg_version: `probe_failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export function hashCapabilities(
  manifest: LiveWorkerCapabilityManifest,
): string {
  return createHash('sha256')
    .update(JSON.stringify(manifest))
    .digest('hex');
}

/** True when the probed surface can open RTSP (demuxer present). */
export function manifestSupportsRtsp(
  manifest: LiveWorkerCapabilityManifest,
): boolean {
  return (manifest.demuxers ?? []).includes('rtsp');
}

/** True when the probed surface can open SRT (protocol or demuxer). */
export function manifestSupportsSrt(
  manifest: LiveWorkerCapabilityManifest,
): boolean {
  const protocols = manifest.protocols ?? [];
  const demuxers = manifest.demuxers ?? [];
  return protocols.includes('srt') || demuxers.includes('srt');
}

/** True when HLS pull is available (http(s) + hls demuxer/mpegts). */
export function manifestSupportsHls(
  manifest: LiveWorkerCapabilityManifest,
): boolean {
  const protocols = manifest.protocols ?? [];
  const demuxers = manifest.demuxers ?? [];
  const hasHttp =
    protocols.includes('http') ||
    protocols.includes('https') ||
    demuxers.includes('hls');
  return hasHttp && (demuxers.includes('hls') || demuxers.includes('mpegts'));
}
