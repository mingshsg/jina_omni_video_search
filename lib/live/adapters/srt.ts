import {
  buildFfmpegConcatInputArgs,
  writeFfmpegInputScript,
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
import type { LiveSourceSnapshot, LiveTransport } from '../types';
import { classifyLiveCaptureExit, classifyLiveFragment } from './shared';

/**
 * Exact nested-protocol whitelist for SRT (architecture contract).
 * Never assemble from user input.
 */
export const SRT_PROTOCOL_WHITELIST = [
  'file',
  'crypto',
  'data',
  'srt',
  'udp',
  'tcp',
  /** Required so FFmpeg can open the private ffconcat input script. */
  'concat',
] as const;

export class SrtSourceAdapter implements LiveSourceAdapter {
  readonly protocol = 'srt' as const;
  private readonly policy: LiveAllowPolicy;
  private readonly resolveFn?: ResolveAddressesFn;
  private readonly peerAllowlist: readonly string[];
  private readonly mode: 'caller' | 'listener';
  private readonly requireCapability: boolean;
  private readonly srtCapable: boolean;

  constructor(
    cfg: LiveConfig = getLiveConfig(),
    options: {
      resolveFn?: ResolveAddressesFn;
      transport?: LiveTransport;
      /** When true (worker default), refuse unless FFmpeg reports srt. */
      requireCapability?: boolean;
      srtCapable?: boolean;
    } = {},
  ) {
    this.policy = buildAllowPolicy(cfg);
    this.resolveFn = options.resolveFn;
    this.peerAllowlist = cfg.LIVE_SRT_PEER_ALLOWLIST;
    const transport = options.transport ?? 'caller';
    this.mode = transport === 'listener' ? 'listener' : 'caller';
    this.requireCapability = options.requireCapability ?? false;
    this.srtCapable = options.srtCapable ?? false;
  }

  async resolve(
    snapshot: LiveSourceSnapshot,
    secret: LiveConnectionSecret,
  ): Promise<ValidatedConnectDescriptor> {
    if (secret.username || secret.password) {
      throw new LiveConnectionRefError(
        'SRT adapter uses passphrase, not username/password',
        'LIVE_SOURCE_CREDENTIAL_UNSUPPORTED',
      );
    }
    if (snapshot.protocol !== 'srt') {
      throw new LiveConnectionRefError(
        `SRT adapter cannot resolve protocol ${snapshot.protocol}`,
      );
    }
    if (!this.policy.protocols.has('srt')) {
      throw new LiveConnectionRefError(
        'SRT is not in LIVE_ALLOWED_PROTOCOLS (fail closed)',
        'LIVE_SOURCE_PROTOCOL_DENIED',
      );
    }
    if (this.requireCapability && !this.srtCapable) {
      throw new LiveConnectionRefError(
        'SRT is disabled: worker FFmpeg capability manifest does not include srt',
        'LIVE_SRT_CAPABILITY_MISSING',
      );
    }

    const mode =
      snapshot.transport === 'listener' || this.mode === 'listener'
        ? 'listener'
        : 'caller';

    if (mode === 'listener' && this.peerAllowlist.length === 0) {
      throw new LiveConnectionRefError(
        'SRT listener requires LIVE_SRT_PEER_ALLOWLIST (gateway/firewall must enforce peers; app cannot observe connected peer identity)',
        'LIVE_SRT_PEER_ADMISSION_REQUIRED',
      );
    }

    const destination = await validateLiveDestination(
      secret.url,
      this.policy,
      this.resolveFn,
    );

    if (destination.parsed.scheme !== 'srt') {
      throw new LiveConnectionRefError(
        'SRT adapter requires an srt:// URL',
        'LIVE_SOURCE_SCHEME_UNSUPPORTED',
      );
    }

    // Listener bind address is already constrained by LIVE_ALLOWED_HOSTS/ports.
    // LIVE_SRT_PEER_ALLOWLIST is an operator gate that remote peer admission is
    // enforced outside this process (MediaMTX/firewall) — do not treat the
    // listener bind IP as the connected peer.

    const endpoint_redacted = destination.parsed.redactedOriginPath;
    const endpoint_fingerprint = fingerprintEndpoint({
      protocol: 'srt',
      transport: mode,
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

    const inputScriptOptions: Record<string, string> = {
      mode,
      latency: '120000',
    };
    if (secret.passphrase) {
      assertSrtPassphrase(secret.passphrase);
      inputScriptOptions.passphrase = secret.passphrase;
    }

    return {
      destination,
      snapshot: {
        ...snapshot,
        protocol: 'srt',
        transport: mode,
        endpoint_fingerprint:
          snapshot.endpoint_fingerprint || endpoint_fingerprint,
        allowed_host: destination.allowedHost,
        allowed_port: destination.allowedPort,
      },
      bindInputUrl: destination.bindUrl,
      authenticatedInputUrl: destination.bindUrl,
      transport: mode,
      endpoint_redacted,
      endpoint_fingerprint:
        snapshot.endpoint_fingerprint || endpoint_fingerprint,
      inputScriptOptions,
    };
  }

  buildFfmpegGlobalArgs(_source: ValidatedConnectDescriptor): readonly string[] {
    return ['-hide_banner', '-loglevel', 'warning'];
  }

  buildFfmpegInput(
    source: ValidatedConnectDescriptor,
    inputScriptPath: string,
  ): readonly string[] {
    writeFfmpegInputScript({
      scriptPath: inputScriptPath,
      inputUrl: source.authenticatedInputUrl,
      options: source.inputScriptOptions ?? {
        mode: source.transport === 'listener' ? 'listener' : 'caller',
        latency: '120000',
      },
    });
    return buildFfmpegConcatInputArgs(
      inputScriptPath,
      SRT_PROTOCOL_WHITELIST.join(','),
    );
  }

  protocolPolicy() {
    return {
      outerScheme: 'srt',
      nestedProtocols: [...SRT_PROTOCOL_WHITELIST],
    };
  }

  classifyFragment(meta: FragmentProbe) {
    return classifyLiveFragment(meta);
  }

  classifyExit(exit: FfmpegExit) {
    return classifyLiveCaptureExit(exit);
  }
}

export async function validateSrtSecret(
  connectionRef: string,
  secret: LiveConnectionSecret,
  cfg: LiveConfig = getLiveConfig(),
  options: {
    resolveFn?: ResolveAddressesFn;
    transport?: LiveTransport;
    requireCapability?: boolean;
    srtCapable?: boolean;
  } = {},
): Promise<{
  endpoint_redacted: string;
  endpoint_fingerprint: string;
  allowed_host: string;
  allowed_port: number;
  descriptor: ValidatedConnectDescriptor;
}> {
  const adapter = new SrtSourceAdapter(cfg, options);
  const provisional: LiveSourceSnapshot = {
    source_revision: 0,
    protocol: 'srt',
    transport: options.transport ?? 'caller',
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

/** libsrt passphrase contract: 10–79 chars, no control characters. */
export function assertSrtPassphrase(passphrase: string): void {
  if (/[\u0000-\u001f\u007f]/.test(passphrase)) {
    throw new LiveConnectionRefError(
      'SRT passphrase must not contain control characters',
      'LIVE_SRT_PASSPHRASE_INVALID',
    );
  }
  if (passphrase.length < 10 || passphrase.length > 79) {
    throw new LiveConnectionRefError(
      'SRT passphrase must be 10–79 characters',
      'LIVE_SRT_PASSPHRASE_INVALID',
    );
  }
}
