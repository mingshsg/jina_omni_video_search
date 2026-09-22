import { getLiveConfig } from './config';
import { LiveApiError } from './errors';

/**
 * Process-local mutation rate limiter anchored on globalThis so Next.js
 * route bundles / HMR share one window (plan Phase 6/7).
 */

type RateBucket = { count: number; windowStartMs: number };

type GlobalRateState = {
  buckets: Map<string, RateBucket>;
};

const GLOBAL_KEY = '__jina_live_mutation_rate__';

function rateState(): GlobalRateState {
  const g = globalThis as typeof globalThis & {
    [GLOBAL_KEY]?: GlobalRateState;
  };
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = { buckets: new Map() };
  }
  return g[GLOBAL_KEY]!;
}

/** Returns true if the key is allowed; false if over limit. */
export function checkLiveMutationRate(
  key: string,
  nowMs: number = Date.now(),
  limitPerMinute: number = getLiveConfig().LIVE_MUTATION_RATE_PER_MINUTE,
): boolean {
  const state = rateState();
  const windowMs = 60_000;
  const bucket = state.buckets.get(key);
  if (!bucket || nowMs - bucket.windowStartMs >= windowMs) {
    state.buckets.set(key, { count: 1, windowStartMs: nowMs });
    return true;
  }
  if (bucket.count >= limitPerMinute) return false;
  bucket.count += 1;
  return true;
}

export function assertLiveMutationAllowed(key: string): void {
  if (!checkLiveMutationRate(key)) {
    throw new LiveApiError('LIVE_RATE_LIMITED');
  }
}

/** Read raw body with byte cap from LIVE_API_MAX_BODY_BYTES. */
export async function readLiveJsonBody(
  request: Request,
  maxBytes: number = getLiveConfig().LIVE_API_MAX_BODY_BYTES,
): Promise<unknown> {
  const lenHeader = request.headers.get('content-length');
  if (lenHeader) {
    const n = Number(lenHeader);
    if (Number.isFinite(n) && n > maxBytes) {
      throw new LiveApiError('LIVE_PAYLOAD_TOO_LARGE');
    }
  }
  const buf = Buffer.from(await request.arrayBuffer());
  if (buf.byteLength > maxBytes) {
    throw new LiveApiError('LIVE_PAYLOAD_TOO_LARGE');
  }
  if (buf.byteLength === 0) return {};
  try {
    return JSON.parse(buf.toString('utf8')) as unknown;
  } catch {
    throw new LiveApiError('LIVE_INVALID_REQUEST', {
      message: 'Request body must be JSON',
    });
  }
}

/** Reset rate buckets — tests only. */
export function resetLiveMutationRateForTests(): void {
  rateState().buckets.clear();
}
