import { createHash } from 'node:crypto';
import {
  buildAuthenticatedUrl,
  buildFfmpegConcatInputArgs,
  writeRtspFfmpegInputScript,
  type FfmpegExit,
  type FragmentProbe,
  type LiveSourceAdapter,
  type ValidatedConnectDescriptor,
} from '../source-adapter';
import {
  fingerprintEndpoint,
  type LiveConnectionSecret,
  LiveConnectionRefError,
} from '../connection-ref';
import {
  buildAllowPolicy,
  validateLiveDestination,
  type LiveAllowPolicy,
  type ResolveAddressesFn,
} from '../source-policy';
import type { LiveConfig } from '../config';
import { getLiveConfig } from '../config';
import type { LiveSourceSnapshot } from '../types';

/**
 * Exact nested-protocol whitelist for RTSP (architecture contract).
 * Never assemble from user input.
 */
export const RTSP_PROTOCOL_WHITELIST = [
  'file',
  'crypto',
  'data',
  'rtsp',
  'tcp',
  'udp',
  'rtp',
  'http',
  'https',
  'tls',
  /** Required so FFmpeg can open the private ffconcat input script. */
  'concat',
] as const;

/**
 * Canonical RTSP capture ladder constants (fragment encoding owned by adapter).
 * Full HLS temp_file fragment publication lands in Phase 3; Phase 2 uses these
 * input flags for connect/reconnect proofs.
 */
export const RTSP_CAPTURE_VIDEO_ARGS = [
  '-map',
  '0:v:0',
  '-c:v',
  'libx264',
  '-pix_fmt',
  'yuv420p',
  '-vf',
  // Even dims required by libx264; avoid force_original_aspect_ratio odd heights.
  "scale='min(1280,iw)':-2,fps=25",
  '-force_key_frames',
  'expr:gte(t,n_forced*2)',
] as const;

export class RtspSourceAdapter implements LiveSourceAdapter {
  readonly protocol = 'rtsp' as const;
  private readonly policy: LiveAllowPolicy;
  private readonly resolveFn?: ResolveAddressesFn;
  private readonly transport: 'tcp' | 'udp';

  constructor(
    cfg: LiveConfig = getLiveConfig(),
    options: {
      resolveFn?: ResolveAddressesFn;
      transport?: 'tcp' | 'udp';
    } = {},
  ) {
    this.policy = buildAllowPolicy(cfg);
    this.resolveFn = options.resolveFn;
    this.transport = options.transport ?? cfg.LIVE_RTSP_TRANSPORT;
  }

  async resolve(
    snapshot: LiveSourceSnapshot,
    secret: LiveConnectionSecret,
  ): Promise<ValidatedConnectDescriptor> {
    if (secret.passphrase) {
      throw new LiveConnectionRefError(
        'RTSP adapter does not accept passphrase',
        'LIVE_SOURCE_CREDENTIAL_UNSUPPORTED',
      );
    }
    if (snapshot.protocol !== 'rtsp') {
      throw new LiveConnectionRefError(
        `RTSP adapter cannot resolve protocol ${snapshot.protocol}`,
      );
    }

    const destination = await validateLiveDestination(
      secret.url,
      this.policy,
      this.resolveFn,
    );

    if (destination.parsed.scheme !== 'rtsp') {
      throw new LiveConnectionRefError(
        'RTSP adapter requires an rtsp:// URL',
        'LIVE_SOURCE_SCHEME_UNSUPPORTED',
      );
    }

    if (
      destination.allowedHost !== snapshot.allowed_host ||
      destination.allowedPort !== snapshot.allowed_port
    ) {
      // Soft check during first validation — snapshot may be built from this resolve.
    }

    const endpoint_redacted = destination.parsed.redactedOriginPath;
    const endpoint_fingerprint = fingerprintEndpoint({
      protocol: 'rtsp',
      transport: this.transport,
      endpointRedacted: endpoint_redacted,
      allowedHost: destination.allowedHost,
      allowedPort: destination.allowedPort,
      connectionRef: snapshot.connection_ref,
    });

    if (
      snapshot.endpoint_fingerprint &&
      snapshot.endpoint_fingerprint !== endpoint_fingerprint
    ) {
      const err = new Error('Source endpoint fingerprint mismatch');
      (err as Error & { code: string }).code = 'LIVE_SOURCE_CHANGED';
      throw err;
    }

    return {
      destination,
      snapshot: {
        ...snapshot,
        protocol: 'rtsp',
        transport: this.transport,
        endpoint_fingerprint:
          snapshot.endpoint_fingerprint || endpoint_fingerprint,
        allowed_host: destination.allowedHost,
        allowed_port: destination.allowedPort,
      },
      bindInputUrl: destination.bindUrl,
      authenticatedInputUrl: buildAuthenticatedUrl(
        destination.bindUrl,
        secret,
      ),
      transport: this.transport,
      endpoint_redacted,
      endpoint_fingerprint:
        snapshot.endpoint_fingerprint || endpoint_fingerprint,
    };
  }

  buildFfmpegGlobalArgs(_source: ValidatedConnectDescriptor): readonly string[] {
    // RTSP transport/timeout live in the private ffconcat script so they apply
    // to the nested RTSP input opened by the concat demuxer.
    return ['-hide_banner', '-loglevel', 'warning'];
  }

  buildFfmpegInput(
    source: ValidatedConnectDescriptor,
    inputScriptPath: string,
  ): readonly string[] {
    const timeoutRaw = source.inputScriptOptions?.timeout;
    const timeoutUs =
      timeoutRaw !== undefined && Number.isFinite(Number(timeoutRaw))
        ? Number(timeoutRaw)
        : undefined;
    writeRtspFfmpegInputScript({
      scriptPath: inputScriptPath,
      inputUrl: source.authenticatedInputUrl,
      transport: source.transport === 'udp' ? 'udp' : 'tcp',
      timeoutUs,
    });
    return buildFfmpegConcatInputArgs(
      inputScriptPath,
      RTSP_PROTOCOL_WHITELIST.join(','),
    );
  }

  protocolPolicy() {
    return {
      outerScheme: 'rtsp',
      nestedProtocols: [...RTSP_PROTOCOL_WHITELIST],
    };
  }

  classifyFragment(meta: FragmentProbe) {
    if (!meta.codec) {
      return { kind: 'discontinuity' as const, reason: 'missing_codec' };
    }
    const mediaSignature = createHash('sha256')
      .update(
        [
          meta.codec,
          String(meta.width ?? ''),
          String(meta.height ?? ''),
          meta.timeBase ?? '',
          String(meta.hasAudio ?? false),
        ].join('|'),
      )
      .digest('hex');
    return {
      kind: 'fragment' as const,
      durationMs: meta.durationMs ?? 0,
      mediaSignature,
    };
  }

  classifyExit(exit: FfmpegExit): 'retryable' | 'fatal' | 'stopped' {
    // Connect-timeout kills must reconnect even if a stop flag was set incorrectly.
    if (exit.timedOut) return 'retryable';
    if (exit.stopped) return 'stopped';
    if (exit.signal === 'SIGTERM' || exit.signal === 'SIGINT') return 'stopped';
    const tail = exit.stderrTail.toLowerCase();
    if (
      tail.includes('connection refused') ||
      tail.includes('timed out') ||
      tail.includes('timeout') ||
      tail.includes('end of file') ||
      tail.includes('server returned 4') ||
      exit.code === 1
    ) {
      return 'retryable';
    }
    if (exit.code === 0) return 'stopped';
    return 'fatal';
  }
}

/** First-time validation helper used by the worker before snapshot exists. */
export async function validateRtspSecret(
  connectionRef: string,
  secret: LiveConnectionSecret,
  cfg: LiveConfig = getLiveConfig(),
  resolveFn?: ResolveAddressesFn,
): Promise<{
  endpoint_redacted: string;
  endpoint_fingerprint: string;
  allowed_host: string;
  allowed_port: number;
  descriptor: ValidatedConnectDescriptor;
}> {
  const adapter = new RtspSourceAdapter(cfg, { resolveFn });
  const provisional: LiveSourceSnapshot = {
    source_revision: 0,
    protocol: 'rtsp',
    transport: cfg.LIVE_RTSP_TRANSPORT,
    connection_ref: connectionRef,
    endpoint_fingerprint: '',
    allowed_host: '',
    allowed_port: 0,
  };
  const descriptor = await adapter.resolve(provisional, secret);
  return {
    endpoint_redacted: descriptor.endpoint_redacted,
    endpoint_fingerprint: descriptor.endpoint_fingerprint,
    allowed_host: descriptor.destination.allowedHost,
    allowed_port: descriptor.destination.allowedPort,
    descriptor,
  };
}
