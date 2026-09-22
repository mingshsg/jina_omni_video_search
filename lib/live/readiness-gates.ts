/**
 * Phase 9 readiness gate aggregation (A-04 / V-08).
 *
 * Smoke mode: any FAIL → not ok; NOT RUN / PASS_WITH_NOTES allowed.
 * Strict mode (READY_STRICT): every mandatory gate must be exactly PASS;
 * dirty worktree refuses acceptance unless READY_ALLOW_DIRTY=1.
 */

export type GateStatus = 'PASS' | 'FAIL' | 'NOT RUN' | 'PASS_WITH_NOTES';

export type GateRow = {
  gate: string;
  status: GateStatus;
  evidence: string;
  notes?: string;
};

/** Mandatory for READY_STRICT acceptance (protocol-probe or app-path). */
export const MANDATORY_READY_GATES = [
  'Unit',
  'Security (web rejects LIVE_SOURCE_*)',
  'Security (secret scan)',
  'Protocol',
  'Resilience',
  'Latency',
  'Search',
  'Playback',
  'Build',
  'Regression (file-search smoke)',
] as const;

export type WorktreeIdentity = {
  commit: string;
  branch: string;
  dirty: boolean;
  /** Short porcelain summary (truncated). */
  status_short: string;
  /**
   * Deterministic hash of `git status --porcelain=v1` + `git diff` +
   * `git diff --cached` so dirty evidence is reproducible.
   */
  content_hash: string;
};

export type AggregateReadyResult = {
  ok: boolean;
  mode: 'smoke' | 'strict';
  hard_fail: boolean;
  incomplete_mandatory: string[];
  dirty_blocked: boolean;
  reasons: string[];
};

export function isStrictReadyMode(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env.READY_STRICT ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

export function allowDirtyUnderStrict(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const v = (env.READY_ALLOW_DIRTY ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

/**
 * Aggregate gate rows into an acceptance decision.
 * V-08: unit-test every non-PASS mandatory status under strict mode.
 */
export function aggregateReadyGates(args: {
  gates: GateRow[];
  strict?: boolean;
  worktree?: Pick<WorktreeIdentity, 'dirty'>;
  allowDirty?: boolean;
  mandatoryGates?: readonly string[];
}): AggregateReadyResult {
  const strict = args.strict ?? false;
  const mandatory = args.mandatoryGates ?? MANDATORY_READY_GATES;
  const hard_fail = args.gates.some((g) => g.status === 'FAIL');
  const byName = new Map(args.gates.map((g) => [g.gate, g]));
  const incomplete_mandatory: string[] = [];
  const reasons: string[] = [];

  if (hard_fail) {
    reasons.push('one or more gates are FAIL');
  }

  if (strict) {
    for (const name of mandatory) {
      const row = byName.get(name);
      if (!row || row.status !== 'PASS') {
        incomplete_mandatory.push(name);
        reasons.push(
          `mandatory gate "${name}" is ${row?.status ?? 'missing'} (strict requires PASS)`,
        );
      }
    }
  }

  const dirty_blocked =
    strict &&
    Boolean(args.worktree?.dirty) &&
    !(args.allowDirty ?? false);
  if (dirty_blocked) {
    reasons.push(
      'worktree is dirty under READY_STRICT (set READY_ALLOW_DIRTY=1 to record dirty content_hash and continue)',
    );
  }

  const ok =
    !hard_fail &&
    (!strict || (incomplete_mandatory.length === 0 && !dirty_blocked));

  return {
    ok,
    mode: strict ? 'strict' : 'smoke',
    hard_fail,
    incomplete_mandatory,
    dirty_blocked,
    reasons,
  };
}
