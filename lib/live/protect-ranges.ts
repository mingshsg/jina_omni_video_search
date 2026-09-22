import { createHash, randomBytes } from 'node:crypto';
import type { LiveProtectRangeDocument } from './types';

/**
 * A-20 protect/keep helpers — absolute UTC ranges; age-delete skips matches.
 * Matching key is an ISO timestamp (chunk `window_end_at` or event `@timestamp`).
 */

export function mintProtectRangeId(): string {
  const token = randomBytes(12).toString('hex');
  return `lpr_${token}`;
}

export function assertValidProtectRangeBounds(
  startAt: string,
  endAt: string,
): { startMs: number; endMs: number } {
  const startMs = Date.parse(startAt);
  const endMs = Date.parse(endAt);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    throw new Error('Protect range start_at/end_at must be valid ISO-8601 UTC');
  }
  if (endMs < startMs) {
    throw new Error('Protect range end_at must be >= start_at');
  }
  return { startMs, endMs };
}

/**
 * True when `utcIso` falls inside the range (inclusive) and optional session
 * scope matches. Session-scoped ranges only protect that session; global
 * ranges (no session_id) protect all sessions.
 */
export function isTimestampProtected(
  utcIso: string,
  ranges: readonly LiveProtectRangeDocument[],
  sessionId?: string,
): boolean {
  const ts = Date.parse(utcIso);
  if (!Number.isFinite(ts)) return false;
  for (const range of ranges) {
    if (range.session_id && sessionId && range.session_id !== sessionId) {
      continue;
    }
    if (range.session_id && !sessionId) {
      continue;
    }
    const startMs = Date.parse(range.start_at);
    const endMs = Date.parse(range.end_at);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;
    if (ts >= startMs && ts <= endMs) return true;
  }
  return false;
}

/** Stable fingerprint for audit / idempotent create helpers. */
export function protectRangeFingerprint(
  doc: Pick<LiveProtectRangeDocument, 'start_at' | 'end_at' | 'session_id'>,
): string {
  return createHash('sha256')
    .update(
      `protect\0${doc.start_at}\0${doc.end_at}\0${doc.session_id ?? ''}`,
    )
    .digest('hex')
    .slice(0, 24);
}

export function publicProtectRangeView(
  doc: LiveProtectRangeDocument,
): Record<string, unknown> {
  return {
    range_id: doc.range_id,
    start_at: doc.start_at,
    end_at: doc.end_at,
    session_id: doc.session_id ?? null,
    note: doc.note ?? null,
    created_at: doc.created_at,
    updated_at: doc.updated_at,
  };
}
