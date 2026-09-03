# Review response — Round 4 (`readiness-review-2026-08-25-r4.md`)

Date: 2026-08-25 / 2026-08-26  
Does **not** modify the review file. Implements findings by syncing
requirements, plan, todo, chn.docs, and reference docs, then starting Phase 1.

## Verdict accepted

Agreed: ready to **reconcile and spike**, not to build Phase 1 unchanged against
contradictory requirements or an unproven Next 16 + React 18 stack.

## Findings

### P0-1: Requirements lag plan — **accepted, fixed**

`requirements/01-interpreted-requirements.md` rewritten as the contract:
per-provider C1, C3, C4, FR-2 hardening, FR-8 terminal ladder, FR-9 isolation,
FR-12/19 variants, FR-13 byte-layer measurement, FR-20/21/22, NFR-7 yarn,
NFR-10 workload wording, OQ restatement, decision log. Original request left
verbatim. `chn.docs/架构与数据流.md` synchronized.

### P0-2: Next 16 + React 18 unsupported — **accepted, stack corrected**

Verified against Next.js 15 and 16 upgrade guides. User chose Next.js 14.
Pinned: **Next.js 14.2.35 + React 18.3.1 + EUI 119.1.0**. Compatibility spike
is Phase 1's first gate.

### P1-1: Stale Git tasks — **accepted**

Baseline commit `262412b` already exists. TODO now: add `.gitignore` before
`.env`/`data/`; next commit is sync + ignore + scaffolding.

### P1-2: Missing contract docs — **accepted, sequenced**

Still TODO: `docs/data-model.md` before Phase 3; `docs/api-contract.md` before
Phases 6–8; operations template during Phase 1 (spike record). Attribution
design remains an explicit choice to lock in the API contract before Phase 8.

### P1-3: One config var for per-provider budgets — **accepted, fixed**

Replaced with `EIS_MAX_BINARY_BYTES`, `JINA_MAX_BINARY_BYTES`,
`LOCAL_MAX_BINARY_BYTES`, plus `EMBED_BUDGET_BYTE_LAYER`.

### P1-4: Local not budget-free — **accepted, fixed**

Plan and requirements describe a configurable 10 MB reference baseline; no
"removes the byte budget" claim until measured/reconfigured.

### P1-5: Credentials in `source_ref` — **accepted, FR-22**

Sanitized origin+path + fingerprint; raw URL not persisted/returned by default.

### P2-1: Yarn wording — **accepted**

Yarn is a **project pin** for reproducibility, not a hard consumer mandate.

### P2-2: Soften claims — **accepted**

"Strictly better" → retrieval hypothesis; Phase 11 acceptance → empirical vs
cited constants; "cost estimate" → workload estimate.

## Immediate sequence (this execution)

1. Document sync (this response + requirements/plan/todo/chn/reference).
2. `.gitignore`.
3. Phase 1 spike + scaffolding.
4. Phase 2 still blocked on Elastic credentials.
