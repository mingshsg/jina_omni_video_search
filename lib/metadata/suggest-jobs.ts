import { randomUUID } from 'node:crypto';

export type SuggestJobStage =
  | 'queued'
  | 'preparing'
  | 'researching'
  | 'validating'
  | 'complete'
  | 'failed'
  | 'cancelled';

export type SuggestJobStatus = 'pending' | 'complete' | 'failed' | 'cancelled';

export interface SuggestJobSnapshot<T = unknown> {
  request_id: string;
  video_id: string;
  meta_revision: number;
  status: SuggestJobStatus;
  stage: SuggestJobStage;
  created_at: string;
  updated_at: string;
  result?: T;
  error?: { code: string; message: string };
  cache_hit?: boolean;
}

interface SuggestJob<T> extends SuggestJobSnapshot<T> {
  cache_key: string;
  controller: AbortController;
  run: (context: {
    signal: AbortSignal;
    report: (stage: Extract<SuggestJobStage, 'researching' | 'validating'>) => void;
  }) => Promise<T>;
}

interface SuggestCacheEntry {
  expires_at: number;
  result: unknown;
}

interface SuggestJobStoreState {
  jobs: Map<string, SuggestJob<unknown>>;
  queue: string[];
  cache: Map<string, SuggestCacheEntry>;
  starts: Map<string, number[]>;
  active: number;
}

const JOB_TTL_MS = 10 * 60_000;
const CACHE_TTL_MS = 10 * 60_000;
const MAX_JOBS = 64;
const MAX_ACTIVE = 2;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 6;

const globalStore = globalThis as typeof globalThis & {
  __videoSuggestJobs?: SuggestJobStoreState;
};

const state: SuggestJobStoreState =
  globalStore.__videoSuggestJobs ??
  (globalStore.__videoSuggestJobs = {
    jobs: new Map(),
    queue: [],
    cache: new Map(),
    starts: new Map(),
    active: 0,
  });

export class SuggestRateLimitError extends Error {
  readonly code = 'META_SUGGEST_RATE_LIMITED';

  constructor() {
    super('Too many Suggest requests; wait and try again');
    this.name = 'SuggestRateLimitError';
  }
}

export class SuggestQueueFullError extends Error {
  readonly code = 'META_SUGGEST_BUSY';

  constructor() {
    super('Suggest is busy; wait and try again');
    this.name = 'SuggestQueueFullError';
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function cleanup(now = Date.now()): void {
  for (const [id, job] of state.jobs) {
    if (
      job.status !== 'pending' &&
      Date.parse(job.updated_at) + JOB_TTL_MS <= now
    ) {
      state.jobs.delete(id);
    }
  }
  for (const [key, cached] of state.cache) {
    if (cached.expires_at <= now) state.cache.delete(key);
  }
  for (const [key, starts] of state.starts) {
    const recent = starts.filter((time) => time > now - RATE_WINDOW_MS);
    if (recent.length === 0) state.starts.delete(key);
    else state.starts.set(key, recent);
  }
}

function evictOldestTerminalUntilBelow(limit: number): void {
  if (state.jobs.size < limit) return;
  const terminal = [...state.jobs.values()]
    .filter((job) => job.status !== 'pending')
    .sort((a, b) => a.updated_at.localeCompare(b.updated_at));
  for (const job of terminal) {
    if (state.jobs.size < limit) break;
    state.jobs.delete(job.request_id);
  }
}

function publicSnapshot<T>(job: SuggestJob<T>): SuggestJobSnapshot<T> {
  return {
    request_id: job.request_id,
    video_id: job.video_id,
    meta_revision: job.meta_revision,
    status: job.status,
    stage: job.stage,
    created_at: job.created_at,
    updated_at: job.updated_at,
    ...(job.result !== undefined ? { result: job.result } : {}),
    ...(job.error ? { error: job.error } : {}),
    ...(job.cache_hit != null ? { cache_hit: job.cache_hit } : {}),
  };
}

/**
 * Only cache grounded successes. Local-only / unavailable / skipped / empty
 * results must not poison retries for 10 minutes.
 */
export function isCacheableSuggestResult(result: unknown): boolean {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return false;
  }
  const row = result as Record<string, unknown>;
  const provider = row.provider;
  if (provider !== 'local+agent' && provider !== 'local+jina') return false;
  const web = row.web;
  if (!web || typeof web !== 'object' || Array.isArray(web)) return false;
  return (web as Record<string, unknown>).status === 'ok';
}

function pump(): void {
  while (state.active < MAX_ACTIVE && state.queue.length > 0) {
    const id = state.queue.shift()!;
    const job = state.jobs.get(id);
    if (!job || job.status !== 'pending') continue;
    state.active += 1;
    job.stage = 'preparing';
    job.updated_at = nowIso();

    void job
      .run({
        signal: job.controller.signal,
        report: (stage) => {
          if (job.status !== 'pending') return;
          job.stage = stage;
          job.updated_at = nowIso();
        },
      })
      .then((result) => {
        if (job.status !== 'pending') return;
        job.status = 'complete';
        job.stage = 'complete';
        job.result = result;
        job.updated_at = nowIso();
        // Cache only successful grounded enrichments. Caching local fallbacks
        // after timeout/parse failure locks the UI on Title-clue drafts.
        if (isCacheableSuggestResult(result)) {
          state.cache.set(job.cache_key, {
            result,
            expires_at: Date.now() + CACHE_TTL_MS,
          });
        }
      })
      .catch(() => {
        if (job.status !== 'pending') return;
        job.status = 'failed';
        job.stage = 'failed';
        job.error = {
          code: 'META_SUGGEST_FAILED',
          message: 'Suggest failed',
        };
        job.updated_at = nowIso();
      })
      .finally(() => {
        state.active = Math.max(0, state.active - 1);
        cleanup();
        pump();
      });
  }
}

export function assertSuggestRateLimit(key: string): void {
  const now = Date.now();
  const recent = (state.starts.get(key) ?? []).filter(
    (time) => time > now - RATE_WINDOW_MS,
  );
  if (recent.length >= RATE_MAX) throw new SuggestRateLimitError();
  recent.push(now);
  state.starts.set(key, recent);
}

export function createSuggestJob<T>(params: {
  videoId: string;
  metaRevision: number;
  cacheKey: string;
  run: SuggestJob<T>['run'];
}): SuggestJobSnapshot<T> {
  cleanup();
  evictOldestTerminalUntilBelow(MAX_JOBS);
  if (state.jobs.size >= MAX_JOBS) throw new SuggestQueueFullError();
  const createdAt = nowIso();
  const requestId = randomUUID();
  const cached = state.cache.get(params.cacheKey);
  const job: SuggestJob<T> = {
    request_id: requestId,
    video_id: params.videoId,
    meta_revision: params.metaRevision,
    status: cached ? 'complete' : 'pending',
    stage: cached ? 'complete' : 'queued',
    created_at: createdAt,
    updated_at: createdAt,
    cache_key: params.cacheKey,
    controller: new AbortController(),
    run: params.run,
    ...(cached ? { result: cached.result as T, cache_hit: true } : {}),
  };
  state.jobs.set(requestId, job as SuggestJob<unknown>);
  if (!cached) {
    state.queue.push(requestId);
    queueMicrotask(pump);
  }
  return publicSnapshot(job);
}

export function getSuggestJob<T = unknown>(
  requestId: string,
  videoId: string,
): SuggestJobSnapshot<T> | null {
  cleanup();
  const job = state.jobs.get(requestId);
  if (!job || job.video_id !== videoId) return null;
  return publicSnapshot(job as SuggestJob<T>);
}

export function cancelSuggestJob(
  requestId: string,
  videoId: string,
): SuggestJobSnapshot | null {
  const job = state.jobs.get(requestId);
  if (!job || job.video_id !== videoId) return null;
  if (job.status === 'pending') {
    job.status = 'cancelled';
    job.stage = 'cancelled';
    job.updated_at = nowIso();
    job.controller.abort();
  }
  return publicSnapshot(job);
}

/** Tests only. */
export function resetSuggestJobsForTests(): void {
  for (const job of state.jobs.values()) job.controller.abort();
  state.jobs.clear();
  state.queue.length = 0;
  state.cache.clear();
  state.starts.clear();
  state.active = 0;
}
