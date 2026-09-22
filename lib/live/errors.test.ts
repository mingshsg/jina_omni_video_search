import { describe, expect, it, beforeEach } from 'vitest';
import {
  liveErrorMessage,
  LiveApiError,
  LIVE_ERROR_HTTP_STATUS,
} from './errors';
import {
  checkLiveMutationRate,
  resetLiveMutationRateForTests,
  readLiveJsonBody,
} from './http';
import {
  publicSourceView,
  publicSessionSummary,
  sanitizeLiveText,
  assertNoAbsolutePathsInJson,
} from './api-sanitize';
import type { LiveSessionDocument, LiveSourceDocument } from './types';

describe('live error catalog', () => {
  it('has bilingual messages and HTTP status for every code', () => {
    expect(liveErrorMessage('LIVE_WORKER_UNAVAILABLE', 'en')).toMatch(/worker/i);
    expect(liveErrorMessage('LIVE_WORKER_UNAVAILABLE', 'zh')).toMatch(/worker|不可用/);
    expect(LIVE_ERROR_HTTP_STATUS.LIVE_WORKER_UNAVAILABLE).toBe(503);
    expect(new LiveApiError('LIVE_SOURCE_NOT_FOUND').status).toBe(404);
  });
});

describe('live mutation rate limit', () => {
  beforeEach(() => {
    resetLiveMutationRateForTests();
  });

  it('allows up to limit then rejects', () => {
    const key = 'test-key';
    for (let i = 0; i < 30; i++) {
      expect(checkLiveMutationRate(key, 1_000, 30)).toBe(true);
    }
    expect(checkLiveMutationRate(key, 1_000, 30)).toBe(false);
    // new window
    expect(checkLiveMutationRate(key, 1_000 + 60_000, 30)).toBe(true);
  });
});

describe('readLiveJsonBody', () => {
  it('rejects oversized content-length', async () => {
    const req = new Request('http://localhost/api', {
      method: 'POST',
      headers: { 'content-length': '999999' },
      body: '{}',
    });
    await expect(readLiveJsonBody(req, 100)).rejects.toBeInstanceOf(LiveApiError);
  });
});

describe('api sanitize', () => {
  it('redacts absolute paths and secrets from text', () => {
    expect(sanitizeLiveText('failed /Users/ming.shen/secret.mp4')).toContain(
      '[redacted-path]',
    );
    expect(sanitizeLiveText('password=hunter2')).toContain('[redacted]');
  });

  it('public views never include absolute paths', () => {
    const source: LiveSourceDocument = {
      source_id: 's1',
      name: 'cam',
      protocol: 'rtsp',
      connection_ref: 'LIVE_SOURCE_CAM_URL',
      enabled: true,
      validation_state: 'ready',
      source_revision: 1,
      endpoint_redacted: 'rtsp://127.0.0.1:8554/fixture',
      endpoint_fingerprint: 'fp',
      allowed_host: '127.0.0.1',
      allowed_port: 8554,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const view = publicSourceView(source);
    expect(view.connection_ref).toBe('LIVE_SOURCE_CAM_URL');
    expect(JSON.stringify(view)).not.toMatch(/password=/i);
    assertNoAbsolutePathsInJson(view);
  });

  it('session summary exposes published revision only', () => {
    const now = new Date().toISOString();
    const session = {
      session_id: 'ls_x',
      source_id: 's1',
      desired_state: 'running',
      observed_state: 'live',
      reserved_revision: 99,
      published_revision: 42,
      stream_epoch: 1,
      last_sequence_no_in_current_epoch: 3,
      health: {
        queue_depth: 0,
        queue_high_water: 0,
        indexing_batches_in_flight: 0,
        spool_bytes: 10,
        reconnect_count: 0,
        windows_searchable: 1,
        windows_failed: 0,
        windows_dropped: 0,
      },
      timestamps: {
        created_at: now,
        command_requested_at: now,
        updated_at: now,
      },
      variant_id: 'v',
    } as LiveSessionDocument;
    const summary = publicSessionSummary(session, true);
    expect(summary.revision).toBe(42);
    expect(JSON.stringify(summary)).not.toContain('reserved_revision');
  });
});
