/**
 * URL safety for operator- and model-supplied links that get persisted or
 * echoed back in API responses (todo/33 R1).
 *
 * AGENTS.md hard invariant #4 forbids secrets in indexed documents and API
 * responses. A URL is an easy way to smuggle one:
 *
 *   https://user:token@example.com/page?api_key=SECRET#frag
 *
 * `meta.reference_urls` and `meta.review.*.source_url` both persist a URL to
 * Elasticsearch `_source` and return it from the editor API, so both need a
 * gate. The previous gates (`isRenderableTraceUrl`, `softHttpUrl`,
 * `softHttpsUrl`) only checked http(s) syntax and length, so all three
 * credential carriers above passed through untouched.
 *
 * Relationship to FR-22 (`lib/ingest/url-sanitize.ts`): that module solves the
 * same problem for *ingest source* URLs and answers it by reducing to
 * origin+path and keeping a SHA-256 fingerprint of the original. This module
 * is deliberately less aggressive on one axis — it keeps the path **and the
 * non-credential query** — because a reference link is meant to be
 * *followed back to the same page*, and some legitimate reference pages are
 * query-addressed (e.g. `…/w/index.php?curid=123`). Dropping the whole query
 * the way FR-22 does would silently retarget those links to a different page.
 * Userinfo and fragment carry no page identity and are always removed.
 */

/**
 * Query parameters removed outright. Deliberately narrow: each name here is
 * one whose value is a credential essentially by definition. A bare `key` is
 * intentionally NOT in this list — it is common as a legitimate lookup
 * parameter, and stripping it would break real reference links for a weak
 * security gain. Query-embedded secrets under an unusual parameter name are
 * therefore still possible; userinfo, the unambiguous case, is always removed.
 */
const CREDENTIAL_QUERY_PARAMS = new Set([
  'api_key',
  'apikey',
  'access_token',
  'auth',
  'authorization',
  'bearer',
  'jwt',
  'passwd',
  'password',
  'pwd',
  'secret',
  'session',
  'sessionid',
  'sid',
  'sig',
  'signature',
  'token',
]);

export interface SanitizeUrlOptions {
  /** Reject anything longer than this, measured on the raw input. */
  maxLength?: number;
  /** When set, only these protocols are allowed. Default http + https. */
  protocols?: readonly string[];
}

/**
 * Returns a storable/renderable form of `raw`, or `null` when it cannot be
 * made safe. Never throws.
 *
 * Guarantees on a non-null result:
 * - protocol is http: or https:
 * - no userinfo (`user:pass@`)
 * - no fragment
 * - no query parameter named in `CREDENTIAL_QUERY_PARAMS`
 * - no ASCII control characters
 */
export function sanitizeExternalUrl(
  raw: unknown,
  options: SanitizeUrlOptions = {},
): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  const maxLength = options.maxLength ?? 2048;
  if (!trimmed || trimmed.length > maxLength) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(trimmed)) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  const protocols = options.protocols ?? ['http:', 'https:'];
  if (!protocols.includes(url.protocol)) return null;

  // Credentials in the authority component — the unambiguous case.
  url.username = '';
  url.password = '';
  // Fragments never identify a different page for provenance purposes.
  url.hash = '';

  for (const name of [...url.searchParams.keys()]) {
    if (CREDENTIAL_QUERY_PARAMS.has(name.toLowerCase())) {
      url.searchParams.delete(name);
    }
  }

  const out = url.toString();
  return out.length > maxLength ? null : out;
}

/** True when `raw` survives sanitization unchanged (i.e. carried nothing unsafe). */
export function isAlreadySafeExternalUrl(
  raw: unknown,
  options: SanitizeUrlOptions = {},
): boolean {
  if (typeof raw !== 'string') return false;
  const sanitized = sanitizeExternalUrl(raw, options);
  return sanitized !== null && sanitized === raw.trim();
}
