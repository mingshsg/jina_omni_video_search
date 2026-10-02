import { describe, expect, it } from 'vitest';
import { VoiceGate, voiceDeadline } from './runtime';
import { ConcurrencyGate } from '../embed/concurrency';
describe('voice processing resource release', () => {
  it('rejects excess voice work then releases its slot after failure', async () => {
    const gate = new VoiceGate(1); let finish!: () => void;
    const running = gate.run(() => new Promise<void>((resolve) => { finish = resolve; }));
    await expect(gate.run(async () => 1)).rejects.toMatchObject({ status: 429 });
    finish(); await running;
    await expect(gate.run(async () => { throw new Error('failed'); })).rejects.toThrow();
    await expect(gate.run(async () => 1)).resolves.toBe(1);
  });
  it('removes cancelled embedding waiters without spending a provider call or losing capacity', async () => {
    const gate = new ConcurrencyGate(1); let finish!: () => void, called = false;
    const running = gate.run(() => new Promise<void>((resolve) => { finish = resolve; }));
    await Promise.resolve();
    const controller = new AbortController();
    const queued = gate.run(async () => { called = true; }, controller.signal);
    controller.abort(); await expect(queued).rejects.toThrow();
    finish(); await running;
    expect(called).toBe(false); await expect(gate.run(async () => 2)).resolves.toBe(2);
  });
  it('propagates client cancellation to the server deadline', () => {
    const parent = new AbortController(); const deadline = voiceDeadline(parent.signal);
    parent.abort(); expect(deadline.signal.aborted).toBe(true); deadline.dispose();
  });
});
