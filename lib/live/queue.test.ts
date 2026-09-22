import { describe, expect, it } from 'vitest';
import {
  createIndexAckQueue,
  createWorkQueue,
  IndexMicroBatcher,
  type LiveWorkItem,
} from './queue';

function item(
  epoch: number,
  seq: number,
  session = 'ls_test',
): LiveWorkItem {
  return {
    chunk_id: `${session}_${epoch}_${seq}`,
    session_id: session,
    stream_epoch: epoch,
    sequence_no: seq,
    duration_ms: 8000,
    window_end_at: new Date().toISOString(),
    receive_anchor_utc: new Date().toISOString(),
    enqueued_at: new Date().toISOString(),
    state: 'queued',
    attempt: 1,
  };
}

describe('BoundedWindowQueue', () => {
  it('tracks depth and high-water', () => {
    const q = createWorkQueue(4);
    q.enqueue(item(1, 1));
    q.enqueue(item(1, 2));
    expect(q.stats().depth).toBe(2);
    expect(q.stats().highWater).toBe(2);
    expect(q.isAtWarning()).toBe(false);
  });

  it('drops oldest queued (not processing) at hard limit', () => {
    const q = createWorkQueue(2);
    q.enqueue(item(1, 1));
    q.enqueue(item(1, 2));
    const first = q.claimNext();
    expect(first?.chunk_id).toBe('ls_test_1_1');
    expect(first?.state).toBe('processing');

    const { accepted, drops } = q.enqueue(item(1, 3));
    expect(accepted).toBe(true);
    expect(drops).toHaveLength(1);
    expect(drops[0]!.chunk_id).toBe('ls_test_1_2');
    expect(drops[0]!.reason).toBe('queue_hard_limit');
    // processing item was not dropped
    expect(q.get('ls_test_1_1')?.state).toBe('processing');
  });

  it('refuses enqueue when all slots are processing', () => {
    const q = createWorkQueue(1);
    q.enqueue(item(1, 1));
    q.claimNext();
    const { accepted, drops } = q.enqueue(item(1, 2));
    expect(accepted).toBe(false);
    expect(drops).toHaveLength(0);
  });

  it('orders drops by epoch then sequence', () => {
    const q = createWorkQueue(2);
    q.enqueue(item(2, 1));
    q.enqueue(item(1, 9));
    const { drops } = q.enqueue(item(3, 1));
    expect(drops[0]!.chunk_id).toBe('ls_test_1_9');
  });
});

describe('IndexMicroBatcher', () => {
  it('bounds in-flight batches and claims processing items', () => {
    const q = createIndexAckQueue(8);
    q.enqueue({
      chunk_id: 'a',
      session_id: 's',
      stream_epoch: 1,
      sequence_no: 1,
      enqueued_at: new Date().toISOString(),
      state: 'queued',
    });
    q.enqueue({
      chunk_id: 'b',
      session_id: 's',
      stream_epoch: 1,
      sequence_no: 2,
      enqueued_at: new Date().toISOString(),
      state: 'queued',
    });
    const batcher = new IndexMicroBatcher(q, 2, 1);
    const batch = batcher.startBatch();
    expect(batch).toHaveLength(2);
    expect(batcher.inFlight).toBe(1);
    expect(batcher.canStartBatch()).toBe(false);
    batcher.finishBatch(batch.map((x) => x.chunk_id));
    expect(batcher.inFlight).toBe(0);
    expect(q.stats().depth).toBe(0);
  });
});
