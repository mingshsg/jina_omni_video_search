import type {
  LiveSessionDocument,
  LiveSourceDocument,
  LiveWorkerDocument,
} from './types';
import { isTerminalObservedState } from './types';
import {
  LIVE_ERROR_HTTP_STATUS,
  liveErrorMessage,
  type LiveErrorCode,
  type LiveLocale,
} from './errors';

/**
 * Sanitize live API responses — never leak secrets or absolute paths.
 */

const ABS_PATH_RE = /(?:^|[\s"'])(\/(?:Users|home|var|tmp|app|data)\/[^\s"']+)/gi;
const SECRETISH_RE =
  /(password|passwd|secret|token|api[_-]?key|authorization)\s*[:=]\s*\S+/gi;
const PATHISH_RE = /\/(?:Users|home|var|tmp|app|data)\//i;
const SECRET_PROBE_RE =
  /(password|passwd|secret|token|api[_-]?key|authorization)\s*[:=]\s*\S+/i;

export function sanitizeLiveText(input: string): string {
  return input
    .replace(ABS_PATH_RE, '[redacted-path]')
    .replace(SECRETISH_RE, '$1=[redacted]');
}

/** Prefer catalog copy for known codes; never echo raw paths in public views (L2). */
export function publicErrorMessage(
  code: string,
  fallback: string,
  locale: LiveLocale = 'en',
): string {
  if (Object.prototype.hasOwnProperty.call(LIVE_ERROR_HTTP_STATUS, code)) {
    return liveErrorMessage(code as LiveErrorCode, locale);
  }
  // Unknown operational codes: omit path-bearing detail; clients use `code`.
  if (PATHISH_RE.test(fallback) || SECRET_PROBE_RE.test(fallback)) {
    return code;
  }
  return sanitizeLiveText(fallback) || code;
}

export function publicSourceView(
  source: LiveSourceDocument,
  latestSession?: LiveSessionDocument | null,
): Record<string, unknown> {
  return {
    source_id: source.source_id,
    name: source.name,
    protocol: source.protocol,
    source_revision: source.source_revision,
    connection_ref: source.connection_ref,
    transport: source.transport,
    enabled: source.enabled,
    validation_state: source.validation_state,
    endpoint_redacted: source.endpoint_redacted,
    endpoint_fingerprint: source.endpoint_fingerprint,
    allowed_host: source.allowed_host,
    allowed_port: source.allowed_port,
    validation_error: source.validation_error
      ? {
          code: source.validation_error.code,
          message: publicErrorMessage(
            source.validation_error.code,
            source.validation_error.message,
          ),
          at: source.validation_error.at,
        }
      : null,
    active_session_id: source.active_session_id,
    created_at: source.created_at,
    updated_at: source.updated_at,
    latest_session: latestSession
      ? {
          session_id: latestSession.session_id,
          desired_state: latestSession.desired_state,
          observed_state: latestSession.observed_state,
          revision: latestSession.published_revision,
          updated_at: latestSession.timestamps.updated_at,
        }
      : null,
  };
}

export function publicSessionSummary(
  session: LiveSessionDocument,
  workerAvailable: boolean,
): Record<string, unknown> {
  return {
    session_id: session.session_id,
    source_id: session.source_id,
    desired_state: session.desired_state,
    observed_state: session.observed_state,
    revision: session.published_revision,
    stream_epoch: session.stream_epoch,
    last_sequence_no_in_current_epoch:
      session.last_sequence_no_in_current_epoch,
    last_media_at: session.timestamps.last_media_at ?? null,
    last_searchable_at: session.timestamps.last_searchable_at ?? null,
    capture_lag_ms: session.health.capture_lag_ms ?? null,
    processing_lag_ms: session.health.processing_lag_ms ?? null,
    queue_depth: session.health.queue_depth,
    spool_bytes: session.health.spool_bytes,
    windows: {
      searchable: session.health.windows_searchable,
      failed: session.health.windows_failed,
      dropped: session.health.windows_dropped,
    },
    reconnect_count: session.health.reconnect_count,
    current_error: session.current_error
      ? {
          code: session.current_error.code,
          message: publicErrorMessage(
            session.current_error.code,
            session.current_error.message,
          ),
          at: session.current_error.at,
        }
      : null,
    worker_available: workerAvailable,
    variant_id: session.variant_id,
    created_at: session.timestamps.created_at,
    updated_at: session.timestamps.updated_at,
  };
}

export function publicSessionCreateResponse(
  session: LiveSessionDocument,
): Record<string, unknown> {
  return {
    session: {
      session_id: session.session_id,
      source_id: session.source_id,
      desired_state: session.desired_state,
      observed_state: session.observed_state,
      revision: session.published_revision,
      variant_id: session.variant_id,
      created_at: session.timestamps.created_at,
    },
    links: {
      self: `/api/live/sessions/${session.session_id}`,
      events: `/api/live/sessions/${session.session_id}/events`,
    },
  };
}

export function assertNoAbsolutePathsInJson(value: unknown): void {
  const text = JSON.stringify(value);
  if (/\/(?:Users|home|var|tmp|app)\/[^\s"]+/i.test(text)) {
    throw new Error('Response leaked an absolute path');
  }
}

export function workerHeartbeatFresh(
  doc: LiveWorkerDocument | null | undefined,
  staleMs: number,
  nowMs: number = Date.now(),
): boolean {
  if (!doc) return false;
  const t = Date.parse(doc.heartbeat_at);
  if (!Number.isFinite(t)) return false;
  return nowMs - t <= staleMs;
}

export function sessionIsNonterminal(session: LiveSessionDocument): boolean {
  return !isTerminalObservedState(session.observed_state);
}
