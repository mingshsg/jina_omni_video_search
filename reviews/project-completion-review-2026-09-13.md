# Project completion review — 2026-09-13

This document helps maintainers decide which parts of the video-search project
are delivered, which claims are currently supportable, and what remains before
the live-video branch can be called complete.

## Verdict

**The project is not complete.**

The preserved file-video baseline remains the completed product slice. The
live-video branch contains a substantial RTSP implementation and credible
evidence that a controlled localhost RTSP fixture has worked end to end, but it
is not a finished repository deliverable:

- almost all live-video implementation is still untracked at HEAD `78d7e56`;
- the current acceptance artifacts do not identify the untracked code they ran;
- browser E2E is absent even though the operations document names it as a
  completion condition;
- HLS, SRT, and any WHIP work in Phase 10 have not started;
- several runtime and operations defects remain, including destructive cleanup
  limits and ordering, finite spool-cap behavior, and unauthenticated network
  exposure;
- lint is not configured and the standalone TypeScript check fails.

The accurate current label is: **RTSP localhost MVP implemented and previously
demonstrated, but not completion-ready; Phase 10 and production/shared-network
readiness are incomplete.**

## Completion matrix

| Scope | Status | Basis |
| --- | --- | --- |
| File-video search baseline | Complete at preserved baseline | Archived Phase 10/11 evidence through commit `78d7e56`; this review did not repeat the remote file-video acceptance run |
| Live RTSP code path | Implemented | Routes, UI, worker, capture, embedding, indexing, follow search, playback, recovery, and retention code exist in the worktree |
| Controlled localhost RTSP demonstration | Demonstrated previously, not current-tree certified | App-path manifest `appe2emtza5afr` reports PASS; 10-minute protocol manifest `readymtzh2c5c` reports PASS, but they cover different dirty-tree hashes and neither hash binds untracked file contents |
| Live RTSP completion gate | Not met | Browser E2E is NOT RUN; evidence is split; real worker fault recovery is not exercised by the protocol probe; work is not committed |
| Phase 10 protocols | Not started | HLS/LL-HLS and SRT are unchecked; WHIP implementation is not selected or built |
| Production/shared-network use | Not ready | Single-process assumptions, no auth, all-interface Compose publishing, unpinned/root worker image, and deferred media-signature detection |

## Current-run verification

| Check | Result | Evidence |
| --- | --- | --- |
| Unit suite | PASS WITH NOTES | Serial rerun: 45 files and 214 tests passed. The first run, executed concurrently with the build, timed out in `spool-paths.test.ts`; that test and the full suite passed when rerun serially. This is a resource-sensitive/flaky-test signal. |
| Production build | PASS | `yarn build` completed in 291.75 seconds and emitted all live routes. |
| Standalone TypeScript | FAIL | `yarn tsc --noEmit --pretty false`: 28 errors in test sources, including required `NODE_ENV`, stale `PrepareFiniteMediaResult` fixtures, and a tuple-index error. |
| Lint | FAIL / not configured | `CI=1 yarn lint` opens Next's interactive ESLint setup and exits 1. |
| Diff whitespace | PASS | `git diff --check`. |
| Compose parse | PASS | `docker compose config --quiet`. |
| Fresh external RTSP/app E2E | NOT RUN | Review was read-only; the prior state-changing Elastic/MediaMTX evidence was inspected rather than rerun. |
| Browser E2E | NOT RUN | No Playwright dependency or browser test is present. |

Pre-review worktree identity was branch `live-video-search`, HEAD
`78d7e569edc3f975e1b96199d14bf0a87c93a15a`, dirty, with the repository's
reported hash `d9c5c9a580010285`. The two cited acceptance artifacts record
`22a962456fa60e94` and `e34df09870ff350a` respectively.

## Adversarial findings

### A-01 — The declared project scope still contains unstarted protocols

- **Location:** `todo/01-live-video-search-todo.md:236-254`
- **Trigger condition:** Completion is judged against the repository's full live-video plan.
- **Guard:** Either implement and accept HLS/SRT/selected WHIP work, or explicitly cut a release scope that ends at the RTSP MVP.
- **Potential consequence:** “Project complete” is interpreted as including adapters that do not exist.

### A-02 — The live implementation is not represented by the branch commit

- **Location:** repository identity (`git status --short`, HEAD `78d7e56`)
- **Trigger condition:** A clone, checkout, CI job, or release uses the named branch revision.
- **Guard:** Commit the reviewed live implementation, then run acceptance against that clean revision.
- **Potential consequence:** The checked-out commit contains the file-video baseline, not the reviewed live feature.

### A-03 — Dirty-worktree hashing omits untracked file contents

- **Location:** `scripts/worktree-identity.ts:19-30`
- **Trigger condition:** An untracked live source file changes without its path changing.
- **Guard:** Hash a deterministic archive or patch containing tracked, staged, and untracked file bytes; add a mutation test for an untracked file.
- **Potential consequence:** Different live implementations can produce the same alleged `content_hash`.

### A-04 — Phase 9 evidence is split across incompatible worktree identities

- **Location:** `todo/01-live-video-search-todo.md:226-227`; `reviews/live-app-path-e2e-appe2emtza5afr.json`; `reviews/live-rtsp-readiness-readymtzh2c5c.json`
- **Trigger condition:** The stated “same commit and run manifest” gate is applied.
- **Guard:** Produce one acceptance manifest, or a signed parent manifest, that links every mandatory sub-run to one clean commit and exact artifact hashes.
- **Potential consequence:** Passing results from different dirty trees are combined into a completion claim.

### A-05 — Strict readiness excludes the browser gate that documentation makes mandatory

- **Location:** `lib/live/readiness-gates.ts:18-30`; `docs/live-video-operations.md:267,274-276`
- **Trigger condition:** `READY_STRICT=1` runs while Playwright remains NOT RUN.
- **Guard:** Add the browser/application gate to `MANDATORY_READY_GATES`, or revise the documented acceptance contract and release scope consistently.
- **Potential consequence:** The strict runner exits successfully while a documented mandatory gate is absent.

### A-06 — The Resilience PASS does not exercise recovery in the real worker pipeline

- **Location:** `scripts/live-rtsp-readiness.ts:436-500,582-710,922-929`
- **Trigger condition:** The protocol runner is treated as proof of active-session disconnect, worker restart, and slowdown handling.
- **Guard:** Inject each fault while the real `LiveWorkerLoop` session is running and assert epoch, queue, retry, gap, event, and resumed-search behavior through public APIs.
- **Potential consequence:** Real recovery can regress while the substitute probes remain green.

### A-07 — The application E2E can report `ok: true` with incomplete gates

- **Location:** `scripts/live-app-path-e2e.ts:535-599,620-639`
- **Trigger condition:** Terminal wait becomes `PASS_WITH_NOTES`, reconnect is skipped, or another gate is NOT RUN without any FAIL row.
- **Guard:** Define mandatory application gates and require every one to be exactly PASS before setting `report.ok`.
- **Potential consequence:** A partial app run can be published as full-green evidence.

### A-08 — The application E2E leaves durable test state behind

- **Location:** `scripts/live-app-path-e2e.ts:362-617`
- **Trigger condition:** A run succeeds or fails after creating a source/session/query handle.
- **Guard:** Track created resources and stop/disable/delete or uniquely expire them in `finally`; verify cleanup in the manifest.
- **Potential consequence:** Repeated runs pollute Elastic control/data streams and failed runs can leave desired-running sessions for a later worker.

### A-09 — Age-delete silently processes only the first 5,000 old documents

- **Location:** `lib/live/age-delete.ts:105-151,256-270`
- **Trigger condition:** More than 5,000 eligible chunks or events exist.
- **Guard:** Page with PIT plus `search_after` (or another bounded complete traversal), expose continuation state, and test multiple pages.
- **Potential consequence:** Cleanup reports success while old vectors, events, and media remain indefinitely.

### A-10 — Age-delete silently ignores protect ranges after the first 500

- **Location:** `lib/live/protect-range-repository.ts:76-100`
- **Trigger condition:** More than 500 global or session-relevant protect ranges exist.
- **Guard:** Query only overlapping ranges and page every match before deleting any candidate.
- **Potential consequence:** A protected chunk/event outside the first page can be permanently deleted.

### A-11 — Media is removed before Elasticsearch deletion succeeds

- **Location:** `lib/live/age-delete.ts:284-310` followed by document deletion
- **Trigger condition:** `deleteByQuery` or per-document deletion fails after local unlink.
- **Guard:** Use a durable deletion intent/tombstone, delete or hide the search document first, then reclaim media with retryable reconciliation.
- **Potential consequence:** Search results remain but their clip and thumbnail return missing-media errors.

### A-12 — A configured retained-media cap still does not reclaim retained media

- **Location:** `lib/live/session-supervisor.ts:642-695`
- **Trigger condition:** `LIVE_RETAINED_MEDIA_MAX_BYTES` is nonzero and indexed media reaches the cap.
- **Guard:** Separate pending-drop from retained-media eviction, reclaim eligible retained media, persist the outcome, and remeasure before accepting the next window.
- **Potential consequence:** The worker drops queued work or fails while retained usage stays over the configured limit.

### A-13 — Destructive live APIs are published on all host interfaces without authentication

- **Location:** `docker-compose.yml:14-35`; `app/api/live/ops/age-delete/route.ts:31-56`
- **Trigger condition:** Docker Compose runs on a LAN-reachable host with default port publishing.
- **Guard:** Bind `127.0.0.1:${APP_PORT:-3000}:3000` for the demo and require authentication/authorization before any shared-network deployment.
- **Potential consequence:** Another host can control capture, retrieve media, or invoke irreversible age-delete.

### A-14 — The worker image is neither reproducibly pinned nor hardened as documented

- **Location:** `worker/Dockerfile:1-26`; `todo/01-live-video-search-todo.md:59-60`; `docs/live-video-operations.md` Security checks
- **Trigger condition:** The worker image is rebuilt or deployed outside the trusted developer host.
- **Guard:** Pin the base by digest and FFmpeg package/version, use a non-root runtime stage, read-only application files, dropped capabilities, and a bounded writable spool.
- **Potential consequence:** Builds drift and a media-parser compromise receives unnecessary container privileges.

### A-15 — Public source creation accepts protocols the worker cannot validate

- **Location:** `app/api/live/sources/route.ts:13-19`; `lib/live/worker-loop.ts:346-361`
- **Trigger condition:** A client creates an HLS or SRT source before Phase 10 exists.
- **Guard:** Restrict the public enum to RTSP until an adapter is enabled, or return a synchronous stable unsupported-protocol error.
- **Potential consequence:** A valid-looking 201 response becomes asynchronously invalid and overstates supported capability.

### A-16 — Codec/audio/PTS discontinuity detection remains fixture-specific

- **Location:** `docs/live-video-operations.md` A-08 known limitation; `todo/01-live-video-search-todo.md:271`
- **Trigger condition:** A real camera changes codec, resolution, audio presence, or timestamps without disconnecting.
- **Guard:** Probe finalized fragments, persist actual signatures/PTS, and open a new epoch on discontinuity.
- **Potential consequence:** Windows can span incompatible media and receive incorrect time attribution.

### A-17 — Normal verification misses TypeScript errors and has no noninteractive lint gate

- **Location:** `package.json:6-24`; live test sources reported by `tsc`
- **Trigger condition:** CI runs only `yarn test` and `yarn build`, as the current readiness runner does.
- **Guard:** Add `typecheck` and configured ESLint scripts to mandatory verification; repair the 28 current test-source errors.
- **Potential consequence:** Test helpers and fixtures drift from production contracts without failing acceptance.

### A-18 — Current documentation contradicts the worktree and omits the latest review

- **Location:** `README.md:10-15`; `docs/live-video-architecture.md:3`; `docs/live-video-data-flow.md:3`; `todo/01-live-video-search-todo.md:48-49,229-234`; `reviews/README.md:3-21`
- **Trigger condition:** A maintainer uses the primary docs to decide current status or find latest evidence.
- **Guard:** Replace planning-era statuses, update the Phase 9 evidence paragraph, and keep the current review/evidence index newest-first.
- **Potential consequence:** Readers see mutually incompatible claims: planned, Phase 9 landed, soak outstanding, and Batch 4 PASS.

## Edge-case Hunter findings

| Location | Trigger condition | Guard snippet | Potential consequence |
| --- | --- | --- | --- |
| `lib/live/protect-range-repository.ts:89-100` | More than 500 protect ranges match | `pageOverlappingProtectRangesUntilExhausted()` | Protected data can be deleted |
| `lib/live/age-delete.ts:256-270` | More than 5,000 old documents match | `while (page.length) search_after = page.at(-1).sort` | Cleanup silently remains partial |
| `lib/live/age-delete.ts:284-310` | Elasticsearch delete fails after unlink | `persistIntent(); deleteDoc(); unlink(); reconcile()` | Search points to missing media |
| `lib/live/age-delete.ts:158-160` | Dry-run returns deletion counters | `return { would_delete: docs.length, deleted: 0 }` | Operators misread simulated deletion as executed |
| `scripts/live-app-path-e2e.ts:535-639` | Terminal wait expires without FAIL | `status = terminal ? 'PASS' : 'FAIL'` | Incomplete stop still reports success |
| `scripts/live-app-path-e2e.ts:594-623` | Reconnect is intentionally skipped | `mandatoryGate('Reconnect', status)` | Partial run still reports success |
| `scripts/live-app-path-e2e.ts:607-617` | Failure occurs after session creation | `finally { await stopCreatedSessions() }` | Later worker resumes stale test session |
| `lib/live/session-supervisor.ts:653-695` | Retained cap exceeds with no queued item | `evictRetainedOrStopBeforeRemux()` | Capture fails without reclaiming space |
| `app/api/live/sources/route.ts:13-19` | Client submits HLS or SRT | `z.literal('rtsp')` until adapters ship | Accepted source becomes asynchronously invalid |
| `scripts/worktree-identity.ts:19-30` | Untracked file bytes change only | `hash(unifiedDiffIncludingUntrackedBytes)` | Evidence identity remains unchanged |

## Verification Gap findings

### V-01 — Worktree identity has no verification for untracked-content changes

- **Location:** `scripts/worktree-identity.ts:16-37`
- **Trigger condition:** The evidence hash is expected to bind a dirty live implementation.
- **Guard:** Add a test that creates an untracked file, mutates only its bytes, and requires a different hash.
- **Potential consequence:** Acceptance evidence cannot be reproduced against the reviewed source.
- **Gap shape:** broken-verification-gap
- **Consumer:** readiness manifests written by `scripts/live-rtsp-readiness.ts` and `scripts/live-app-path-e2e.ts`
- **Evidence:** Repository search found both consumers and no test importing `collectWorktreeIdentity`.

### V-02 — Browser completion is documented but not enforced

- **Location:** `lib/live/readiness-gates.ts:18-30`
- **Trigger condition:** Browser E2E stays NOT RUN under `READY_STRICT`.
- **Guard:** Include a browser/application gate in the mandatory list and add an aggregation test for its NOT RUN state.
- **Potential consequence:** Strict acceptance remains green without the UI workflow.
- **Gap shape:** broken-verification-gap
- **Consumer:** completion rule in `docs/live-video-operations.md:274-276`
- **Evidence:** `readiness-gates.test.ts` exercises mandatory statuses, but Browser E2E is not a mandatory member.

### V-03 — Resilience substitutes do not observe real session recovery

- **Location:** `scripts/live-rtsp-readiness.ts:436-500,582-710`
- **Trigger condition:** Disconnect/restart/slowdown handling regresses in `LiveWorkerLoop` or `SessionRuntime`.
- **Guard:** Fault the active application-path run and assert resumed searchability, epochs, retries, events, and media.
- **Potential consequence:** The current protocol flags remain true despite a broken real recovery path.
- **Gap shape:** broken-verification-gap
- **Consumer:** worker/session behavior claimed by the Resilience gate
- **Evidence:** Capture stops before publisher bounce; worker restart calls a separate smoke; slowdown runs in the probe's manual loop.

### V-04 — Age-delete tests cover one small success case only

- **Location:** `lib/live/age-delete.test.ts:99-228`
- **Trigger condition:** Pagination, more than 500 protections, partial ES failure, or retry reconciliation is broken.
- **Guard:** Add multi-page, protection-overflow, ES-failure-before/after-unlink, idempotency, and continuation assertions.
- **Potential consequence:** A destructive path can lose protected media or silently leave old data.
- **Gap shape:** regression-gap
- **Consumer:** `POST /api/live/ops/age-delete`
- **Evidence:** The test uses three chunks, two events, one protect range, and a successful memory client.

### V-05 — Finite spool-cap behavior is not tested through the supervisor

- **Location:** `lib/live/session-supervisor.ts:642-695`
- **Trigger condition:** A nonzero pending or retained cap is reached during live capture.
- **Guard:** Drive `SessionRuntime` over each cap and assert reclaimed bytes, durable drops, and stable state transitions.
- **Potential consequence:** The documented optional configuration can fail only in deployment.
- **Gap shape:** missing-adoption-gap
- **Consumer:** `LIVE_PENDING_SPOOL_MAX_BYTES` and `LIVE_RETAINED_MEDIA_MAX_BYTES`
- **Evidence:** `spool-paths.test.ts:59-75` verifies pressure classification only; the single supervisor test does not exercise finite caps.

### V-06 — Passing tests and Next build do not cover the standalone type contract

- **Location:** `package.json:6-24`
- **Trigger condition:** A test fixture no longer satisfies the production type it mocks.
- **Guard:** Add `yarn typecheck` to the normal and strict gates.
- **Potential consequence:** Twenty-eight current TypeScript errors remain invisible to the advertised green suite.
- **Gap shape:** broken-verification-gap
- **Consumer:** live unit-test fixtures and future refactors
- **Evidence:** `yarn test` and `yarn build` pass; `yarn tsc --noEmit --pretty false` fails.

### V-07 — Container acceptance records fixture images, not the live worker image

- **Location:** `worker/Dockerfile:1-26`; readiness manifest `containers`
- **Trigger condition:** The worker container's Node/FFmpeg build drifts or runs with unexpected privileges.
- **Guard:** Build/probe the actual worker image and record its digest, UID, filesystem/capability policy, FFmpeg build, and protocol surface in the acceptance manifest.
- **Potential consequence:** Fixture containers are pinned while the deployed capture worker remains unverified.
- **Gap shape:** missing-adoption-gap
- **Consumer:** Docker Compose `live-worker`
- **Evidence:** `readymtzh2c5c` records MediaMTX and publisher FFmpeg digests; no worker-image digest/capability record is present.

## Editorial findings

Purpose/audience read: the TODO and current review set should let a maintainer
see the current decision, open work, and evidence without reconstructing a
multi-day implementation diary. The closest structure model is
**Strategic/Context (pyramid)**.

Word metrics: TODO 2,328 words; Batch 4 review 714 words; README 906 words.

| Pass | Original Text | Revised Text | Changes |
| --- | --- | --- | --- |
| structure | `todo/01-live-video-search-todo.md` — completed Phases 1–9 plus batch diary (about 1,900 words) | CONDENSE to a current completion matrix and open checklist; move dated verification narratives to a linked status history | Front-loads actionable state; estimated reduction 850–1,050 words (36–45% of TODO) |
| structure | `reviews/live-video-batch4-residuals-2026-09-12.md` — residual qualifications begin after the PASS headline | MOVE the exact scope qualifier and NOT RUN gates directly below the verdict | Prevents the scoped Batch result from being read as project completion; no material word change |
| structure | `reviews/README.md` — Batch 4 evidence absent from active list | MOVE latest completion review and Batch 4 evidence to the top, newest first | Restores the index's stated current-review purpose; adds about 25 words |
| prose | “Phase 10 remains closed.” | “Phase 10 has not started; HLS/SRT/WHIP await a product-scope decision.” | Replaces an ambiguous workflow metaphor with observable status |
| prose | “full-green `live-app-path-e2e`” | “application-path API E2E passed; browser E2E remains NOT RUN” | Names the tested boundary and preserves the explicit exception |
| prose | README: “full 10-minute soak ... still outstanding” | “The 2026-09-13 protocol probe completed a 10-minute soak; see the current completion review for remaining gates.” | Removes a stale status sentence and directs readers to current evidence |

Six editorial recommendations would reduce the reviewed status material by
about 825–1,025 words overall. The main tradeoff is less inline history in the
TODO; preserve that history in dated reviews rather than deleting it.

## Required closure conditions

- Decide and document whether “complete” ends at RTSP or includes Phase 10.
- Commit the live implementation, then regenerate one clean-revision acceptance
  manifest that binds all inputs and every mandatory sub-run.
- Make browser/application E2E mandatory and exercise real active-session fault
  recovery.
- Correct age-delete pagination, protect-range completeness, deletion ordering,
  and audit semantics.
- Correct finite spool-cap behavior or reject nonzero caps until implemented.
- Bind Compose to loopback for the unauthenticated demo; add auth before any
  shared-network use.
- Pin and harden the actual worker image and include it in acceptance evidence.
- Add noninteractive lint and standalone typecheck gates and make both pass.
- Implement A-08 before claiming general-camera compatibility.
- Reconcile README, live architecture/data-flow statuses, TODO, and review index.

Machine-readable findings are in
[`project-completion-review-2026-09-13.json`](./project-completion-review-2026-09-13.json).
