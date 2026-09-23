import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cancelSuggestJob,
  createSuggestJob,
  getSuggestJob,
  isCacheableSuggestResult,
  resetSuggestJobsForTests,
} from './suggest-jobs';

describe('suggest jobs', () => {
  beforeEach(() => resetSuggestJobsForTests());

  it('runs asynchronously and exposes progress before completion', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = createSuggestJob({
      videoId: 'video-1',
      metaRevision: 3,
      cacheKey: 'video-1:3',
      run: async ({ report }) => {
        report('researching');
        await gate;
        report('validating');
        return { status: 'ok' };
      },
    });
    expect(started).toMatchObject({ status: 'pending', stage: 'queued' });

    await vi.waitFor(() => {
      expect(getSuggestJob(started.request_id, 'video-1')?.stage).toBe(
        'researching',
      );
    });
    release();
    await vi.waitFor(() => {
      expect(getSuggestJob(started.request_id, 'video-1')).toMatchObject({
        status: 'complete',
        stage: 'complete',
        result: { status: 'ok' },
      });
    });
  });

  it('cancels a running external request', async () => {
    const started = createSuggestJob({
      videoId: 'video-2',
      metaRevision: 1,
      cacheKey: 'video-2:1',
      run: ({ signal, report }) => {
        report('researching');
        return new Promise((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          );
        });
      },
    });
    await vi.waitFor(() => {
      expect(getSuggestJob(started.request_id, 'video-2')?.stage).toBe(
        'researching',
      );
    });
    expect(cancelSuggestJob(started.request_id, 'video-2')).toMatchObject({
      status: 'cancelled',
      stage: 'cancelled',
    });
  });

  it('caches only grounded ok results, not local fallbacks', async () => {
    expect(
      isCacheableSuggestResult({
        provider: 'local',
        web: { status: 'unavailable', reason: 'timeout' },
        suggestions: {},
      }),
    ).toBe(false);
    expect(
      isCacheableSuggestResult({
        provider: 'local+agent',
        web: { status: 'ok' },
        suggestions: {},
      }),
    ).toBe(true);

    const miss = createSuggestJob({
      videoId: 'video-3',
      metaRevision: 1,
      cacheKey: 'video-3:local-fallback',
      run: async () => ({
        provider: 'local',
        web: { status: 'unavailable', reason: 'timeout' },
        suggestions: { year: { value: 1999, source: 'local_title' } },
      }),
    });
    await vi.waitFor(() => {
      expect(getSuggestJob(miss.request_id, 'video-3')?.status).toBe('complete');
    });

    const retry = createSuggestJob({
      videoId: 'video-3',
      metaRevision: 1,
      cacheKey: 'video-3:local-fallback',
      run: async () => ({
        provider: 'local+agent',
        web: { status: 'ok' },
        suggestions: {
          description: { value: 'Real synopsis', source: 'external_web' },
        },
      }),
    });
    expect(retry.cache_hit).toBeUndefined();
    expect(retry.status).toBe('pending');
    await vi.waitFor(() => {
      expect(getSuggestJob(retry.request_id, 'video-3')).toMatchObject({
        status: 'complete',
        result: { provider: 'local+agent' },
      });
    });
  });
});
