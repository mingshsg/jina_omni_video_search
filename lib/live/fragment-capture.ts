import type { ValidatedConnectDescriptor } from './source-adapter';
import {
  buildFfmpegConcatInputArgs,
  writeRtspFfmpegInputScript,
} from './source-adapter';
import {
  RTSP_CAPTURE_VIDEO_ARGS,
  RTSP_PROTOCOL_WHITELIST,
} from './adapters/rtsp';

/**
 * Canonical live fragment capture argv (HLS muxer + temp_file atomic publish).
 * Output ladder is shared across adapters; input argv comes from the active
 * LiveSourceAdapter (defaults to RTSP for backward-compatible callers).
 *
 * Credentials are written to a mode-0600 ffconcat script; FFmpeg argv only
 * references that script path (no URL userinfo).
 */
export function buildFragmentCaptureArgs(options: {
  source: ValidatedConnectDescriptor;
  /** Absolute path to the private ffconcat input script (0600). */
  inputScriptPath: string;
  /** Absolute path pattern e.g. /spool/fragments/e1/frag_%06d.ts */
  segmentFilenamePattern: string;
  /** Absolute playlist path e.g. /spool/fragments/e1/live.m3u8 */
  playlistPath: string;
  fragmentSeconds?: number;
  includeAudio?: boolean;
  loglevel?: 'quiet' | 'error' | 'warning' | 'info';
  /**
   * HLS segment start number for this capture epoch (default 0).
   * Each reconnect epoch should use an isolated directory + its own start.
   */
  startNumber?: number;
  /**
   * Bound HLS playlist size (A-10). Default keeps a small working set;
   * pass 0 only for deliberate unbounded fixture probes.
   */
  hlsListSize?: number;
  /** RTSP socket I/O timeout in microseconds (A-17 → LIVE_READ_TIMEOUT_MS). */
  readTimeoutUs?: number;
  /**
   * Protocol-specific input argv from `adapter.buildFfmpegInput(...)`.
   * When omitted, RTSP concat input is written (Phases 1–9 callers).
   */
  inputArgs?: readonly string[];
}): string[] {
  const fragmentSeconds = options.fragmentSeconds ?? 2;
  const startNumber = options.startNumber ?? 0;
  const hlsListSize = options.hlsListSize ?? 8;

  let inputArgs: readonly string[];
  if (options.inputArgs) {
    inputArgs = options.inputArgs;
  } else {
    writeRtspFfmpegInputScript({
      scriptPath: options.inputScriptPath,
      inputUrl: options.source.authenticatedInputUrl,
      transport: options.source.transport === 'udp' ? 'udp' : 'tcp',
      timeoutUs: options.readTimeoutUs,
    });
    inputArgs = buildFfmpegConcatInputArgs(
      options.inputScriptPath,
      RTSP_PROTOCOL_WHITELIST.join(','),
    );
  }

  const args: string[] = [
    '-nostdin',
    '-hide_banner',
    '-loglevel',
    options.loglevel ?? 'warning',
    ...inputArgs,
    ...RTSP_CAPTURE_VIDEO_ARGS,
    '-preset',
    'veryfast',
    '-tune',
    'zerolatency',
    '-sc_threshold',
    '0',
    '-g',
    '50',
  ];

  if (options.includeAudio === false) {
    args.push('-an');
  } else {
    // Prefer optional audio; if mapping fails FFmpeg exits — spike/tests may set includeAudio=false.
    args.push('-map', '0:a:0?', '-c:a', 'aac', '-ac', '1', '-ar', '16000', '-b:a', '48k');
  }

  args.push(
    '-f',
    'hls',
    '-hls_segment_type',
    'mpegts',
    '-hls_time',
    String(fragmentSeconds),
    '-hls_list_size',
    String(hlsListSize),
    '-start_number',
    String(startNumber),
    '-hls_flags',
    'temp_file+independent_segments+program_date_time+omit_endlist',
    '-hls_segment_filename',
    options.segmentFilenamePattern,
    options.playlistPath,
  );

  return args;
}

export interface PlaylistSegment {
  uri: string;
  durationSec: number;
  programDateTime?: string;
}

/** Parse HLS media playlist for finalized segment entries. */
export function parseHlsMediaPlaylist(text: string): PlaylistSegment[] {
  const lines = text.split(/\r?\n/);
  const segments: PlaylistSegment[] = [];
  let pendingDuration: number | null = null;
  let pendingPdt: string | undefined;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#EXTINF:')) {
      const n = Number(line.slice('#EXTINF:'.length).split(',')[0]);
      pendingDuration = Number.isFinite(n) ? n : null;
      continue;
    }
    if (line.startsWith('#EXT-X-PROGRAM-DATE-TIME:')) {
      pendingPdt = line.slice('#EXT-X-PROGRAM-DATE-TIME:'.length).trim();
      continue;
    }
    if (line.startsWith('#')) continue;
    if (pendingDuration === null) continue;
    segments.push({
      uri: line,
      durationSec: pendingDuration,
      programDateTime: pendingPdt,
    });
    pendingDuration = null;
    pendingPdt = undefined;
  }
  return segments;
}
