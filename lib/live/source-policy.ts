import dns from 'node:dns/promises';
import net from 'node:net';
import {
  isDangerousIp,
  isMetadataIp,
  isMulticastIp,
  ipv4InCidr,
} from '../ingest/ip-guard';
import type { LiveConfig } from './config';
import {
  parseLiveSourceUrl,
  rewriteUrlHost,
  type LiveParsedSourceUrl,
} from './source-url';

export class LiveSourcePolicyError extends Error {
  constructor(
    message: string,
    public readonly code: string = 'LIVE_SOURCE_POLICY_DENIED',
  ) {
    super(message);
    this.name = 'LiveSourcePolicyError';
  }
}

export interface LiveAllowPolicy {
  protocols: ReadonlySet<string>;
  hosts: readonly string[];
  ports: ReadonlySet<number>;
}

export function buildAllowPolicy(cfg: LiveConfig): LiveAllowPolicy {
  return {
    protocols: new Set(cfg.LIVE_ALLOWED_PROTOCOLS.map((p) => p.toLowerCase())),
    hosts: cfg.LIVE_ALLOWED_HOSTS.map((h) => h.toLowerCase()),
    ports: new Set(cfg.LIVE_ALLOWED_PORTS),
  };
}

export function hostMatchesAllowlist(
  hostname: string,
  allowHosts: readonly string[],
): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  for (const entry of allowHosts) {
    const token = entry.toLowerCase().trim();
    if (!token) continue;
    if (token.startsWith('.')) {
      // Leading-dot suffix: subdomains only (not the apex).
      if (host.endsWith(token) && host.length > token.length) return true;
      continue;
    }
    if (token.includes('/')) {
      if (net.isIP(host) === 4 && ipv4InCidr(host, token)) return true;
      continue;
    }
    if (host === token) return true;
  }
  return false;
}

export function ipMatchesAllowlist(
  ip: string,
  allowHosts: readonly string[],
): boolean {
  const address = ip.toLowerCase();
  for (const entry of allowHosts) {
    const token = entry.toLowerCase().trim();
    if (!token || token.startsWith('.')) continue;
    if (token.includes('/')) {
      if (net.isIP(address) === 4 && ipv4InCidr(address, token)) return true;
      continue;
    }
    if (net.isIP(token) && address === token) return true;
  }
  return false;
}

/**
 * Private/loopback destinations require an explicit IP/CIDR allow entry
 * (hostname allow alone is not enough), except localhost-family hosts that
 * resolve only to loopback when those hosts are allowlisted.
 */
export function isResolvedIpPermitted(
  ip: string,
  originalHost: string,
  policy: LiveAllowPolicy,
): boolean {
  if (isMetadataIp(ip) || isMulticastIp(ip)) return false;

  if (ipMatchesAllowlist(ip, policy.hosts)) return true;

  const dangerous = isDangerousIp(ip);
  if (!dangerous) {
    // Public IP: permitted when the original hostname matched allowlist.
    return hostMatchesAllowlist(originalHost, policy.hosts);
  }

  // Dangerous/private: only if original host is localhost-family AND allowlisted.
  const host = originalHost.toLowerCase();
  const localhostFamily =
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '127.0.0.1' ||
    host === '::1';
  if (
    localhostFamily &&
    hostMatchesAllowlist(host, policy.hosts) &&
    (ip === '127.0.0.1' ||
      ip === '::1' ||
      ip.startsWith('127.') ||
      ip === '0:0:0:0:0:0:0:1')
  ) {
    return true;
  }

  // Docker Desktop / Compose host-gateway alias. When explicitly allowlisted,
  // permit private resolutions (e.g. 192.168.65.254) so workers in containers
  // can reach MediaMTX published on the host. Metadata/multicast still denied above.
  if (host === 'host.docker.internal' && hostMatchesAllowlist(host, policy.hosts)) {
    return true;
  }
  return false;
}

export interface ValidatedDestination {
  parsed: LiveParsedSourceUrl;
  resolvedAddresses: string[];
  /** Literal address bound into the FFmpeg URL (DNS-rebinding defense). */
  bindAddress: string;
  /** Credential-free URL using bindAddress. */
  bindUrl: string;
  allowedHost: string;
  allowedPort: number;
}

export type ResolveAddressesFn = (hostname: string) => Promise<string[]>;

async function defaultResolve(hostname: string): Promise<string[]> {
  if (net.isIP(hostname)) return [hostname];
  const results = await dns.lookup(hostname, { all: true, verbatim: true });
  if (!results.length) {
    throw new LiveSourcePolicyError(
      `DNS lookup returned no addresses for ${hostname}`,
      'LIVE_SOURCE_DNS_FAILED',
    );
  }
  return [...new Set(results.map((r) => r.address))];
}

/**
 * Parse + allowlist + DNS validation. Re-run on every reconnect.
 */
export async function validateLiveDestination(
  rawUrl: string,
  policy: LiveAllowPolicy,
  resolveFn: ResolveAddressesFn = defaultResolve,
): Promise<ValidatedDestination> {
  const parsed = parseLiveSourceUrl(rawUrl);

  if (!policy.protocols.has(parsed.scheme)) {
    throw new LiveSourcePolicyError(
      `Protocol "${parsed.scheme}" is not in LIVE_ALLOWED_PROTOCOLS`,
      'LIVE_SOURCE_PROTOCOL_DENIED',
    );
  }
  if (!policy.ports.has(parsed.port)) {
    throw new LiveSourcePolicyError(
      `Port ${parsed.port} is not in LIVE_ALLOWED_PORTS`,
      'LIVE_SOURCE_PORT_DENIED',
    );
  }
  if (!hostMatchesAllowlist(parsed.hostname, policy.hosts)) {
    throw new LiveSourcePolicyError(
      `Host "${parsed.hostname}" is not in LIVE_ALLOWED_HOSTS`,
      'LIVE_SOURCE_HOST_DENIED',
    );
  }

  const resolvedAddresses = await resolveFn(parsed.hostname);
  for (const ip of resolvedAddresses) {
    if (!isResolvedIpPermitted(ip, parsed.hostname, policy)) {
      throw new LiveSourcePolicyError(
        `Resolved address ${ip} is not permitted for host ${parsed.hostname}`,
        'LIVE_SOURCE_DNS_REBINDING',
      );
    }
  }

  const bindAddress =
    resolvedAddresses.find((a) => net.isIP(a) === 4) ??
    resolvedAddresses[0]!;

  return {
    parsed,
    resolvedAddresses,
    bindAddress,
    bindUrl: rewriteUrlHost(parsed, bindAddress),
    allowedHost: parsed.hostname,
    allowedPort: parsed.port,
  };
}
