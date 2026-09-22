/**
 * Bounded work queue and indexing-ack queue for live windows.
 * Atomic state transitions prevent concurrent dequeue vs drop (state recovery).
 */

export type WorkItemState = 'queued' | 'processing';

export interface LiveWorkItem {
  chunk_id: string;
  session_id: string;
  stream_epoch: number;
  sequence_no: number;
  /** Absolute MP4 path once remuxed; optional until finalize. */
  media_path?: string;
  /** Digest of remuxed MP4 (`sha256:…`); required before index. */
  media_sha256?: string;
  duration_ms: number;
  window_end_at: string;
  /** Receive-anchor sample (worker clock at finalize). */
  receive_anchor_utc: string;
  receive_anchor_monotonic_ns?: number;
  enqueued_at: string;
  state: WorkItemState;
  attempt: number;
}

export interface IndexAckItem {
  chunk_id: string;
  session_id: string;
  stream_epoch: number;
  sequence_no: number;
  enqueued_at: string;
  state: WorkItemState;
  /** Index attempt count (1-based); honors LIVE_INDEX_MAX_ATTEMPTS. */
  attempt?: number;
  /** Opaque payload for Phase 5 indexer (draft fingerprint, vectors, …). */
  draft?: Record<string, unknown>;
}

export interface DroppedWindow {
  chunk_id: string;
  session_id: string;
  stream_epoch: number;
  sequence_no: number;
  reason: 'queue_hard_limit' | 'spool_hard_limit';
  dropped_at: string;
}

export interface BoundedQueueStats {
  depth: number;
  highWater: number;
  processing: number;
  queued: number;
  dropped: number;
}

function compareEpochSeq(
  a: { stream_epoch: number; sequence_no: number },
  b: { stream_epoch: number; sequence_no: number },
): number {
  if (a.stream_epoch !== b.stream_epoch) {
    return a.stream_epoch - b.stream_epoch;
  }
  return a.sequence_no - b.sequence_no;
}

/**
 * Bounded FIFO with oldest-drop under hard pressure.
 * Soft warning is reported by callers when depth >= warningThreshold.
 */
export class BoundedWindowQueue<T extends {
  chunk_id: string;
  session_id: string;
  stream_epoch: number;
  sequence_no: number;
  state: WorkItemState;
}> {
  private readonly items = new Map<string, T>();
  private highWater = 0;
  private droppedCount = 0;

  constructor(
    private readonly maxWindows: number,
    /** Soft threshold (default 80% of max). */
    private readonly warningThreshold: number = Math.max(
      1,
      Math.floor(maxWindows * 0.8),
    ),
  ) {
    if (maxWindows < 1) {
      throw new Error('maxWindows must be >= 1');
    }
  }

  get max(): number {
    return this.maxWindows;
  }

  get warningAt(): number {
    return this.warningThreshold;
  }

  stats(): BoundedQueueStats {
    let queued = 0;
    let processing = 0;
    for (const item of this.items.values()) {
      if (item.state === 'queued') queued += 1;
      else if (item.state === 'processing') processing += 1;
    }
    return {
      depth: this.items.size,
      highWater: this.highWater,
      processing,
      queued,
      dropped: this.droppedCount,
    };
  }

  isAtWarning(): boolean {
    return this.items.size >= this.warningThreshold;
  }

  isAtHardLimit(): boolean {
    return this.items.size >= this.maxWindows;
  }

  get(chunkId: string): T | undefined {
    return this.items.get(chunkId);
  }

  has(chunkId: string): boolean {
    return this.items.has(chunkId);
  }

  /**
   * Enqueue a new queued item. If at hard limit, atomically drop the oldest
   * queued (non-processing) window first. Returns drops that must be persisted
   * to the manifest before the caller treats them as durable.
   */
  enqueue(
    item: T,
    options?: { reason?: DroppedWindow['reason'] },
  ): { accepted: boolean; drops: DroppedWindow[] } {
    if (this.items.has(item.chunk_id)) {
      return { accepted: false, drops: [] };
    }

    const drops: DroppedWindow[] = [];
    while (this.items.size >= this.maxWindows) {
      const dropped = this.claimOldestQueuedForDrop(
        options?.reason ?? 'queue_hard_limit',
      );
      if (!dropped) {
        // Nothing droppable (all processing) — refuse new work.
        return { accepted: false, drops };
      }
      drops.push(dropped);
    }

    const next = { ...item, state: 'queued' as const };
    this.items.set(next.chunk_id, next);
    this.highWater = Math.max(this.highWater, this.items.size);
    return { accepted: true, drops };
  }

  /**
   * Atomically claim the oldest queued item for processing.
   * Returns null when empty or none are in `queued` state.
   */
  claimNext(): T | null {
    const candidates = [...this.items.values()]
      .filter((i) => i.state === 'queued')
      .sort(compareEpochSeq);
    const next = candidates[0];
    if (!next) return null;
    const claimed = { ...next, state: 'processing' as const };
    this.items.set(claimed.chunk_id, claimed);
    return claimed;
  }

  /** Complete processing — remove from queue. */
  complete(chunkId: string): T | undefined {
    const item = this.items.get(chunkId);
    if (!item) return undefined;
    this.items.delete(chunkId);
    return item;
  }

  /** Return a processing item to queued (retry). */
  requeue(chunkId: string): T | undefined {
    const item = this.items.get(chunkId);
    if (!item || item.state !== 'processing') return undefined;
    const next = { ...item, state: 'queued' as const };
    this.items.set(chunkId, next);
    return next;
  }

  /**
   * Atomically remove the oldest queued (non-processing) item for a durable drop.
   */
  claimOldestQueuedForDrop(reason: DroppedWindow['reason']): DroppedWindow | null {
    const candidates = [...this.items.values()]
      .filter((i) => i.state === 'queued')
      .sort(compareEpochSeq);
    const oldest = candidates[0];
    if (!oldest) return null;
    this.items.delete(oldest.chunk_id);
    this.droppedCount += 1;
    return {
      chunk_id: oldest.chunk_id,
      session_id: oldest.session_id,
      stream_epoch: oldest.stream_epoch,
      sequence_no: oldest.sequence_no,
      reason,
      dropped_at: new Date().toISOString(),
    };
  }

  /** Snapshot of all items (tests / health). */
  list(): T[] {
    return [...this.items.values()].sort(compareEpochSeq);
  }

  clear(): void {
    this.items.clear();
  }
}

export function createWorkQueue(maxWindows: number): BoundedWindowQueue<LiveWorkItem> {
  return new BoundedWindowQueue<LiveWorkItem>(maxWindows);
}

export function createIndexAckQueue(
  maxWindows: number,
): BoundedWindowQueue<IndexAckItem> {
  return new BoundedWindowQueue<IndexAckItem>(maxWindows);
}

/**
 * Micro-batch collector for indexing acknowledgments (Phase 4 scaffold / Phase 5 wire).
 * Drains up to `maxBatch` claimed processing slots; caller performs one refresh=wait_for.
 */
export class IndexMicroBatcher {
  private inFlightBatches = 0;

  constructor(
    private readonly queue: BoundedWindowQueue<IndexAckItem>,
    private readonly maxBatch: number,
    private readonly maxInFlightBatches: number,
  ) {}

  get inFlight(): number {
    return this.inFlightBatches;
  }

  canStartBatch(): boolean {
    return (
      this.inFlightBatches < this.maxInFlightBatches &&
      this.queue.stats().queued > 0
    );
  }

  /**
   * Claim up to maxBatch items. Caller must call finishBatch after index/ack.
   */
  startBatch(): IndexAckItem[] {
    if (!this.canStartBatch()) return [];
    const batch: IndexAckItem[] = [];
    while (batch.length < this.maxBatch) {
      const item = this.queue.claimNext();
      if (!item) break;
      batch.push(item);
    }
    if (batch.length === 0) return [];
    this.inFlightBatches += 1;
    return batch;
  }

  finishBatch(chunkIds: string[], options?: { requeue?: boolean }): void {
    for (const id of chunkIds) {
      if (options?.requeue) this.queue.requeue(id);
      else this.queue.complete(id);
    }
    this.inFlightBatches = Math.max(0, this.inFlightBatches - 1);
  }
}
