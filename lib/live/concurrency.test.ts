import { describe, expect, it } from 'vitest';
import { createSingleFlight } from './concurrency';

describe('createSingleFlight (A-19)', () => {
  it('skips overlapping runs and waits for idle', async () => {
    const flight = createSingleFlight();
    let active = 0;
    let maxActive = 0;
    let runs = 0;

    const slow = async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      runs += 1;
      await new Promise((r) => setTimeout(r, 40));
      active -= 1;
    };

    const first = flight.run(slow);
    const second = flight.run(slow);
    expect(await second).toBe('skipped');
    expect(await first).toBe('ran');
    await flight.waitIdle();
    expect(runs).toBe(1);
    expect(maxActive).toBe(1);

    expect(await flight.run(slow)).toBe('ran');
    expect(runs).toBe(2);
  });

  it('swallows errors at the task boundary via onError', async () => {
    const errors: unknown[] = [];
    const flight = createSingleFlight({
      onError: (err) => errors.push(err),
    });
    await flight.run(async () => {
      throw new Error('boom');
    });
    expect(errors).toHaveLength(1);
    expect(flight.isActive()).toBe(false);
  });
});
