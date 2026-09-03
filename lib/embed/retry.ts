export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_BASE_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 30_000;

/** HTTP statuses retried per FR-10 (429 rate limit, 503 unavailable). */
export const RETRYABLE_HTTP_STATUSES = new Set([429, 503]);

export function isRetryableHttpStatus(status: number): boolean {
  return RETRYABLE_HTTP_STATUSES.has(status);
}

function jitteredDelay(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const exp = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
  return Math.floor(Math.random() * exp);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Exponential backoff with jitter for transient failures (FR-10).
 * `isRetryable` receives the thrown error; return true to retry.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  isRetryable: (err: unknown) => boolean,
  opts: RetryOptions = {},
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const baseDelayMs = opts.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = opts.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;

  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const canRetry = attempt < maxAttempts - 1 && isRetryable(err);
      if (!canRetry) throw err;
      await sleep(jitteredDelay(attempt, baseDelayMs, maxDelayMs));
    }
  }
  throw lastError;
}

/** Error shape for fetch-based providers with an HTTP status. */
export class HttpEmbedError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpEmbedError';
    this.status = status;
  }
}

export function isRetryableEmbedError(err: unknown): boolean {
  if (err instanceof HttpEmbedError) {
    return isRetryableHttpStatus(err.status);
  }
  const status =
    typeof err === 'object' &&
    err !== null &&
    'statusCode' in err &&
    typeof (err as { statusCode: unknown }).statusCode === 'number'
      ? (err as { statusCode: number }).statusCode
      : null;
  if (status !== null) return isRetryableHttpStatus(status);
  return false;
}
