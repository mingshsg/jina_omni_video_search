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
import { RTSP_PROTOCOL_WHITELIST } from './rtsp';
import { classifyLiveCaptureExit, classifyLiveFragment } from './shared';

/**
 * WHIP (RFC 9725) terminates at MediaMTX. The worker never speaks WHIP/WebRTC;
 * it consumes the gateway's internal RTSP path after browser/encoder publish.
 *
 * Secret URL must be the internal subscribe URL (`rtsp://…`), not the WHIP
 * POST endpoint. Publish credentials stay in MediaMTX / ops config.
 */
export class WhipSourceAdapter implements LiveSourceAdapter {
  readonly protocol = 'whip' as const;
  private readonly policy: LiveAllowPolicy;
  private readonly whipEnabled: boolean;
  private readonly resolveFn?: ResolveAddressesFn;
  private readonly transport: 'tcp' | 'udp';

  constructor(
    cfg: LiveConfig = getLiveConfig(),
    options: {
      resolveFn?: ResolveAddressesFn;
      transport?: 'tcp' | 'udp';
    } = {},
  ) {
    const base = buildAllowPolicy(cfg);
    this.whipEnabled = base.protocols.has('whip');
    // Subscribe path is RTSP — allow rtsp destination checks even when only
    // `whip` is listed in LIVE_ALLOWED_PROTOCOLS.
    this.policy = {
      ...base,
      protocols: new Set([...base.protocols, 'rtsp']),
    };
    this.resolveFn = options.resolveFn;
    this.transport = options.transport ?? cfg.LIVE_RTSP_TRANSPORT;
  }

  async resolve(
    snapshot: LiveSourceSnapshot,
    secret: LiveConnectionSecret,
  ): Promise<ValidatedConnectDescriptor> {
    if (secret.passphrase) {
      throw new LiveConnectionRefError(
        'WHIP subscribe path does not accept passphrase (use RTSP username/password if needed)',
        'LIVE_SOURCE_CREDENTIAL_UNSUPPORTED',
      );
    }
    if (snapshot.protocol !== 'whip') {
      throw new LiveConnectionRefError(
        `WHIP adapter cannot resolve protocol ${snapshot.protocol}`,
      );
    }
    if (!this.whipEnabled) {
      throw new LiveConnectionRefError(
        'WHIP is not in LIVE_ALLOWED_PROTOCOLS (fail closed)',
        'LIVE_SOURCE_PROTOCOL_DENIED',
      );
    }

    const destination = await validateLiveDestination(
      secret.url,
      this.policy,
      this.resolveFn,
    );

    if (destination.parsed.scheme !== 'rtsp') {
      throw new LiveConnectionRefError(
        'WHIP worker subscribe URL must be rtsp:// (MediaMTX internal path)',
        'LIVE_SOURCE_SCHEME_UNSUPPORTED',
      );
    }

    const endpoint_redacted = destination.parsed.redactedOriginPath;
    const endpoint_fingerprint = fingerprintEndpoint({
      protocol: 'whip',
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
        protocol: 'whip',
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
      outerScheme: 'whip',
      nestedProtocols: [...RTSP_PROTOCOL_WHITELIST],
    };
  }

  classifyFragment(meta: FragmentProbe) {
    return classifyLiveFragment(meta);
  }

  classifyExit(exit: FfmpegExit) {
    return classifyLiveCaptureExit(exit);
  }
}

export async function validateWhipSecret(
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
  const adapter = new WhipSourceAdapter(cfg, { resolveFn });
  const provisional: LiveSourceSnapshot = {
    source_revision: 0,
    protocol: 'whip',
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
