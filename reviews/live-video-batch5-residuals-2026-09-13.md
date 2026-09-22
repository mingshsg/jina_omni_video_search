# Live video Batch 5 residual fixes — 2026-09-13

**Verdict: PASS** (actionable completion-review code bugs fixed; Phase 10 still closed)

Cross-check of triage + Batch 3/4 +
[`project-completion-review-2026-09-13.md`](./project-completion-review-2026-09-13.md)
against the current worktree. Product locks unchanged: forever retention,
age-delete+protect, 50 GiB soft free floor, no auth, single-stream MVP,
WHIP/Phase 10 deferred.

---

## Status matrix (completion-review IDs)

| ID | Topic | Status |
| --- | --- | --- |
| A-01 Phase 10 scope | HLS/SRT/WHIP | **Deferred-OK** (product; Phase 10 closed) |
| A-02 Uncommitted live tree | Commit hygiene | **Deferred-OK** (user: no commit this turn) |
| A-03 / V-01 Worktree hash omits untracked bytes | Evidence identity | **Fixed** — `scripts/worktree-identity.ts` hashes untracked file contents |
| A-04 Split E2E/soak identities | Same-commit gate | **Deferred-OK** until live commit |
| A-05 / V-02 Browser mandatory under STRICT | Playwright | **Deferred-OK** (heavy; not blocking demo) |
| A-06 Protocol resilience substitutes | Real worker fault inject | **Deferred-OK** (hygiene; H1 reconnect covered elsewhere) |
| A-07 App E2E `ok` with incomplete gates | Evidence honesty | **Fixed** — mandatory gate list; terminal FAIL if not terminal |
| A-08 App E2E leaves durable state | Cleanup | **Fixed** — stop sessions + disable source in `finally` |
| A-09 Age-delete 5k page cap | Silent partial delete | **Fixed** — `search_after` pagination + `truncated` flag |
| A-10 Protect ranges first 500 only | Protected data loss | **Fixed** — exhaust pages in `listForAgeDelete` |
| A-11 Media unlink before ES delete | Orphan search docs | **Fixed** — ES delete first; unlink only deleted ids |
| A-12 Retained-media cap eviction | Cap path | **Deferred-OK** (unlimited default; same as prior A-16) |
| A-13 Unauthenticated Compose bind | LAN exposure | **Partial Fixed** — Compose defaults to `127.0.0.1`; auth still deferred |
| A-14 Worker image pin/harden | Ops hardening | **Deferred-OK** |
| A-15 Public create accepts HLS/SRT | False capability | **Fixed** — API + control-service RTSP-only |
| A-16 PTS/signature (legacy A-08) | Codec discontinuity | **Deferred-OK** (documented fixture limit) |
| A-17 tsc / lint gates | Verification tooling | **Deferred-OK** (not blocking MVP; lint still unconfigured) |
| A-18 Stale docs/index | Doc drift | **Fixed** — triage/todo/README updated this batch |
| Dry-run deleted counters | Audit semantics | **Fixed** — `*_planned` vs `*_deleted` (deleted=0 on dry_run) |
| L2 Path redaction in public errors | Heuristic paths | **Fixed** — catalog/`code`-stable public messages |
| L3 Synthetic seed fingerprint | Manifest audit | **Fixed** — `computeEventIntentSeedFingerprint` |
| M8 / A-21 Auth | Demo | **Deferred-OK** |
| Playwright | Browser E2E | **Deferred-OK** |

Prior triage Batches 0–4 items remain **already fixed** (H1–H4, A-01…A-20 core path, etc.).

---

## Code changes

| Area | Change |
| --- | --- |
| `lib/live/age-delete.ts` | Full `search_after` traversal; ES-before-media; planned vs deleted audit |
| `lib/live/protect-range-repository.ts` | Paged `listForAgeDelete` |
| `lib/live/memory-es.ts` | `search_after`, richer bool queries, sort values |
| `app/api/live/sources/route.ts` + `control-service.ts` | RTSP-only create |
| `scripts/live-app-path-e2e.ts` | Mandatory PASS gates; session/source cleanup |
| `scripts/worktree-identity.ts` | Hash untracked bytes |
| `docker-compose.yml` | `127.0.0.1` bind default (`APP_BIND` override) |
| `lib/live/api-sanitize.ts` / `fingerprint.ts` / `indexer.ts` | L2 / L3 |

---

## Verification

```text
yarn vitest run lib/live worker
# 34 files / 154 tests PASS (2026-09-13)
docker compose config --quiet  # PASS
```

Phase 10 remains **closed**. Playwright / full typecheck+lint / live commit / A-08 PTS probe intentionally open.
