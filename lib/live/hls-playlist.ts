import {
  hostMatchesAllowlist,
  isResolvedIpPermitted,
  LiveSourcePolicyError,
  type LiveAllowPolicy,
  type ResolveAddressesFn,
  validateLiveDestination,
} from './source-policy';
import { parseLiveSourceUrl, LiveSourceUrlError } from './source-url';

export type HlsFetchFn = (
  url: string,
  init?: {
    redirect?: 'manual' | 'error' | 'follow';
    signal?: AbortSignal;
    headers?: Record<string, string>;
  },
) => Promise<{
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
  url: string;
}>;

const DEFAULT_MAX_REDIRECTS = 5;
const DEFAULT_MAX_BYTES = 1_048_576;

/**
 * Extract playlist / segment / encryption-key URIs from an HLS playlist body.
 * Relative URIs are resolved against `baseUrl`.
 */
export function extractHlsReferencedUris(
  playlistText: string,
  baseUrl: string,
): string[] {
  const out: string[] = [];
  const base = new URL(baseUrl);
  for (const raw of playlistText.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) {
      const keyMatch = /URI="([^"]+)"/i.exec(line);
      if (
        keyMatch?.[1] &&
        (/^#EXT-X-KEY:/i.test(line) ||
          /^#EXT-X-MAP:/i.test(line) ||
          /^#EXT-X-MEDIA:/i.test(line) ||
          /^#EXT-X-SESSION-KEY:/i.test(line))
      ) {
        out.push(new URL(keyMatch[1], base).toString());
      }
      continue;
    }
    out.push(new URL(line, base).toString());
  }
  return [...new Set(out)];
}

/**
 * Follow redirects manually and re-validate every hop against the allow policy.
 * Fail closed on cross-origin / non-allowlisted destinations.
 */
export async function fetchWithRedirectRevalidation(
  startUrl: string,
  policy: LiveAllowPolicy,
  options: {
    fetchFn?: HlsFetchFn;
    resolveFn?: ResolveAddressesFn;
    maxRedirects?: number;
    maxBytes?: number;
    /** Optional Basic credentials for the private playlist preflight only. */
    username?: string;
    password?: string;
  } = {},
): Promise<{ finalUrl: string; body: string; hops: string[] }> {
  const fetchFn = options.fetchFn ?? defaultFetch;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const hops: string[] = [];
  let current = startUrl;
  let authOrigin: string | null = null;
  try {
    authOrigin = new URL(startUrl).origin;
  } catch {
    authOrigin = null;
  }

  for (let i = 0; i <= maxRedirects; i++) {
    const destination = await validateLiveDestination(
      current,
      policy,
      options.resolveFn,
    );
    // Use credential-free bind URL for the actual fetch target.
    const requestUrl = destination.bindUrl;
    hops.push(destination.parsed.redactedOriginPath);

    const headers: Record<string, string> = {};
    if (
      (options.username || options.password) &&
      authOrigin &&
      sameHttpOrigin(current, authOrigin)
    ) {
      const token = Buffer.from(
        `${options.username ?? ''}:${options.password ?? ''}`,
        'utf8',
      ).toString('base64');
      headers.Authorization = `Basic ${token}`;
    }

    const res = await fetchFn(requestUrl, {
      redirect: 'manual',
      headers: Object.keys(headers).length ? headers : undefined,
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) {
        throw new LiveSourcePolicyError(
          'HLS redirect missing Location header',
          'LIVE_HLS_REDIRECT_INVALID',
        );
      }
      let next: URL;
      try {
        next = new URL(location, requestUrl);
      } catch {
        throw new LiveSourcePolicyError(
          'HLS redirect Location is not a valid URL',
          'LIVE_HLS_REDIRECT_INVALID',
        );
      }
      if (next.protocol !== 'http:' && next.protocol !== 'https:') {
        throw new LiveSourcePolicyError(
          `HLS redirect scheme "${next.protocol}" is forbidden`,
          'LIVE_HLS_REDIRECT_DENIED',
        );
      }
      // Drop credentials on cross-origin redirects (safe redirect behavior).
      if (authOrigin && next.origin !== authOrigin) {
        authOrigin = null;
      }
      current = next.toString();
      continue;
    }
    if (res.status < 200 || res.status >= 300) {
      throw new LiveSourcePolicyError(
        `HLS playlist fetch failed with status ${res.status}`,
        'LIVE_HLS_PLAYLIST_FETCH_FAILED',
      );
    }
    const body = await res.text();
    if (body.length > maxBytes) {
      throw new LiveSourcePolicyError(
        `HLS playlist exceeds ${maxBytes} bytes`,
        'LIVE_HLS_PLAYLIST_TOO_LARGE',
      );
    }
    return { finalUrl: requestUrl, body, hops };
  }

  throw new LiveSourcePolicyError(
    `HLS redirect limit (${maxRedirects}) exceeded`,
    'LIVE_HLS_REDIRECT_LIMIT',
  );
}

function sameHttpOrigin(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

/**
 * Re-validate playlist, segment, and encryption-key destinations against policy.
 * Returns the bind URL that FFmpeg should open (literal IP, credential-free).
 */
export async function revalidateHlsPlaylistGraph(
  playlistUrl: string,
  policy: LiveAllowPolicy,
  options: {
    fetchFn?: HlsFetchFn;
    resolveFn?: ResolveAddressesFn;
    maxRedirects?: number;
    /** When false, only validate the playlist URL (unit/offline). Default true. */
    fetchPlaylist?: boolean;
    username?: string;
    password?: string;
  } = {},
): Promise<{
  bindPlaylistUrl: string;
  hops: string[];
  referencedHosts: string[];
}> {
  const fetchPlaylist = options.fetchPlaylist !== false;
  if (!fetchPlaylist) {
    const destination = await validateLiveDestination(
      playlistUrl,
      policy,
      options.resolveFn,
    );
    return {
      bindPlaylistUrl: destination.bindUrl,
      hops: [destination.parsed.redactedOriginPath],
      referencedHosts: [destination.allowedHost],
    };
  }

  const { finalUrl, body, hops } = await fetchWithRedirectRevalidation(
    playlistUrl,
    policy,
    options,
  );

  const referenced = extractHlsReferencedUris(body, finalUrl);
  const referencedHosts: string[] = [];
  for (const uri of referenced) {
    let parsed;
    try {
      parsed = parseLiveSourceUrl(uri);
    } catch (err) {
      if (err instanceof LiveSourceUrlError) {
        throw new LiveSourcePolicyError(
          `HLS referenced URI rejected: ${err.message}`,
          err.code,
        );
      }
      throw err;
    }
    if (parsed.scheme !== 'hls') {
      throw new LiveSourcePolicyError(
        `HLS referenced URI scheme must be http(s) (got ${parsed.scheme})`,
        'LIVE_HLS_REF_SCHEME_DENIED',
      );
    }
    if (!policy.ports.has(parsed.port)) {
      throw new LiveSourcePolicyError(
        `HLS referenced port ${parsed.port} is not in LIVE_ALLOWED_PORTS`,
        'LIVE_SOURCE_PORT_DENIED',
      );
    }
    if (!hostMatchesAllowlist(parsed.hostname, policy.hosts)) {
      throw new LiveSourcePolicyError(
        `HLS referenced host "${parsed.hostname}" is not in LIVE_ALLOWED_HOSTS`,
        'LIVE_SOURCE_HOST_DENIED',
      );
    }
    const resolveFn = options.resolveFn;
    if (resolveFn) {
      const addrs = await resolveFn(parsed.hostname);
      for (const ip of addrs) {
        if (!isResolvedIpPermitted(ip, parsed.hostname, policy)) {
          throw new LiveSourcePolicyError(
            `HLS referenced address ${ip} is not permitted`,
            'LIVE_SOURCE_DNS_REBINDING',
          );
        }
      }
    }
    referencedHosts.push(parsed.hostname);
  }

  return {
    bindPlaylistUrl: finalUrl,
    hops,
    referencedHosts: [...new Set(referencedHosts)],
  };
}

async function defaultFetch(
  url: string,
  init?: {
    redirect?: 'manual' | 'error' | 'follow';
    signal?: AbortSignal;
    headers?: Record<string, string>;
  },
): Promise<{
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
  url: string;
}> {
  const res = await fetch(url, {
    redirect: init?.redirect ?? 'manual',
    signal: init?.signal,
    headers: init?.headers,
  });
  return {
    status: res.status,
    headers: res.headers,
    text: () => res.text(),
    url: res.url,
  };
}
