import { afterEach, describe, expect, it } from 'vitest';
import { loadLiveConfig } from './config';
import {
  createIndexAckQueue,
  createWorkQueue,
  IndexMicroBatcher,
} from './queue';
import {
  classifyProviderError,
  LiveWindowProcessor,
  makeWorkItem,
} from './processor';

function testCfg(overrides: Record<string, string> = {}) {
  return loadLiveConfig({
    LIVE_QUEUE_MAX_WINDOWS: '8',
    LIVE_INDEX_ACK_QUEUE_MAX_WINDOWS: '8',
    LIVE_PROCESSING_CONCURRENCY: '2',
    LIVE_WINDOW_DEADLINE_MS: '2000',
    LIVE_EMBED_MAX_ATTEMPTS: '3',
    LIVE_EMBED_RETRY_MAX_MS: '50',
    LIVE_INDEX_MAX_IN_FLIGHT_BATCHES: '2',
    LIVE_PROXY_MAX_LONG_EDGE: '720',
    LIVE_PROXY_MAX_ATTEMPTS: '3',
    LIVE_STOP_DRAIN_TIMEOUT_MS: '2000',
    ...overrides,
  });
}

describe('LiveWindowProcessor', () => {
  const processors: LiveWindowProcessor[] = [];

  afterEach(async () => {
    for (const p of processors.splice(0)) {
      await p.stop(500);
    }
  });

  it('processes with concurrency and records service times under p95 budget (fast hook)', async () => {
    const cfg = testCfg({
      LIVE_QUEUE_MAX_WINDOWS: '24',
      LIVE_INDEX_ACK_QUEUE_MAX_WINDOWS: '24',
    });
    const work = createWorkQueue(24);
    const ack = createIndexAckQueue(24);
    const batcher = new IndexMicroBatcher(ack, 8, 2);
    const acked: string[] = [];

    const processor = new LiveWindowProcessor(cfg, work, ack, batcher, {
      processWindow: async () => {
        await new Promise((r) => setTimeout(r, 2));
        return {
          ok: true,
          service_time_ms: 2,
          draft: { ok: true },
        };
      },
      onIndexBatchAck: async (items) => {
        for (const i of items) acked.push(i.chunk_id);
      },
    });
    processors.push(processor);

    for (let i = 1; i <= 20; i++) {
      work.enqueue(
        makeWorkItem({
          chunk_id: `ls_x_1_${i}`,
          session_id: 'ls_x',
          stream_epoch: 1,
          sequence_no: i,
        }),
      );
    }

    processor.start();
    const deadline = Date.now() + 8_000;
    while (processor.getStats().completed < 20 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 15));
    }
    // Drain remaining ack batches
    await processor.stop(2000);

    const stats = processor.getStats();
    expect(stats.completed).toBe(20);
    expect(acked.length).toBe(20);
    const times = [...stats.serviceTimesMs].sort((a, b) => a - b);
    const p95 = times[Math.min(times.length - 1, Math.floor(times.length * 0.95))]!;
    expect(p95).toBeLessThanOrEqual(4_500);
  }, 15_000);

  it('retries provider 429/503 then fails after budget (slow-consumer storm)', async () => {
    const cfg = testCfg({ LIVE_EMBED_MAX_ATTEMPTS: '3', LIVE_EMBED_RETRY_MAX_MS: '20' });
    const work = createWorkQueue(4);
    const ack = createIndexAckQueue(4);
    const batcher = new IndexMicroBatcher(ack, 2, 1);
    let calls = 0;

    const processor = new LiveWindowProcessor(cfg, work, ack, batcher, {
      processWindow: async () => {
        calls += 1;
        return {
          ok: false,
          service_time_ms: 1,
          category: 'provider_throttle',
          error: '429 rate limit',
        };
      },
    });
    processors.push(processor);

    work.enqueue(
      makeWorkItem({ chunk_id: 'ls_x_1_1', session_id: 'ls_x', sequence_no: 1 }),
    );
    processor.start();
    const deadline = Date.now() + 3_000;
    while (processor.getStats().failed < 1 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
    }
    await processor.stop(500);

    expect(calls).toBe(3);
    expect(processor.getStats().failed).toBe(1);
    expect(work.stats().depth).toBe(0);
  });

  it('classifies provider errors', () => {
    expect(classifyProviderError(new Error('HTTP 429'))).toBe('provider_throttle');
    expect(classifyProviderError(new Error('503 unavailable'))).toBe(
      'provider_unavailable',
    );
    expect(classifyProviderError(new Error('PROXY_BUDGET'))).toBe('proxy_budget');
  });

  it('A-11: refuses silent loss when index-ack queue cannot accept', async () => {
    const cfg = testCfg({
      LIVE_QUEUE_MAX_WINDOWS: '4',
      LIVE_INDEX_ACK_QUEUE_MAX_WINDOWS: '1',
      LIVE_PROCESSING_CONCURRENCY: '1',
      LIVE_INDEX_MAX_IN_FLIGHT_BATCHES: '1',
    });
    const work = createWorkQueue(4);
    const ack = createIndexAckQueue(1);
    const batcher = new IndexMicroBatcher(ack, 1, 1);
    const failed: string[] = [];
    const dropped: string[] = [];

    // Saturate ack queue with a processing slot so nothing is droppable.
    ack.enqueue({
      chunk_id: 'blocker',
      session_id: 'ls_x',
      stream_epoch: 1,
      sequence_no: 0,
      enqueued_at: new Date().toISOString(),
      state: 'queued',
      attempt: 1,
    });
    expect(ack.claimNext()?.chunk_id).toBe('blocker');

    const processor = new LiveWindowProcessor(cfg, work, ack, batcher, {
      processWindow: async () => ({
        ok: true,
        service_time_ms: 1,
        draft: { ok: true },
      }),
      onWindowFailed: async (item, error) => {
        failed.push(`${item.chunk_id}:${error}`);
      },
      onIndexAckDrops: async (drops) => {
        for (const d of drops) dropped.push(d.chunk_id);
      },
      onIndexBatchAck: async () => undefined,
    });
    processors.push(processor);

    work.enqueue(
      makeWorkItem({ chunk_id: 'ls_x_1_1', session_id: 'ls_x', sequence_no: 1 }),
    );
    processor.start();
    const deadline = Date.now() + 3_000;
    while (processor.getStats().failed < 1 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 15));
    }
    await processor.stop(500);

    expect(processor.getStats().completed).toBe(0);
    expect(processor.getStats().failed).toBe(1);
    expect(failed.some((f) => f.includes('index_ack_queue_saturated'))).toBe(
      true,
    );
    expect(work.stats().depth).toBe(0);
    expect(ack.has('ls_x_1_1')).toBe(false);
    void dropped;
  });

  it('A-12: stops requeueing index batches after LIVE_INDEX_MAX_ATTEMPTS', async () => {
    const cfg = testCfg({
      LIVE_INDEX_MAX_ATTEMPTS: '2',
      LIVE_INDEX_ACK_QUEUE_MAX_WINDOWS: '4',
      LIVE_INDEX_MAX_IN_FLIGHT_BATCHES: '1',
    });
    const work = createWorkQueue(4);
    const ack = createIndexAckQueue(4);
    const batcher = new IndexMicroBatcher(ack, 2, 1);
    let indexCalls = 0;
    const failed: string[] = [];

    const processor = new LiveWindowProcessor(cfg, work, ack, batcher, {
      processWindow: async () => ({
        ok: true,
        service_time_ms: 1,
        draft: { ok: true },
      }),
      onIndexBatchAck: async () => {
        indexCalls += 1;
        throw new Error('ES unavailable');
      },
      onWindowFailed: async (item, error) => {
        failed.push(`${item.chunk_id}:${error}`);
      },
    });
    processors.push(processor);

    work.enqueue(
      makeWorkItem({ chunk_id: 'ls_x_1_9', session_id: 'ls_x', sequence_no: 9 }),
    );
    processor.start();
    const deadline = Date.now() + 5_000;
    while (
      !failed.some((f) => f.includes('index_retry_exhausted')) &&
      Date.now() < deadline
    ) {
      await new Promise((r) => setTimeout(r, 20));
    }
    await processor.stop(500);

    expect(indexCalls).toBe(2);
    expect(failed.some((f) => f.includes('index_retry_exhausted'))).toBe(true);
    expect(ack.stats().depth).toBe(0);
  });
});
