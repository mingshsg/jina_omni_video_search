import { createHash, randomUUID } from 'node:crypto';
import type { LiveConfig } from './config';
import { liveProxySettings } from './live-proxy-ladder';
import type {
  BoundedWindowQueue,
  DroppedWindow,
  IndexAckItem,
  IndexMicroBatcher,
  LiveWorkItem,
} from './queue';
import type { ProxySettings } from '../ingest/variant';

/**
 * Live window processor: concurrency, per-window deadline, bounded retries,
 * fixed proxy ladder. Phase 5 wires real prepareFiniteMedia + LiveIndexer
 * through SessionRuntime hooks (tests may inject fast stubs).
 */

export type RetryCategory =
  | 'provider_throttle'
  | 'provider_unavailable'
  | 'invalid_media'
  | 'deadline'
  | 'proxy_budget'
  | 'unknown';

export interface ProcessAttemptResult {
  ok: boolean;
  service_time_ms: number;
  category?: RetryCategory;
  error?: string;
  draft?: Record<string, unknown>;
}

export interface WindowProcessorHooks {
  /** Prepare proxies / (Phase 5) embeddings. Injectible for tests. */
  processWindow: (args: {
    item: LiveWorkItem;
    proxySettings: ProxySettings;
    signal: AbortSignal;
    attempt: number;
  }) => Promise<ProcessAttemptResult>;
  /** Persist index_ack / failure records (Phase 5 wires ES). */
  onIndexBatchAck?: (items: IndexAckItem[]) => Promise<void>;
  onWindowFailed?: (item: LiveWorkItem, error: string) => Promise<void>;
  /** Durable record for ack-queue eviction / refusal (A-11). */
  onIndexAckDrops?: (drops: DroppedWindow[]) => Promise<void> | void;
  now?: () => number;
}

export interface ProcessorStats {
  completed: number;
  failed: number;
  retried: number;
  serviceTimesMs: number[];
  inFlight: number;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      return;
    }
    const t = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function backoffMs(attempt: number, maxMs: number): number {
  const base = Math.min(maxMs, 200 * 2 ** Math.max(0, attempt - 1));
  const jitter = Math.floor(Math.random() * 50);
  return Math.min(maxMs, base + jitter);
}

export function classifyProviderError(err: unknown): RetryCategory {
  const msg = err instanceof Error ? err.message : String(err);
  if (/429|rate.?limit|throttl/i.test(msg)) return 'provider_throttle';
  if (/503|unavailable|timeout|ECONNRESET|fetch failed/i.test(msg)) {
    return 'provider_unavailable';
  }
  if (/PROXY_BUDGET|budget/i.test(msg)) return 'proxy_budget';
  if (/invalid|decode|corrupt/i.test(msg)) return 'invalid_media';
  if (/deadline|AbortError/i.test(msg)) return 'deadline';
  return 'unknown';
}

/**
 * Default preparation hook: records a proxy-settings fingerprint draft.
 * Real FFmpeg proxy + EIS calls are Phase 5; tests inject fast hooks.
 */
export async function defaultPrepareOnlyHook(args: {
  item: LiveWorkItem;
  proxySettings: ProxySettings;
  signal: AbortSignal;
  attempt: number;
}): Promise<ProcessAttemptResult> {
  const started = performance.now();
  if (args.signal.aborted) {
    return {
      ok: false,
      service_time_ms: performance.now() - started,
      category: 'deadline',
      error: 'aborted before prepare',
    };
  }
  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify({
        chunk_id: args.item.chunk_id,
        media_path: args.item.media_path ?? '',
        proxy: args.proxySettings,
        attempt: args.attempt,
      }),
    )
    .digest('hex')
    .slice(0, 24);
  return {
    ok: true,
    service_time_ms: performance.now() - started,
    draft: {
      chunk_id: args.item.chunk_id,
      prepare_fingerprint: fingerprint,
      proxy_settings: args.proxySettings,
      receive_anchor_utc: args.item.receive_anchor_utc,
    },
  };
}

export class LiveWindowProcessor {
  private running = false;
  private stopRequested = false;
  private inFlight = 0;
  private readonly stats: ProcessorStats = {
    completed: 0,
    failed: 0,
    retried: 0,
    serviceTimesMs: [],
    inFlight: 0,
  };
  private readonly proxySettings: ProxySettings;
  private loopPromise: Promise<void> | null = null;

  constructor(
    private readonly cfg: LiveConfig,
    private readonly workQueue: BoundedWindowQueue<LiveWorkItem>,
    private readonly indexAckQueue: BoundedWindowQueue<IndexAckItem>,
    private readonly microBatcher: IndexMicroBatcher,
    private readonly hooks: WindowProcessorHooks,
  ) {
    this.proxySettings = liveProxySettings({
      maxLongEdge: cfg.LIVE_PROXY_MAX_LONG_EDGE,
      maxAttempts: cfg.LIVE_PROXY_MAX_ATTEMPTS,
    });
  }

  getStats(): ProcessorStats {
    return { ...this.stats, inFlight: this.inFlight, serviceTimesMs: [...this.stats.serviceTimesMs] };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.stopRequested = false;
    this.loopPromise = this.mainLoop();
  }

  async stop(drainMs?: number): Promise<void> {
    this.stopRequested = true;
    const budget = drainMs ?? this.cfg.LIVE_STOP_DRAIN_TIMEOUT_MS;
    const deadline = Date.now() + budget;
    while (this.inFlight > 0 && Date.now() < deadline) {
      await sleep(25);
    }
    // Drain index ack batches
    while (this.microBatcher.canStartBatch() && Date.now() < deadline) {
      await this.flushOneBatch();
    }
    this.running = false;
    if (this.loopPromise) {
      await this.loopPromise.catch(() => undefined);
      this.loopPromise = null;
    }
  }

  private async mainLoop(): Promise<void> {
    while (this.running && !this.stopRequested) {
      await this.flushOneBatch();
      while (
        this.inFlight < this.cfg.LIVE_PROCESSING_CONCURRENCY &&
        !this.stopRequested
      ) {
        const item = this.workQueue.claimNext();
        if (!item) break;
        this.inFlight += 1;
        void this.runOne(item).finally(() => {
          this.inFlight -= 1;
        });
      }
      await sleep(10);
    }
  }

  private async runOne(item: LiveWorkItem): Promise<void> {
    const maxAttempts = this.cfg.LIVE_EMBED_MAX_ATTEMPTS;
    let attempt = Math.max(1, item.attempt || 1);
    const now = this.hooks.now ?? Date.now;

    while (attempt <= maxAttempts) {
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        this.cfg.LIVE_WINDOW_DEADLINE_MS,
      );
      const t0 = now();
      try {
        const result = await this.hooks.processWindow({
          item: { ...item, attempt },
          proxySettings: this.proxySettings,
          signal: controller.signal,
          attempt,
        });
        clearTimeout(timer);
        this.stats.serviceTimesMs.push(result.service_time_ms);

        if (result.ok) {
          const ack: IndexAckItem = {
            chunk_id: item.chunk_id,
            session_id: item.session_id,
            stream_epoch: item.stream_epoch,
            sequence_no: item.sequence_no,
            enqueued_at: new Date().toISOString(),
            state: 'queued',
            attempt: 1,
            draft: result.draft,
          };
          const { accepted, drops } = this.indexAckQueue.enqueue(ack);
          if (drops.length > 0) {
            await this.hooks.onIndexAckDrops?.(drops);
          }
          if (!accepted) {
            // A-11: do not silently lose a prepared window — durable fail.
            this.workQueue.complete(item.chunk_id);
            this.stats.failed += 1;
            await this.hooks.onWindowFailed?.(
              item,
              'index_ack_queue_saturated',
            );
            return;
          }
          this.workQueue.complete(item.chunk_id);
          this.stats.completed += 1;
          return;
        }

        const category = result.category ?? 'unknown';
        if (category === 'invalid_media' || category === 'proxy_budget') {
          this.workQueue.complete(item.chunk_id);
          this.stats.failed += 1;
          await this.hooks.onWindowFailed?.(item, result.error ?? category);
          return;
        }

        if (attempt >= maxAttempts) {
          this.workQueue.complete(item.chunk_id);
          this.stats.failed += 1;
          await this.hooks.onWindowFailed?.(
            item,
            result.error ?? 'retry_exhausted',
          );
          return;
        }

        this.stats.retried += 1;
        attempt += 1;
        await sleep(
          backoffMs(attempt, this.cfg.LIVE_EMBED_RETRY_MAX_MS),
          undefined,
        );
      } catch (err) {
        clearTimeout(timer);
        const category = classifyProviderError(err);
        const elapsed = now() - t0;
        this.stats.serviceTimesMs.push(elapsed);
        if (
          category === 'invalid_media' ||
          category === 'proxy_budget' ||
          attempt >= maxAttempts
        ) {
          this.workQueue.complete(item.chunk_id);
          this.stats.failed += 1;
          await this.hooks.onWindowFailed?.(
            item,
            err instanceof Error ? err.message : String(err),
          );
          return;
        }
        this.stats.retried += 1;
        attempt += 1;
        await sleep(backoffMs(attempt, this.cfg.LIVE_EMBED_RETRY_MAX_MS));
      }
    }
  }

  private async flushOneBatch(): Promise<void> {
    const batch = this.microBatcher.startBatch();
    if (batch.length === 0) return;
    try {
      await this.hooks.onIndexBatchAck?.(batch);
      this.microBatcher.finishBatch(batch.map((b) => b.chunk_id));
    } catch (err) {
      // A-12: honor LIVE_INDEX_MAX_ATTEMPTS — terminal drop after budget.
      const maxAttempts = this.cfg.LIVE_INDEX_MAX_ATTEMPTS;
      const errMsg = err instanceof Error ? err.message : String(err);
      const terminal: IndexAckItem[] = [];
      const retryItems: IndexAckItem[] = [];

      for (const item of batch) {
        const attempt = Math.max(1, item.attempt ?? 1);
        if (attempt >= maxAttempts) {
          terminal.push(item);
        } else {
          retryItems.push({
            ...item,
            attempt: attempt + 1,
            state: 'queued',
          });
        }
      }

      // Release processing slots (complete all), then re-enqueue retries.
      this.microBatcher.finishBatch(batch.map((b) => b.chunk_id));

      for (const item of retryItems) {
        const { accepted, drops } = this.indexAckQueue.enqueue(item);
        if (drops.length > 0) {
          await this.hooks.onIndexAckDrops?.(drops);
        }
        if (!accepted) {
          terminal.push(item);
        }
      }

      for (const item of terminal) {
        this.stats.failed += 1;
        await this.hooks.onWindowFailed?.(
          makeWorkItem({
            chunk_id: item.chunk_id,
            session_id: item.session_id,
            stream_epoch: item.stream_epoch,
            sequence_no: item.sequence_no,
          }),
          `index_retry_exhausted: ${errMsg}`,
        );
      }
    }
  }
}

/** Test helper: synthetic work item. */
export function makeWorkItem(
  overrides: Partial<LiveWorkItem> & Pick<LiveWorkItem, 'chunk_id' | 'session_id'>,
): LiveWorkItem {
  return {
    stream_epoch: 1,
    sequence_no: 1,
    duration_ms: 8000,
    window_end_at: new Date().toISOString(),
    receive_anchor_utc: new Date().toISOString(),
    enqueued_at: new Date().toISOString(),
    state: 'queued',
    attempt: 1,
    ...overrides,
  };
}

export function newWorkerBootId(): string {
  return `boot_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
}
