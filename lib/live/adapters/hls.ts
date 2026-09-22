import {
  buildAuthenticatedUrl,
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
import type { LiveSourceSnapshot } from '../types';
import { revalidateHlsPlaylistGraph, type HlsFetchFn } from '../hls-playlist';
import { classifyLiveCaptureExit, classifyLiveFragment } from './shared';

/**
 * Exact nested-protocol whitelist for HLS pull (architecture contract).
 * Never assemble from user input.
 */
export const HLS_PROTOCOL_WHITELIST = [
  'file',
  'crypto',
  'data',
  'http',
  'https',
  'tls',
  'tcp',
  'udp',
  /** Required so FFmpeg can open the private ffconcat input script. */
  'concat',
] as const;

export class HlsSourceAdapter implements LiveSourceAdapter {
  readonly protocol = 'hls' as const;
  private readonly policy: LiveAllowPolicy;
  private readonly resolveFn?: ResolveAddressesFn;
  private readonly fetchFn?: HlsFetchFn;
  private readonly fetchPlaylist: boolean;
  private readonly requireCapability: boolean;
  private readonly hlsCapable: boolean;

  constructor(
    cfg: LiveConfig = getLiveConfig(),
    options: {
      resolveFn?: ResolveAddressesFn;
      fetchFn?: HlsFetchFn;
      /** Skip network playlist graph fetch (offline unit tests). Default true. */
      fetchPlaylist?: boolean;
      /** When true (worker default), refuse unless FFmpeg reports HLS surface. */
      requireCapability?: boolean;
      hlsCapable?: boolean;
    } = {},
  ) {
    this.policy = buildAllowPolicy(cfg);
    this.resolveFn = options.resolveFn;
    this.fetchFn = options.fetchFn;
    this.fetchPlaylist = options.fetchPlaylist !== false;
    this.requireCapability = options.requireCapability ?? false;
    this.hlsCapable = options.hlsCapable ?? false;
  }

  async resolve(
    snapshot: LiveSourceSnapshot,
    secret: LiveConnectionSecret,
  ): Promise<ValidatedConnectDescriptor> {
    if (secret.passphrase) {
      throw new LiveConnectionRefError(
        'HLS adapter does not accept passphrase',
        'LIVE_SOURCE_CREDENTIAL_UNSUPPORTED',
      );
    }
    if (snapshot.protocol !== 'hls') {
      throw new LiveConnectionRefError(
        `HLS adapter cannot resolve protocol ${snapshot.protocol}`,
      );
    }
    if (!this.policy.protocols.has('hls')) {
      throw new LiveConnectionRefError(
        'HLS is not in LIVE_ALLOWED_PROTOCOLS (fail closed)',
        'LIVE_SOURCE_PROTOCOL_DENIED',
      );
    }
    if (this.requireCapability && !this.hlsCapable) {
      throw new LiveConnectionRefError(
        'HLS is disabled: worker FFmpeg capability manifest does not include http(s)+hls/mpegts',
        'LIVE_HLS_CAPABILITY_MISSING',
      );
    }

    const graph = await revalidateHlsPlaylistGraph(secret.url, this.policy, {
      resolveFn: this.resolveFn,
      fetchFn: this.fetchFn,
      fetchPlaylist: this.fetchPlaylist,
      username: secret.username,
      password: secret.password,
    });

    // Provenance uses the operator playlist URL; FFmpeg opens the revalidated bind URL.
    const destination = await validateLiveDestination(
      secret.url,
      this.policy,
      this.resolveFn,
    );

    if (destination.parsed.scheme !== 'hls') {
      throw new LiveConnectionRefError(
        'HLS adapter requires an http(s) playlist URL',
        'LIVE_SOURCE_SCHEME_UNSUPPORTED',
      );
    }

    const endpoint_redacted = destination.parsed.redactedOriginPath;
    const endpoint_fingerprint = fingerprintEndpoint({
      protocol: 'hls',
      transport: snapshot.transport,
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
        protocol: 'hls',
        endpoint_fingerprint:
          snapshot.endpoint_fingerprint || endpoint_fingerprint,
        allowed_host: destination.allowedHost,
        allowed_port: destination.allowedPort,
      },
      // FFmpeg opens the revalidated (redirect-final) bind URL.
      bindInputUrl: graph.bindPlaylistUrl,
      authenticatedInputUrl: buildAuthenticatedUrl(
        graph.bindPlaylistUrl,
        secret,
      ),
      transport: snapshot.transport ?? 'tcp',
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
    writeFfmpegInputScript({
      scriptPath: inputScriptPath,
      inputUrl: source.authenticatedInputUrl,
    });
    return buildFfmpegConcatInputArgs(
      inputScriptPath,
      HLS_PROTOCOL_WHITELIST.join(','),
    );
  }

  protocolPolicy() {
    return {
      outerScheme: 'hls',
      nestedProtocols: [...HLS_PROTOCOL_WHITELIST],
    };
  }

  classifyFragment(meta: FragmentProbe) {
    return classifyLiveFragment(meta);
  }

  classifyExit(exit: FfmpegExit) {
    return classifyLiveCaptureExit(exit);
  }
}

/** First-time validation helper used by the worker before snapshot exists. */
export async function validateHlsSecret(
  connectionRef: string,
  secret: LiveConnectionSecret,
  cfg: LiveConfig = getLiveConfig(),
  options: {
    resolveFn?: ResolveAddressesFn;
    fetchFn?: HlsFetchFn;
    fetchPlaylist?: boolean;
    requireCapability?: boolean;
    hlsCapable?: boolean;
  } = {},
): Promise<{
  endpoint_redacted: string;
  endpoint_fingerprint: string;
  allowed_host: string;
  allowed_port: number;
  descriptor: ValidatedConnectDescriptor;
}> {
  const adapter = new HlsSourceAdapter(cfg, options);
  const provisional: LiveSourceSnapshot = {
    source_revision: 0,
    protocol: 'hls',
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
