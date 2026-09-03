import { createHash } from 'node:crypto';

export interface UrlProvenance {
  /** Safe origin + pathname only — no userinfo, query, or fragment (FR-22). */
  source_origin_path: string;
  /** SHA-256 hex digest of the raw submitted reference. */
  source_fingerprint: string;
}

/**
 * Sanitize URL provenance for storage and display (FR-22).
 * Strips userinfo, query, and fragment; never returns credentials.
 */
export function sanitizeUrlProvenance(rawUrl: string): UrlProvenance {
  const url = new URL(rawUrl.trim());
  const port =
    (url.protocol === 'https:' && url.port === '443') ||
    (url.protocol === 'http:' && url.port === '80') ||
    url.port === ''
      ? ''
      : `:${url.port}`;
  const source_origin_path = `${url.protocol}//${url.hostname}${port}${url.pathname}`;
  const source_fingerprint = createHash('sha256')
    .update(rawUrl.trim())
    .digest('hex');
  return { source_origin_path, source_fingerprint };
}

/** Whether a response may include the raw URL (default: never). */
export function isRawUrlClientSafe(_rawUrl: string): boolean {
  return false;
}
