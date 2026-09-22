import type { LiveConfig } from '../config';
import { getLiveConfig } from '../config';
import type { LiveConnectionSecret } from '../connection-ref';
import { LiveConnectionRefError } from '../connection-ref';
import type { ResolveAddressesFn } from '../source-policy';
import type { LiveSourceAdapter, ValidatedConnectDescriptor } from '../source-adapter';
import type { LiveProtocol, LiveSourceDocument, LiveTransport } from '../types';
import type { HlsFetchFn } from '../hls-playlist';
import type { LiveWorkerCapabilityManifest } from '../worker-manifest';
import { HlsSourceAdapter, validateHlsSecret } from './hls';
import { RtspSourceAdapter, validateRtspSecret } from './rtsp';
import { SrtSourceAdapter, validateSrtSecret } from './srt';
import { WhipSourceAdapter, validateWhipSecret } from './whip';
import {
  manifestSupportsHls,
  manifestSupportsSrt,
} from '../worker-capability-probe';

export type { HlsSourceAdapter } from './hls';
export type { SrtSourceAdapter } from './srt';
export type { WhipSourceAdapter } from './whip';
export { HLS_PROTOCOL_WHITELIST } from './hls';
export { SRT_PROTOCOL_WHITELIST } from './srt';

export interface CreateAdapterOptions {
  resolveFn?: ResolveAddressesFn;
  fetchFn?: HlsFetchFn;
  /** HLS: skip playlist network fetch (offline tests). */
  fetchPlaylist?: boolean;
  transport?: LiveTransport;
  /** SRT: require FFmpeg capability (worker path). */
  requireSrtCapability?: boolean;
  srtCapable?: boolean;
  /** HLS: require FFmpeg http(s)+hls/mpegts surface (worker path). */
  requireHlsCapability?: boolean;
  hlsCapable?: boolean;
  capabilityManifest?: LiveWorkerCapabilityManifest;
}

/** Protocols the config allowlist currently enables (order preserved). */
export function enabledLiveProtocols(cfg: LiveConfig = getLiveConfig()): LiveProtocol[] {
  const out: LiveProtocol[] = [];
  for (const p of cfg.LIVE_ALLOWED_PROTOCOLS) {
    if (p === 'rtsp' || p === 'hls' || p === 'srt' || p === 'whip') {
      out.push(p);
    }
  }
  return out;
}

export function isLiveProtocolEnabled(
  protocol: LiveProtocol,
  cfg: LiveConfig = getLiveConfig(),
): boolean {
  return cfg.LIVE_ALLOWED_PROTOCOLS.includes(protocol);
}

/**
 * Factory for the shared LiveSourceAdapter boundary.
 * Unknown / disabled protocols fail closed.
 */
export function createLiveSourceAdapter(
  protocol: LiveProtocol,
  cfg: LiveConfig = getLiveConfig(),
  options: CreateAdapterOptions = {},
): LiveSourceAdapter {
  if (!isLiveProtocolEnabled(protocol, cfg)) {
    throw new LiveConnectionRefError(
      `Protocol "${protocol}" is not in LIVE_ALLOWED_PROTOCOLS (fail closed)`,
      'LIVE_SOURCE_PROTOCOL_DENIED',
    );
  }

  switch (protocol) {
    case 'rtsp':
      return new RtspSourceAdapter(cfg, {
        resolveFn: options.resolveFn,
        transport:
          options.transport === 'udp'
            ? 'udp'
            : options.transport === 'tcp'
              ? 'tcp'
              : undefined,
      });
    case 'hls': {
      const hlsCapable =
        options.hlsCapable ??
        (options.capabilityManifest
          ? manifestSupportsHls(options.capabilityManifest)
          : false);
      return new HlsSourceAdapter(cfg, {
        resolveFn: options.resolveFn,
        fetchFn: options.fetchFn,
        fetchPlaylist: options.fetchPlaylist,
        requireCapability: options.requireHlsCapability ?? false,
        hlsCapable,
      });
    }
    case 'srt': {
      const srtCapable =
        options.srtCapable ??
        (options.capabilityManifest
          ? manifestSupportsSrt(options.capabilityManifest)
          : false);
      return new SrtSourceAdapter(cfg, {
        resolveFn: options.resolveFn,
        transport: options.transport,
        requireCapability: options.requireSrtCapability ?? false,
        srtCapable,
      });
    }
    case 'whip':
      return new WhipSourceAdapter(cfg, {
        resolveFn: options.resolveFn,
        transport:
          options.transport === 'udp'
            ? 'udp'
            : options.transport === 'tcp'
              ? 'tcp'
              : undefined,
      });
    default: {
      const _exhaustive: never = protocol;
      throw new LiveConnectionRefError(
        `Unsupported live protocol: ${String(_exhaustive)}`,
        'LIVE_SOURCE_PROTOCOL_DENIED',
      );
    }
  }
}

/** Worker first-time source validation routed by protocol. */
export async function validateLiveSourceSecret(args: {
  source: LiveSourceDocument;
  cfg: LiveConfig;
  secret: LiveConnectionSecret;
  resolveFn?: ResolveAddressesFn;
  fetchFn?: HlsFetchFn;
  fetchPlaylist?: boolean;
  capabilityManifest?: LiveWorkerCapabilityManifest;
}): Promise<{
  endpoint_redacted: string;
  endpoint_fingerprint: string;
  allowed_host: string;
  allowed_port: number;
  descriptor: ValidatedConnectDescriptor;
}> {
  const { source, cfg, secret } = args;
  if (!isLiveProtocolEnabled(source.protocol, cfg)) {
    throw new LiveConnectionRefError(
      `Protocol "${source.protocol}" is not in LIVE_ALLOWED_PROTOCOLS (fail closed)`,
      'LIVE_SOURCE_PROTOCOL_DENIED',
    );
  }

  switch (source.protocol) {
    case 'rtsp':
      return validateRtspSecret(
        source.connection_ref,
        secret,
        cfg,
        args.resolveFn,
      );
    case 'hls': {
      const hlsCapable = args.capabilityManifest
        ? manifestSupportsHls(args.capabilityManifest)
        : false;
      return validateHlsSecret(source.connection_ref, secret, cfg, {
        resolveFn: args.resolveFn,
        fetchFn: args.fetchFn,
        fetchPlaylist: args.fetchPlaylist,
        requireCapability: true,
        hlsCapable,
      });
    }
    case 'srt': {
      const srtCapable = args.capabilityManifest
        ? manifestSupportsSrt(args.capabilityManifest)
        : false;
      return validateSrtSecret(source.connection_ref, secret, cfg, {
        resolveFn: args.resolveFn,
        transport: source.transport,
        requireCapability: true,
        srtCapable,
      });
    }
    case 'whip':
      return validateWhipSecret(
        source.connection_ref,
        secret,
        cfg,
        args.resolveFn,
      );
    default: {
      const _exhaustive: never = source.protocol;
      throw new LiveConnectionRefError(
        `Unsupported live protocol: ${String(_exhaustive)}`,
        'LIVE_SOURCE_PROTOCOL_DENIED',
      );
    }
  }
}

/** Default transports offered per protocol for UI/API hints. */
export function transportsForProtocol(
  protocol: LiveProtocol,
): LiveTransport[] {
  switch (protocol) {
    case 'rtsp':
    case 'whip':
      return ['tcp'];
    case 'hls':
      return ['tcp'];
    case 'srt':
      return ['caller', 'listener'];
    default: {
      const _exhaustive: never = protocol;
      return _exhaustive;
    }
  }
}
