import { describe, expect, it } from 'vitest';
import {
  canClaimSearchable,
  formatBytesShort,
  formatLagMs,
  initialFollowUiState,
  isLiveConnectionRefInputValid,
  liveObservedStateColor,
  liveValidationStateColor,
  reduceFollowUiEvent,
} from './ui-state';

describe('live UI state helpers', () => {
  it('maps observed and validation states to badge colors', () => {
    expect(liveObservedStateColor('live')).toBe('success');
    expect(liveObservedStateColor('degraded')).toBe('warning');
    expect(liveObservedStateColor('failed')).toBe('danger');
    expect(liveObservedStateColor('connecting')).toBe('primary');
    expect(liveValidationStateColor('ready')).toBe('success');
    expect(liveValidationStateColor('pending_validation')).toBe('warning');
    expect(liveValidationStateColor('invalid')).toBe('danger');
  });

  it('never claims searchable without event or counter', () => {
    expect(canClaimSearchable({})).toBe(false);
    expect(canClaimSearchable({ windowsSearchable: 0 })).toBe(false);
    expect(canClaimSearchable({ eventType: 'window_ready' })).toBe(false);
    expect(canClaimSearchable({ eventType: 'searchable' })).toBe(true);
    expect(canClaimSearchable({ windowsSearchable: 3 })).toBe(true);
  });

  it('validates connection_ref input shape', () => {
    expect(isLiveConnectionRefInputValid('LIVE_SOURCE_DEMO_URL')).toBe(true);
    expect(
      isLiveConnectionRefInputValid('LIVE_SOURCE_LOBBY_CAMERA_CONNECTION'),
    ).toBe(true);
    expect(isLiveConnectionRefInputValid('rtsp://127.0.0.1/live')).toBe(false);
    expect(isLiveConnectionRefInputValid('DEMO_URL')).toBe(false);
  });

  it('reduces follow SSE into UI state transitions', () => {
    let state = initialFollowUiState();
    state = reduceFollowUiEvent(state, {
      type: 'ready',
      expires_at: '2026-09-11T12:00:00.000Z',
    });
    expect(state.status).toBe('following');
    expect(state.expiresAt).toBe('2026-09-11T12:00:00.000Z');

    state = reduceFollowUiEvent(state, {
      type: 'results',
      hits: [{ chunk_id: 'c1' }],
      reason: 'searchable',
    });
    expect(state.hits).toHaveLength(1);
    expect(state.resultGeneration).toBe(1);
    expect(state.lastReason).toBe('searchable');

    state = reduceFollowUiEvent(state, {
      type: 'error',
      code: 'LIVE_QUERY_EXPIRED',
      message: 'gone',
    });
    expect(state.status).toBe('expired');
  });

  it('formats lag and bytes', () => {
    expect(formatLagMs(null)).toBe('—');
    expect(formatLagMs(420)).toBe('420 ms');
    expect(formatLagMs(2500)).toBe('2.5 s');
    expect(formatBytesShort(512)).toBe('512 B');
    expect(formatBytesShort(2048)).toBe('2.0 KB');
  });
});
