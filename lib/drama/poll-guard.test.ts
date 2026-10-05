import { describe, expect, it } from 'vitest';
import { createDramaPollGuard } from './poll-guard';
describe('enrichment results polling after retry', () => {
  it('rejects an old in-flight failure after accepting a new generation', () => {
    const gate = createDramaPollGuard(); const old = gate.begin();
    gate.acceptRun('new'); expect(gate.accept(old, 'old')).toBe(false);
    const stale = gate.begin(); expect(gate.accept(stale, 'old')).toBe(false);
    const fresh = gate.begin(); expect(gate.accept(fresh, 'new')).toBe(true);
    expect(gate.accept(gate.begin(), 'later-library-start')).toBe(true);
  });
  it('rejects out-of-order replies and reads completed after closing', () => {
    const gate = createDramaPollGuard(); const earlier = gate.begin(); const later = gate.begin();
    expect(gate.accept(earlier, 'run')).toBe(false);
    expect(gate.accept(later, 'run')).toBe(true);
    const closing = gate.begin(); gate.invalidate(); expect(gate.accept(closing, 'run')).toBe(false);
  });
});
