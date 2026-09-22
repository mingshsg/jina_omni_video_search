import net from 'node:net';

export type LiveParsedScheme = 'rtsp' | 'hls' | 'srt';

export interface LiveParsedSourceUrl {
  scheme: LiveParsedScheme;
  hostname: string;
  port: number;
  pathname: string;
  /**
   * Validated query string including leading `?`, or empty.
   * Kept for private bind/connect URLs (signed tokens / SRT options);
   * never included in public provenance.
   */
  search: string;
  /** Origin + path only; never includes userinfo, query, or fragment. */
  redactedOriginPath: string;
}

export class LiveSourceUrlError extends Error {
  constructor(
    message: string,
    public readonly code: string = 'LIVE_SOURCE_URL_INVALID',
  ) {
    super(message);
    this.name = 'LiveSourceUrlError';
  }
}

const DEFAULT_PORTS: Record<LiveParsedScheme, number> = {
  rtsp: 554,
  hls: 443,
  srt: 8890,
};

/**
 * Structural live source URL parse. Rejects userinfo, credentials-in-URL,
 * control characters, and unsupported schemes.
 */
export function parseLiveSourceUrl(raw: string): LiveParsedSourceUrl {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new LiveSourceUrlError('URL is empty');
  }
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) {
    throw new LiveSourceUrlError('URL contains control characters');
  }
  // Protocol-smuggling / nested schemes
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed.replace(/^[a-z][a-z0-9+.-]*:/i, ''))) {
    // e.g. rtsp://host/file:http://... still ok as path; check for scheme in userinfo-like forms
  }
  if (trimmed.includes('@') && /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    // userinfo is between // and @
    const afterScheme = trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
    if (afterScheme.includes('@')) {
      throw new LiveSourceUrlError(
        'URL must not contain userinfo; use structured credentials',
        'LIVE_SOURCE_USERINFO_FORBIDDEN',
      );
    }
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new LiveSourceUrlError('URL is not parseable');
  }

  if (url.username || url.password) {
    throw new LiveSourceUrlError(
      'URL must not contain userinfo; use structured credentials',
      'LIVE_SOURCE_USERINFO_FORBIDDEN',
    );
  }

  const protocol = url.protocol.replace(/:$/, '').toLowerCase();
  let scheme: LiveParsedScheme;
  if (protocol === 'rtsp') scheme = 'rtsp';
  else if (protocol === 'http' || protocol === 'https' || protocol === 'hls') {
    // HLS playlists are http(s); bare "hls:" is rejected
    if (protocol === 'hls') {
      throw new LiveSourceUrlError(
        'Use http(s) playlist URLs for HLS, not hls://',
      );
    }
    scheme = 'hls';
  } else if (protocol === 'srt') scheme = 'srt';
  else {
    throw new LiveSourceUrlError(
      `Unsupported scheme "${protocol}" (rtsp|http|https|srt)`,
      'LIVE_SOURCE_SCHEME_UNSUPPORTED',
    );
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!hostname) {
    throw new LiveSourceUrlError('URL hostname is required');
  }
  if (hostname.includes(':') && net.isIP(hostname) !== 6) {
    // bracketed IPv6 handled by URL parser; reject oddities
  }

  // Reject nested protocol smuggling in path/query (file:, unix:, pipe:, etc.)
  const lowerFull = trimmed.toLowerCase();
  for (const bad of ['file:', 'unix:', 'pipe:', 'data:', 'gopher:', 'dict:']) {
    if (lowerFull.includes(bad) && !lowerFull.startsWith(bad)) {
      throw new LiveSourceUrlError(
        `Nested protocol "${bad}" is forbidden`,
        'LIVE_SOURCE_PROTOCOL_SMUGGLING',
      );
    }
  }
  if (url.search && /(?:^|[?&])(?:url|redir|redirect|src)=/i.test(url.search)) {
    throw new LiveSourceUrlError(
      'Redirect-style query parameters are forbidden',
      'LIVE_SOURCE_PROTOCOL_SMUGGLING',
    );
  }

  const port =
    url.port !== ''
      ? Number(url.port)
      : scheme === 'hls'
        ? protocol === 'http'
          ? 80
          : 443
        : DEFAULT_PORTS[scheme];

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new LiveSourceUrlError(`Invalid port ${String(url.port)}`);
  }

  const pathname = url.pathname || '/';
  // Preserve query for private connect URLs; strip fragment (never used for live).
  const search = url.search || '';
  if (/[\u0000-\u001f\u007f]/.test(search)) {
    throw new LiveSourceUrlError('URL query contains control characters');
  }
  const portSuffix =
    (scheme === 'hls' &&
      ((protocol === 'https' && port === 443) ||
        (protocol === 'http' && port === 80))) ||
    (scheme === 'rtsp' && port === 554)
      ? ''
      : `:${port}`;

  const displayProtocol =
    scheme === 'hls' ? `${protocol}:` : `${scheme}:`;
  const redactedOriginPath = `${displayProtocol}//${formatHostForUrl(hostname)}${portSuffix}${pathname}`;

  return {
    scheme,
    hostname,
    port,
    pathname,
    search,
    redactedOriginPath,
  };
}

function formatHostForUrl(hostname: string): string {
  if (net.isIP(hostname) === 6) return `[${hostname}]`;
  return hostname;
}

/** Rebuild a credential-free URL for a literal bind address. */
export function rewriteUrlHost(
  parsed: LiveParsedSourceUrl,
  literalHost: string,
  schemeOverride?: string,
): string {
  const scheme =
    schemeOverride ??
    (parsed.scheme === 'hls'
      ? parsed.redactedOriginPath.startsWith('http://')
        ? 'http'
        : 'https'
      : parsed.scheme);
  const host = formatHostForUrl(literalHost);
  return `${scheme}://${host}:${parsed.port}${parsed.pathname}${parsed.search}`;
}
