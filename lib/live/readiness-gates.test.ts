import { describe, expect, it } from 'vitest';
import {
  aggregateReadyGates,
  isStrictReadyMode,
  MANDATORY_READY_GATES,
  type GateRow,
} from './readiness-gates';

function allPass(): GateRow[] {
  return MANDATORY_READY_GATES.map((gate) => ({
    gate,
    status: 'PASS' as const,
    evidence: 'unit',
  }));
}

describe('aggregateReadyGates (V-08 / A-04)', () => {
  it('smoke: FAIL makes ok false', () => {
    const gates = allPass();
    gates[0]!.status = 'FAIL';
    const r = aggregateReadyGates({ gates, strict: false });
    expect(r.ok).toBe(false);
    expect(r.hard_fail).toBe(true);
    expect(r.mode).toBe('smoke');
  });

  it('smoke: NOT RUN does not fail (historical PASS WITH NOTES behavior)', () => {
    const gates = allPass();
    gates.find((g) => g.gate === 'Build')!.status = 'NOT RUN';
    gates.find((g) => g.gate === 'Regression (file-search smoke)')!.status =
      'NOT RUN';
    const r = aggregateReadyGates({ gates, strict: false });
    expect(r.ok).toBe(true);
    expect(r.incomplete_mandatory).toEqual([]);
  });

  it('strict: NOT RUN on mandatory gate is not ok', () => {
    const gates = allPass();
    gates.find((g) => g.gate === 'Build')!.status = 'NOT RUN';
    const r = aggregateReadyGates({
      gates,
      strict: true,
      worktree: { dirty: false },
    });
    expect(r.ok).toBe(false);
    expect(r.incomplete_mandatory).toContain('Build');
  });

  it('strict: PASS_WITH_NOTES on Protocol is not ok', () => {
    const gates = allPass();
    gates.find((g) => g.gate === 'Protocol')!.status = 'PASS_WITH_NOTES';
    const r = aggregateReadyGates({
      gates,
      strict: true,
      worktree: { dirty: false },
    });
    expect(r.ok).toBe(false);
    expect(r.incomplete_mandatory).toContain('Protocol');
  });

  it('strict: FAIL is not ok', () => {
    const gates = allPass();
    gates.find((g) => g.gate === 'Latency')!.status = 'FAIL';
    const r = aggregateReadyGates({
      gates,
      strict: true,
      worktree: { dirty: false },
    });
    expect(r.ok).toBe(false);
    expect(r.hard_fail).toBe(true);
  });

  it('strict: dirty worktree blocks unless allowDirty', () => {
    const gates = allPass();
    const blocked = aggregateReadyGates({
      gates,
      strict: true,
      worktree: { dirty: true },
      allowDirty: false,
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.dirty_blocked).toBe(true);

    const allowed = aggregateReadyGates({
      gates,
      strict: true,
      worktree: { dirty: true },
      allowDirty: true,
    });
    expect(allowed.ok).toBe(true);
    expect(allowed.dirty_blocked).toBe(false);
  });

  it('strict: all PASS + clean tree is ok', () => {
    const r = aggregateReadyGates({
      gates: allPass(),
      strict: true,
      worktree: { dirty: false },
    });
    expect(r.ok).toBe(true);
    expect(r.incomplete_mandatory).toEqual([]);
    expect(r.dirty_blocked).toBe(false);
  });

  it('isStrictReadyMode reads READY_STRICT', () => {
    expect(isStrictReadyMode({ READY_STRICT: '1' })).toBe(true);
    expect(isStrictReadyMode({ READY_STRICT: '0' })).toBe(false);
    expect(isStrictReadyMode({})).toBe(false);
  });
});
