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

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.queue.push(() => {
        this.active++;
        resolve();
      });
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
