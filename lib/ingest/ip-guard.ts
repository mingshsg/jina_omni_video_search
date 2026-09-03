import net from 'node:net';

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata.google.internal',
]);

/** Returns true when the address must be rejected for SSRF (private / loopback / link-local). */
export function isBlockedIp(address: string): boolean {
  const v4Mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (v4Mapped) {
    address = v4Mapped[1]!;
  }

  const normalized = normalizeIp(address);
  if (!normalized) return true;

  if (normalized.kind === 'ipv4') {
    const [a, b] = normalized.octets;
    if (a === 0) return true;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }

  if (normalized.kind === 'ipv6') {
    const h = normalized.hextets;
    if (h[7] === 1 && h.slice(0, 7).every((x) => x === 0)) return true; // ::1
    if ((h[0]! & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
    if ((h[0]! & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    if (
      h[0] === 0 &&
      h[1] === 0 &&
      h[2] === 0 &&
      h[3] === 0 &&
      h[4] === 0xffff
    ) {
      return isBlockedIp(
        `${(h[5]! >> 8) & 0xff}.${h[5]! & 0xff}.${(h[6]! >> 8) & 0xff}.${h[6]! & 0xff}`,
      );
    }
    return false;
  }

  return true;
}

export function isBlockedHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase().replace(/\.$/, '');
  if (BLOCKED_HOSTNAMES.has(lower)) return true;
  if (lower.endsWith('.localhost')) return true;
  if (net.isIP(lower)) return isBlockedIp(lower);
  return false;
}

type NormalizedIp =
  | { kind: 'ipv4'; octets: [number, number, number, number] }
  | { kind: 'ipv6'; hextets: number[] };

function normalizeIp(address: string): NormalizedIp | null {
  const ipVersion = net.isIP(address);
  if (ipVersion === 4) {
    const parts = address.split('.').map(Number);
    if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
      return null;
    }
    return { kind: 'ipv4', octets: parts as [number, number, number, number] };
  }
  if (ipVersion === 6) {
    const expanded = expandIpv6(address);
    if (!expanded) return null;
    return { kind: 'ipv6', hextets: expanded };
  }
  return null;
}

/** Expand IPv6 to eight 16-bit hextets for range checks. */
export function expandIpv6(address: string): number[] | null {
  let raw = address.toLowerCase();
  if (raw.includes('%')) raw = raw.split('%')[0]!;
  if (raw.includes('.')) {
    const lastColon = raw.lastIndexOf(':');
    if (lastColon < 0) return null;
    const v4 = raw.slice(lastColon + 1);
    if (net.isIP(v4) !== 4) return null;
    const octets = v4.split('.').map(Number);
    const hi = (octets[0]! << 8) | octets[1]!;
    const lo = (octets[2]! << 8) | octets[3]!;
    raw = `${raw.slice(0, lastColon)}:${hi.toString(16)}:${lo.toString(16)}`;
  }

  const [head, tail] = raw.split('::');
  const headParts = head ? head.split(':').filter(Boolean) : [];
  const tailParts = tail !== undefined ? tail.split(':').filter(Boolean) : [];
  const missing = 8 - headParts.length - tailParts.length;
  if (missing < 0) return null;
  const parts = [
    ...headParts,
    ...Array.from({ length: missing }, () => '0'),
    ...tailParts,
  ];
  if (parts.length !== 8) return null;
  const hextets = parts.map((p) => parseInt(p, 16));
  if (hextets.some((h) => !Number.isFinite(h) || h < 0 || h > 0xffff)) return null;
  return hextets;
}
