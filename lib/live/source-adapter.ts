import fs from 'node:fs';
import path from 'node:path';
import type { LiveProtocol, LiveSourceSnapshot, LiveTransport } from './types';
import type { ValidatedDestination } from './source-policy';
import type { LiveConnectionSecret } from './connection-ref';

export interface FragmentProbe {
  codec?: string;
  width?: number;
  height?: number;
  timeBase?: string;
  hasAudio?: boolean;
  durationMs?: number;
}

export interface FragmentMetadata {
  kind: 'fragment';
  durationMs: number;
  mediaSignature: string;
}

export interface Discontinuity {
  kind: 'discontinuity';
  reason: string;
}

export interface FfmpegExit {
  code: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  stopped: boolean;
  stderrTail: string;
}

export interface ValidatedConnectDescriptor {
  destination: ValidatedDestination;
  snapshot: LiveSourceSnapshot;
  /**
   * Credential-bearing input URL for the private ffconcat script only —
   * never place on FFmpeg argv / never log.
   */
  authenticatedInputUrl: string;
  /** Bind URL without userinfo — safe for diagnostics. */
  bindInputUrl: string;
  transport: LiveTransport;
  /** Safe display provenance. */
  endpoint_redacted: string;
  endpoint_fingerprint: string;
  /**
   * Extra ffconcat `option` lines written only into the private 0600 script
   * (e.g. SRT passphrase / mode). Never logged.
   */
  inputScriptOptions?: Record<string, string>;
}

export interface LiveSourceAdapter {
  readonly protocol: LiveProtocol;
  resolve(
    snapshot: LiveSourceSnapshot,
    secret: LiveConnectionSecret,
  ): Promise<ValidatedConnectDescriptor>;
  /**
   * Build `-i` argv using a 0600 ffconcat script path (credentials stay in the
   * file, not process argv).
   */
  buildFfmpegInput(
    source: ValidatedConnectDescriptor,
    inputScriptPath: string,
  ): readonly string[];
  /** Extra global ffmpeg flags (not input-private RTSP options). */
  buildFfmpegGlobalArgs(source: ValidatedConnectDescriptor): readonly string[];
  protocolPolicy(): {
    outerScheme: string;
    nestedProtocols: readonly string[];
  };
  classifyFragment(
    meta: FragmentProbe,
  ): FragmentMetadata | Discontinuity;
  classifyExit(exit: FfmpegExit): 'retryable' | 'fatal' | 'stopped';
}

export function buildAuthenticatedUrl(
  bindUrl: string,
  secret: LiveConnectionSecret,
): string {
  if (!secret.username && !secret.password) return bindUrl;
  const url = new URL(bindUrl);
  if (secret.username) url.username = secret.username;
  if (secret.password) url.password = secret.password;
  return url.toString();
}

/**
 * Write a mode-0600 ffconcat script so RTSP userinfo never appears in FFmpeg argv.
 * Residual risk: same-UID readers can still open the script file while capture runs.
 */
export function writeRtspFfmpegInputScript(options: {
  scriptPath: string;
  /** May include userinfo — written only to the 0600 script. */
  inputUrl: string;
  transport: 'tcp' | 'udp' | LiveTransport;
  timeoutUs?: number;
}): string {
  const timeoutUs = options.timeoutUs ?? 15_000_000;
  const transport =
    options.transport === 'udp' ? 'udp' : 'tcp';
  return writeFfmpegInputScript({
    scriptPath: options.scriptPath,
    inputUrl: options.inputUrl,
    options: {
      rtsp_transport: transport,
      timeout: String(timeoutUs),
    },
  });
}

/**
 * Generic mode-0600 ffconcat input script (credentials / passphrase stay in file).
 * Rejects control characters / newlines that would inject additional directives.
 */
export function writeFfmpegInputScript(options: {
  scriptPath: string;
  inputUrl: string;
  options?: Record<string, string>;
}): string {
  assertFfconcatSafeToken(options.inputUrl, 'inputUrl');
  const lines = ['ffconcat version 1.0', `file ${options.inputUrl}`];
  if (options.options) {
    for (const [key, value] of Object.entries(options.options)) {
      assertFfconcatSafeToken(key, 'option key');
      assertFfconcatSafeToken(value, `option ${key}`);
      lines.push(`option ${key} ${value}`);
    }
  }
  lines.push('');
  const body = lines.join('\n');
  fs.mkdirSync(path.dirname(options.scriptPath), { recursive: true });
  fs.writeFileSync(options.scriptPath, body, { encoding: 'utf8', mode: 0o600 });
  fs.chmodSync(options.scriptPath, 0o600);
  return options.scriptPath;
}

function assertFfconcatSafeToken(value: string, label: string): void {
  if (/[\r\n\u0000]/.test(value)) {
    throw new Error(
      `ffconcat ${label} must not contain newlines or NUL (directive injection)`,
    );
  }
}

/** Argv fragment: concat demuxer reading a private input script. */
export function buildFfmpegConcatInputArgs(
  scriptPath: string,
  protocolWhitelist: string,
): readonly string[] {
  return [
    '-protocol_whitelist',
    protocolWhitelist,
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    scriptPath,
  ];
}
