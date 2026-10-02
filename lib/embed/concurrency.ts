import type { AppConfig } from '../config';
import { getConfig } from '../config';

/**
 * Bounded parallel execution gate honoring EMBED_CONCURRENCY (FR-10).
 */
export class ConcurrencyGate {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly limit: number) {
    if (limit < 1) {
      throw new Error('ConcurrencyGate limit must be >= 1');
    }
  }

  async run<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    await this.acquire(signal);
    try {
      signal?.throwIfAborted();
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(signal.reason);
    if (this.active < this.limit) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const abort = () => {
        const index = this.queue.indexOf(ready);
        if (index >= 0) this.queue.splice(index, 1);
        reject(signal?.reason);
      };
      const ready = () => {
        signal?.removeEventListener('abort', abort);
        this.active++;
        resolve();
      };
      signal?.addEventListener('abort', abort, { once: true });
      this.queue.push(ready);
    });
  }

  private release(): void {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }
}

let cachedGate: ConcurrencyGate | null = null;
let cachedLimit: number | null = null;

export function getEmbedConcurrencyGate(cfg?: AppConfig): ConcurrencyGate {
  const config = cfg ?? getConfig();
  if (!cachedGate || cachedLimit !== config.EMBED_CONCURRENCY) {
    cachedGate = new ConcurrencyGate(config.EMBED_CONCURRENCY);
    cachedLimit = config.EMBED_CONCURRENCY;
  }
  return cachedGate;
}

/** Reset singleton — scripts/tests only. */
export function resetEmbedConcurrencyGate(): void {
  cachedGate = null;
  cachedLimit = null;
}

let parserGate: ConcurrencyGate | null = null;
let parserGateLimit: number | null = null;

/** Parser-only gate — never share EMBED_CONCURRENCY (Phase 3.6). */
export function getParserConcurrencyGate(cfg?: AppConfig): ConcurrencyGate {
  const config = cfg ?? getConfig();
  const limit = config.QUERY_PARSER_CONCURRENCY;
  if (!parserGate || parserGateLimit !== limit) {
    parserGate = new ConcurrencyGate(limit);
    parserGateLimit = limit;
  }
  return parserGate;
}

export function resetParserConcurrencyGate(): void {
  parserGate = null;
  parserGateLimit = null;
}
