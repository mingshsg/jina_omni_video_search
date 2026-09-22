/**
 * Pure live-UI helpers (Phase 8) — no React / browser APIs.
 * Keeps state labels and follow reducers unit-testable without Playwright.
 */

export type LiveObservedStateUi =
  | 'created'
  | 'connecting'
  | 'live'
  | 'degraded'
  | 'stopping'
  | 'stopped'
  | 'failed';

export type LiveValidationStateUi = 'pending_validation' | 'ready' | 'invalid';

export type LiveStateBadgeColor =
  | 'default'
  | 'primary'
  | 'success'
  | 'warning'
  | 'danger'
  | 'accent';

/** Map observed_state to EUI badge color. */
export function liveObservedStateColor(
  state: string,
): LiveStateBadgeColor {
  switch (state) {
    case 'created':
      return 'default';
    case 'connecting':
      return 'primary';
    case 'live':
      return 'success';
    case 'degraded':
      return 'warning';
    case 'stopping':
      return 'accent';
    case 'stopped':
      return 'default';
    case 'failed':
      return 'danger';
    default:
      return 'default';
  }
}

export function liveValidationStateColor(
  state: string,
): LiveStateBadgeColor {
  switch (state) {
    case 'ready':
      return 'success';
    case 'pending_validation':
      return 'warning';
    case 'invalid':
      return 'danger';
    default:
      return 'default';
  }
}

/**
 * UI must never treat a window as searchable until a durable `searchable` event.
 * Counters from session health are authoritative for "windows searchable".
 */
export function canClaimSearchable(args: {
  eventType?: string | null;
  windowsSearchable?: number | null;
}): boolean {
  if (args.eventType === 'searchable') return true;
  if (
    typeof args.windowsSearchable === 'number' &&
    args.windowsSearchable > 0
  ) {
    return true;
  }
  return false;
}

export type FollowUiEvent =
  | { type: 'ready'; expires_at?: string | null }
  | { type: 'results'; hits: unknown[]; reason?: string }
  | { type: 'cursor'; revision?: number }
  | { type: 'heartbeat' }
  | { type: 'error'; code?: string; message?: string };

export type FollowUiState = {
  status: 'idle' | 'following' | 'expired' | 'error';
  hits: unknown[];
  expiresAt: string | null;
  lastReason: string | null;
  errorMessage: string | null;
  resultGeneration: number;
};

export function initialFollowUiState(): FollowUiState {
  return {
    status: 'idle',
    hits: [],
    expiresAt: null,
    lastReason: null,
    errorMessage: null,
    resultGeneration: 0,
  };
}

/** Reduce follow-search SSE frames into UI state. */
export function reduceFollowUiEvent(
  prev: FollowUiState,
  event: FollowUiEvent,
): FollowUiState {
  switch (event.type) {
    case 'ready':
      return {
        ...prev,
        status: 'following',
        expiresAt: event.expires_at ?? prev.expiresAt,
        errorMessage: null,
      };
    case 'results':
      return {
        ...prev,
        status: 'following',
        hits: event.hits,
        lastReason: event.reason ?? prev.lastReason,
        resultGeneration: prev.resultGeneration + 1,
        errorMessage: null,
      };
    case 'cursor':
    case 'heartbeat':
      return prev.status === 'idle'
        ? { ...prev, status: 'following' }
        : prev;
    case 'error': {
      const expired =
        event.code === 'LIVE_QUERY_EXPIRED' ||
        /expired|unavailable/i.test(event.message ?? '');
      return {
        ...prev,
        status: expired ? 'expired' : 'error',
        errorMessage: event.message ?? event.code ?? 'Follow error',
      };
    }
    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}

/** Connection ref name pattern shown in the UI (matches worker resolver). */
export const LIVE_CONNECTION_REF_PATTERN =
  /^LIVE_SOURCE_[A-Z0-9_]+_(URL|CONNECTION)$/;

export function isLiveConnectionRefInputValid(value: string): boolean {
  return LIVE_CONNECTION_REF_PATTERN.test(value.trim());
}

export function formatLagMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

export function formatBytesShort(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) {
    return '—';
  }
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
