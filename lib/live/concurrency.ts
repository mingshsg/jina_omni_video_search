/**
 * Optimistic concurrency helpers for live control documents.
 * Also: single-flight guards for async poll loops (A-19).
 */

export class VersionConflictError extends Error {
  constructor(message = 'version conflict') {
    super(message);
    this.name = 'VersionConflictError';
  }
}

export function isVersionConflictError(err: unknown): boolean {
  if (err instanceof VersionConflictError) return true;
  if (typeof err !== 'object' || err === null) return false;
  const e = err as {
    name?: string;
    meta?: { statusCode?: number; body?: { error?: { type?: string } } };
  };
  if (e.meta?.statusCode === 409) return true;
  if (e.meta?.body?.error?.type === 'version_conflict_engine_exception') {
    return true;
  }
  if (e.name === 'ResponseError' && e.meta?.statusCode === 409) return true;
  return false;
}

export async function withOptimisticRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options: { maxAttempts?: number } = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 5;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      if (!isVersionConflictError(err) || attempt === maxAttempts) {
        throw err;
      }
    }
  }
  throw lastError;
}

export interface SingleFlight {
  /** Run `fn` if idle; skip when a prior invocation is still in flight. */
  run(fn: () => Promise<void>): Promise<'ran' | 'skipped'>;
  isActive(): boolean;
  /** Await the in-flight task (if any) — for drain/shutdown. */
  waitIdle(): Promise<void>;
}

/**
 * Skip-if-busy single-flight gate for setInterval async polls.
 * Catches errors at the task boundary so overlapping ticks never stack.
 */
export function createSingleFlight(options?: {
  onError?: (err: unknown) => void;
}): SingleFlight {
  let active: Promise<void> | null = null;
  return {
    isActive: () => active != null,
    waitIdle: async () => {
      if (active) await active;
    },
    run: async (fn) => {
      if (active) return 'skipped';
      active = (async () => {
        try {
          await fn();
        } catch (err) {
          options?.onError?.(err);
        }
      })().finally(() => {
        active = null;
      });
      await active;
      return 'ran';
    },
  };
}
