# Live video review triage — 2026-09-12

**Source reviews (archived after triage):**

- [`archive/2026-09-12-live-video-code-and-readiness-reviews/live-video-phases-1-9-code-review-2026-09-12.md`](./archive/2026-09-12-live-video-code-and-readiness-reviews/live-video-phases-1-9-code-review-2026-09-12.md) — Phases 1–9 **code** review (+ H1–H4 amendment).
- [`archive/2026-09-12-live-video-code-and-readiness-reviews/application-implementation-phase-10-readiness-review-2026-09-12.md`](./archive/2026-09-12-live-video-code-and-readiness-reviews/application-implementation-phase-10-readiness-review-2026-09-12.md) — application-path / Phase 10 **readiness** (function) review.

**Product decisions (locked):** retention forever until explicit delete; unlimited spool defaults; single stream/worker/web MVP; localhost + 554/8554; WHIP deferred.

**Codebase check date:** 2026-09-12 (dirty worktree; HEAD still file-video baseline `78d7e56`).

---

## Document summaries

| Document | Covers |
| --- | --- |
| Code review | Implementation quality of `lib/live/**`, worker, live APIs/UI. Verdict: coherent RTSP MVP; H1–H4 marked fixed; M1–M9 still open; M10 doc sync done. |
| Readiness review | Whether the **application workflow** and Phase 9 gates justify opening Phase 10. Verdict: **NOT READY** — blocked source validation, Compose env split, readiness runner substitutes, plus deeper runtime/durability gaps (A-01…A-21, V-01…V-08). |

Cross-check note: several High items from the code review are **already fixed**; the readiness review correctly focuses on application-path and verification holes that still block Phase 10.

---

## Status legend

- **already fixed** — verified in current code
- **still open** — still present
- **partially fixed** — some mitigation, gap remains
- **disagree** — wrong, outdated, overstated, or conflicts with locked product decisions
- **accept / defer** — valid finding; defer past MVP gate by policy

---

## Code review findings

### High (H1–H4)

| ID | Severity | Status | Disposition |
| --- | --- | --- | --- |
| H1 Capture never reconnects | High | **already fixed** | Unexpected exit → backoff → re-resolve → epoch bump → `startCapture` (`session-supervisor.ts`). Residual: A-07 (stale playlist/paths). |
| H2 `publishHealth` clobbers `windows_searchable` | High | **already fixed** | Supervisor omits field; `mergeSessionWorkerPatch` deep-merges health. |
| H3 Credentials on FFmpeg argv | High | **already fixed** | 0600 `ffmpeg-input.ffconcat`; argv uses concat only. Residual: same-UID host trust (document, do not “over-fix”). |
| H4 Claim / terminal idempotency | High | **already fixed** | Claim clear + same-key conflict on terminal sessions work. Residual claim-then-conflict on create path cleared in Batch 0 (2026-09-12). |

### Medium

| ID | Severity | Status | Fix approach / objection |
| --- | --- | --- | --- |
| M1 `reserved_revision` not true CAS | Medium | **already fixed** (Batch 1) | `reserveNextRevision` computes revision inside optimistic retry; `event_intent` appended only after CAS. Same as A-13. |
| M2 No `window_processed` producer | Medium | **already fixed** (Batch 3) | Embed appends `window_processed`; recovery restores finalize/processed metadata (A-14/V-05 unit). |
| M3 `media_sha256: unknown` | Medium | **already fixed** (Batch 1) | Remuxed MP4 hashed at finalize; embed rejects missing/`sha256:unknown`. Same as A-15. |
| M4 Thumbs stay under `tmp/` | Medium | **already fixed** (Batch 2) | Promote `media/${chunkId}.thumb.jpg` before index; serve only from `media/`. |
| M5 `patchSource` two writes | Medium | **disagree / overstated** | `mergeSourceApiPatch` already resets validation atomically on connection change in the first `updateApiFields`. Second `updateWorkerFields` is redundant, not a ready→pending race. Optional cleanup: single write. |
| M6 Session SSE poll overlap | Medium | **already fixed** (Batch 2) | Single-flight flag like follow-search (also A-19). |
| M7 Hardcoded `dims: 1024` | Medium | **already fixed** (Batch 1) | Session create uses `appCfg.EMBED_DIMS`; embed assert fail-closed (A-18). |
| M8 No auth on live APIs | Medium | **accept / defer** | Locked demo/localhost MVP. Before any shared-network deploy: loopback bind and/or auth + opaque media tokens. Same as A-21. |
| M9 Whitelist includes `file`/`http`/`https` | Medium | **partially disagree** | `file`/`concat` are needed for private ffconcat; dropping without fixture proof can break capture. Prefer: keep minimal set required for concat+rtsp+tcp+rtp; document why `file` remains; reject nested `file:` in URL path (already in `source-url.ts`). |
| M10 Contract shows age retention | Medium | **already fixed** | `docs/live-video-api-contract.md` uses `until_explicit_delete`. |

### Low

| ID | Status | Disposition |
| --- | --- | --- |
| L1 Process-local follow/cache | accept / defer | Document for multi-instance; fine for single-web MVP. |
| L2 Path redaction heuristic | **already fixed** (Batch 5) | Public views use catalog/`code`-stable messages via `publicErrorMessage`. |
| L3 Synthetic seed fingerprint | **already fixed** (Batch 5) | `computeEventIntentSeedFingerprint` binds event_id/session/chunk/revision. |
| L4 Opaque media refs unused | accept / defer | Document as future-facing; deterministic paths OK for MVP. |
| L5 Soak + Playwright | soak **PASS** / Playwright open | 10-min strict soak [`readymtzh2c5c`](./live-rtsp-readiness-readymtzh2c5c.json); Playwright still absent. |

---

## Readiness / function review findings

### Application blockers (fix first)

| ID | Severity | Status | Disposition |
| --- | --- | --- | --- |
| **A-01** Sources stuck `pending_validation` | **Critical** | **already fixed** (Batch 0) | Worker `validatePendingSources` calls `validateRtspSecret` each poll; writes `ready`/`invalid` + provenance. |
| **V-01** No adoption test for validation | High | **already fixed** (Batch 0) | Unit: pending → ready (and invalid) via worker loop; H4 claim residual asserted in control tests. |
| **A-02** Compose shares `.env` with web | High | **already fixed** (Batch 0) | Web: `.env` only. Worker: `.env` + `.env.worker`. Secrets documented in `.env.worker.example`. |
| Edge: claim-then-conflict | Medium | **already fixed** (Batch 0) | Create path clears claim before throwing `LIVE_SESSION_CONFLICT` after reclaim. |

### Verification / Phase 9 gate quality

| ID | Severity | Status | Disposition |
| --- | --- | --- | --- |
| A-03 Readiness bypasses app control plane | High | **fixed** (Batch 3–4) | Runner labeled `protocol_probe`; `yarn live-app-path-e2e` drives real APIs. Full-green app-path evidence [`live-app-path-e2e-appe2emtza5afr.json`](./live-app-path-e2e-appe2emtza5afr.json). |
| A-04 `report.ok` if no FAIL (NOT RUN OK) | High | **already fixed** (Batch 3) | `READY_STRICT=1` via `aggregateReadyGates`; smoke mode unchanged. |
| A-05 Split manifests / dirty HEAD | Medium | **already fixed** (Batch 3) | Manifest records dirty + `content_hash`; STRICT refuses dirty unless `READY_ALLOW_DIRTY=1`. |
| A-06 / V-03 / V-04 Substitute probes | Medium–High | **fixed** (Batch 3–4) | App-path script targets real APIs/media route; full search/Range/stop/reconnect **PASS** (`appe2emtza5afr`). Protocol soak remains labeled `protocol_probe`. |
| V-02 Manifest worktree identity | Medium | **already fixed** (Batch 3) | Same as A-05. |
| V-08 Aggregator untested | Low–Medium | **already fixed** (Batch 3) | Unit tests cover FAIL / NOT RUN / PASS_WITH_NOTES / dirty. |
| Lint FAIL / not configured | Low | **still open** | `yarn lint` → Next ESLint interactive setup. Add non-interactive eslint config or document lint as out-of-scope for MVP. **Disagree** that this blocks RTSP demo. |

### Runtime correctness (post-H1)

| ID | Severity | Status | Disposition |
| --- | --- | --- | --- |
| **A-07** Reconnect reuses playlist/segment names | High | **already fixed** (Batch 1) | Epoch-specific `fragments/e{N}/` + clear playlist + `-start_number`; reconnect test asserts path isolation (V-07). |
| A-08 No PTS/signature observation | Medium–High | **accept / defer** | Documented fixture-only limitation in `docs/live-video-operations.md` (constant `h264_aac_live`). Full fragment probe + epoch-on-discontinuity deferred past MVP gate. |
| **A-09** `window_end_at` uses last fragment PDT start | High | **already fixed** (Batch 1) | `computeWindowEndAt`: first PDT/start + PTS span (not last PDT alone). |
| A-10 Unbounded playlist / memory | Medium | **already fixed** (Batch 2) | Bound `hls_list_size`, prune consumed fragments/window IDs retaining overlap. **Partial objection:** product allows long forever-retain of **media/**; issue is **capture working set**, not retention policy. |
| **A-11** Index-ack enqueue ignores `accepted`/drops | High | **already fixed** (Batch 1) | Check enqueue result; persist drops via `onIndexAckDrops`; fail work on ack refusal (V-06). |
| **A-12** Index retry ignores `LIVE_INDEX_MAX_ATTEMPTS` | High | **already fixed** (Batch 1) | Persist attempt on ack items; terminal fail after budget. |
| A-13 Revision reservation (dup of M1) | Medium | **already fixed** (Batch 1) | Same fix as M1. |
| A-14 Recovery incomplete identity | Medium–High | **already fixed** (Batch 3) | Finalize/processed metadata restored via `buildRecoveryWorkItem` (V-05 unit). Full crash-matrix embed/index byte-equivalence still optional hardening. |
| A-15 Fingerprint unbound (dup of M3) | Medium | **already fixed** (Batch 1) | Same as M3. |
| A-16 Spool pressure does not free disk | Medium | **partially disagree** | Defaults are **unlimited** (locked). Cap path is buggy if operators set bytes — fix when caps > 0, but not a Phase 9 blocker under unlimited policy. |
| A-17 Config timeouts/reserve no-ops | Medium | **already fixed** (Batch 2) | Wired `LIVE_CONNECT_TIMEOUT_MS` (cleared on media progress), `LIVE_READ_TIMEOUT_MS` → ffconcat timeout µs, `LIVE_MANIFEST_RESERVE_BYTES` → append guard. |
| A-18 Embedding assert swallowed + dims 1024 | Medium | **already fixed** (Batch 1) | Fail closed on stack mismatch; session dims from `EMBED_DIMS` (M7). |
| A-19 Async `setInterval` not single-flight | Medium | **already fixed** (Batch 2) | Worker poll + fragment poll + session SSE single-flight; drain awaits idle. |
| A-20 No explicit-delete API | Medium | **already fixed** (Batch 4) | Ops age-delete + protect/keep ranges shipped: `POST /api/live/ops/age-delete` (dry_run default), protect-range CRUD under `/api/live/ops/protect-ranges`, index `live-video-protect-ranges`. Forever default; no silent DSL. Tests in `age-delete.test.ts`. Batch 5: pagination + ES-before-media + planned counters. |
| A-21 Unauthenticated Compose exposure | Medium | **accept / defer** (+ Batch 5 partial) | Auth deferred; Compose now defaults to `127.0.0.1` bind (`APP_BIND` override). |

---

## Explicit objections / pushbacks

1. **H1–H3 and M10 are fixed** — do not re-open as Phase 10 blockers; residual issues are A-07 (reconnect paths) and host-trust for ffconcat.
2. **M5 overstated** — first API patch already resets validation; second write is redundant.
3. **M9 `file` in whitelist** — needed for local ffconcat/`file` demuxer; do not drop blindly; nested `file:` in URLs already rejected.
4. **A-16 vs unlimited spool** — default policy is unlimited; “cap never recovers” matters only if operators set caps. Do not treat as retention-policy violation.
5. **A-20 reclaim** — forever default stands; ops age-delete + protect ranges are the planned reclaim path (not silent DSL). Soft free-space floor is separate.
6. **A-21 / M8 auth** — accepted for localhost demo MVP; production hardening gate, not adapter-start gate if demo stays loopback.
7. **Lint interactive failure** — tooling gap; does not mean live code is unsafe.
8. **A-05 / dirty HEAD** — evidence hygiene; does not invalidate unit/build green on the worktree under review.
9. **WHIP / multi-stream / age retention** — out of scope; any suggestion to reintroduce age-based retention conflicts with locked decisions.
10. **Code review § Traceability still says “runtime reconnect missing”** — outdated vs amendment; ignore that row.

---

## Recommended fix order (batches)

### Batch 0 — Unblock the application path (do first)

1. Worker pending-source validation loop calling `validateRtspSecret` → write `ready`/`invalid` + provenance (A-01). **Done 2026-09-12.**
2. Split Compose/web vs worker env files (A-02). **Done 2026-09-12.**
3. Clear claim on create conflict after reclaim (H4 residual). **Done 2026-09-12.**
4. Adoption test V-01. **Done 2026-09-12** (unit path; full HTTP E2E still Batch 3).
5. Soft free-space floor (`LIVE_SPOOL_MIN_FREE_BYTES`, default 50 GiB). **Done 2026-09-12.**

**Exit:** UI can create source → becomes ready → create/start session without seeding ES.

### A-20 retention redesign (documented 2026-09-12; not Batch 0)

Product clarification: reclaim is **not** limited to ad-hoc single-resource delete.

| Capability | Intent |
| --- | --- |
| **Age delete** | Ops-triggered delete of live data older than a threshold (e.g. > 1 day): ES chunk/event docs + local spool clip/thumb as applicable. Must **respect protect/keep ranges**. |
| **Protect / keep** | Pin a time period so age-delete skips it. Prefer **absolute UTC ranges** keyed by chunk `window_end_at` / media timestamps (session-scoped optional filter). Persist protect ranges as control documents (or source-scoped metadata), not silent DSL. |
| **Default** | Forever retention until explicit ops cleanup. No silent age DSL expiry. |
| **Orthogonal** | Soft free-space floor (50 GiB) pauses capture under disk pressure; it does **not** auto-delete. Age-delete is the reclaim path when operators choose to free space. |

Implementation deferred to a later turn (Batch 4 / retention APIs). Do not treat missing age-delete as a Phase 10 adapter prerequisite.

### Batch 1 — Correctness that corrupts search/time/identity

1. A-09 window end UTC (+ tests). **Done 2026-09-12.**
2. A-07 epoch-isolated capture paths (+ V-07). **Done 2026-09-12.**
3. A-11 ack enqueue acceptance / durable drop (+ V-06). **Done 2026-09-12.**
4. A-12 honor `LIVE_INDEX_MAX_ATTEMPTS`. **Done 2026-09-12.**
5. M1/A-13 revision CAS ordering. **Done 2026-09-12.**
6. M3/A-15 real `media_sha256`; M7/A-18 dims + fail-closed embed assert. **Done 2026-09-12.**
7. M2/A-14 `window_processed` + recovery metadata. **Done 2026-09-12** (Batch 3:
   `buildRecoveryWorkItem` + reducer fields; V-05 unit equivalence of durable fields).

**Exit:** critical Batch 1 items green under `yarn vitest run lib/live worker` (2026-09-12).

### Batch 2 — Stability / long-run

1. A-10 bound playlist + prune working set. **Done 2026-09-12.**
2. A-19 single-flight polls (worker, fragments, session SSE / M6). **Done 2026-09-12.**
3. M4 thumb promotion to `media/`. **Done 2026-09-12.**
4. A-17 wire or delete no-op config knobs. **Done 2026-09-12.**
5. Optional: A-08 signature/PTS probing (or document fixture-only limitation). **Still open** (deferred).

**Exit:** Batch 2 items green under `yarn vitest run lib/live worker` (2026-09-12).

### Batch 3 — Verification hygiene (before claiming Phase 9/10)

1. `READY_STRICT` + dirty/worktree hash (A-04/A-05/V-02/V-08). **Done 2026-09-12**
   (`lib/live/readiness-gates.ts` + unit tests; offline STRICT refuses NOT RUN).
2. Application-driven readiness path (A-03/A-06/V-03/V-04) — runner demoted to
   `evidence_class: protocol_probe`; `yarn live-app-path-e2e` added. **Partial
   2026-09-12** — driver landed; live HTTP E2E **blocked** by Elastic Cloud DNS
   on this host (see Batch 3 review).
3. Full 10-minute soak + Playwright (L5). **Soak PASS**
   ([`readymtzh2c5c`](./live-rtsp-readiness-readymtzh2c5c.json)); Playwright still
   **NOT RUN**.
4. Commit live implementation so evidence matches a revision. **Deferred**
   (user: no commit this turn); manifests record dirty `content_hash`.

**Exit evidence:** [`reviews/live-video-batch3-verification-2026-09-12.md`](./live-video-batch3-verification-2026-09-12.md).

### Batch 4 — A-20 retention + E2E unblock (2026-09-12/13)

1. **A-20** age-delete + protect/keep ranges. **Done** — see
   [`reviews/live-video-batch4-residuals-2026-09-12.md`](./live-video-batch4-residuals-2026-09-12.md).
2. E2E unblockers: `seq_no_primary_term` on list searches; connect-timeout not
   treated as stop; even proxy scale; E2E waiter reads `windows.searchable`;
   RRF `rank_window_size >= fetchSize`; EMFILE hygiene (FD raise + polling).
3. App-path full-green **PASS** ([`appe2emtza5afr`](./live-app-path-e2e-appe2emtza5afr.json)).
4. Strict 10-min soak **PASS** ([`readymtzh2c5c`](./live-rtsp-readiness-readymtzh2c5c.json))
   after HLS accumulate fix, build type fixes, latency budget/fault exclusion.
5. Playwright **NOT RUN**. A-08 deferred (documented).

### Batch 5 — Completion-review actionable bugs (2026-09-13)

1. Age-delete pagination + ES-before-media + dry-run planned counters (A-09/A-11). **Done**
2. Protect-range exhaustive paging for age-delete (A-10). **Done**
3. Public source create RTSP-only (A-15). **Done**
4. App-path mandatory PASS gates + resource cleanup (A-07/A-08). **Done**
5. Worktree identity hashes untracked bytes (A-03). **Done**
6. Compose loopback bind default (A-13 partial). **Done**
7. L2 public error messages + L3 event-intent seed fingerprint. **Done**

Evidence: [`reviews/live-video-batch5-residuals-2026-09-13.md`](./live-video-batch5-residuals-2026-09-13.md).
`yarn vitest run lib/live worker` → 34 files / 154 tests PASS.

### Still deferred (not Phase 10 adapter prerequisites)

- M8/A-21 auth + media IDOR hardening (loopback bind docs/compose now).
- L1 multi-instance query cache.
- A-16 / completion A-12 retained-media eviction when caps set (unlimited default).
- Phase 10 HLS/SRT/WHIP — **remain closed**.
- Playwright browser E2E; standalone tsc/lint gates; clean live commit.
- A-08 PTS/signature probe (documented fixture limitation).
- Protocol-probe resilience substitutes vs real worker fault inject (A-06).

---

## Phase 10 stance

Agree with readiness review: **keep Phase 10 closed**.

Disagree with treating **every** A-/V- item as equal entry criteria. Minimum to reopen Phase 10 discussion:

- Batch 0 complete (app path works),
- Batch 1 critical items (A-07, A-09, A-11, A-12, M1, M3) fixed or explicitly waived with tests,
- One readiness narrative that does not claim application E2E from the scratch runner.

---

## Mapping duplicates

| Code review | Readiness |
| --- | --- |
| M1 | A-13 |
| M2 | A-14 (part) |
| M3 | A-15 |
| M6 | A-19 (SSE) |
| M7 | A-18 (part) |
| M8 | A-21 |
| L5 | A-04/A-05 notes |
