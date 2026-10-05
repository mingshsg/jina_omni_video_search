# Reviews

Active reviews only. Each one has a follow-up tracker in `todo/`; the tracker,
not the review, is where open work lives — so archiving a review body never
loses an action item.

## Current — project level

- [`voice-integration-code-review-2026-10-05.md`](./voice-integration-code-review-2026-10-05.md)
  — **Scoped integration ready; acceptance remains open.** Current Group/Variant,
  scene linking and logos retained; 942 tests, host/container builds and scoped
  live voice/browser checks pass. → [`todo/59`](../todo/59-voice-integration-2026-10-05.md)

- [`update-publish-readiness-review-2026-10-05.md`](./update-publish-readiness-review-2026-10-05.md)
  — **Feature-branch publication ready; release gates remain open.** Final 851
  tests, Docker build and scoped browser checks pass; separate remediation,
  logo and Group auto-selection commits. → [`todo/58`](../todo/58-update-publish-2026-10-05.md)

- [`review-remediation-code-review-2026-10-04.md`](./review-remediation-code-review-2026-10-04.md)
  — **Scoped findings repaired; acceptance remains open.** Fresh retry generations,
  interrupted-run recovery, shared start guards, editor/ingest fixes, portable
  artifacts and vector identity. 846 tests/build, isolated live ES and scoped
  browser checks pass. Supersedes code dispositions in the two reviews below.
  → [`todo/55`](../todo/55-review-remediation-2026-10-04.md)

- [`branch-wide-bug-review-2026-10-04.md`](./branch-wide-bug-review-2026-10-04.md)
  — **No P1; five P2s.** Retry reuses the run ID and wipes that run's
  results; "stuck at running" has non-restart triggers; Group-only edits and
  the operator hint are lost to stale React callbacks; the ingest page locks
  after a failure. Eleven P3s. No code changed.
  → [`todo/54`](../todo/54-branch-wide-bug-review-2026-10-04.md)

- [`demo-path-bug-sweep-code-review-2026-10-03.md`](./demo-path-bug-sweep-code-review-2026-10-03.md)
  — **Normal demo path is clean; one conditional demo-breaker.** An app
  restart during an enrichment run leaves the UI stuck at "running" with no
  retry/start. Four minor visible glitches (duplicate Group option, false
  "no match" hint, script links download, wrong retry toast).
  → [`todo/53`](../todo/53-demo-path-bug-sweep-2026-10-03.md)

- [`trimmed-run-age-guard-and-scene-buttons-code-review-2026-10-02.md`](./trimmed-run-age-guard-and-scene-buttons-code-review-2026-10-02.md)
  — **One P2 and two P3s found, all fixed.** The age guard now fails closed
  on any unreadable entry instead of treating it as "nothing newer" (both
  the unreadable-subdirectory and vanished-mid-scan cases are reproduced as
  regression tests); the best-scoring moment can no longer be excluded from
  a long scene's button row; the stale duplicate docs are archived. Tests
  (809) and build pass.
  → [`todo/52`](../todo/52-trimmed-run-age-guard-and-scene-buttons-2026-10-02.md)

- [`run-history-followup-and-scene-link-code-review-2026-10-01.md`](./run-history-followup-and-scene-link-code-review-2026-10-01.md)
  — **No blocking issues.** Independent recheck of the earlier-run labeling,
  trimmed-run GC, and scene-linking commits that landed after `todo/50`'s
  fixes. → [`todo/51`](../todo/51-run-history-followup-and-scene-link-2026-10-01.md)

- [`drama-run-history-code-review-2026-10-01.md`](./drama-run-history-code-review-2026-10-01.md)
  — **Design sound; one P1 and three P2s found and fixed.** The live
  `video-assets` mapping was missing the new `meta.drama.runs` field (first
  write would have 500'd) — migrated and live-verified. A misleading
  subtitle count, unbounded run-history growth, and a build-breaking type
  error are also fixed. → [`todo/50`](../todo/50-drama-run-history-2026-10-01.md)

- [`existing-only-retry-recovery-review-2026-10-01.md`](./existing-only-retry-recovery-review-2026-10-01.md)
  — **The reported retry was recovered with explicit Auto + English.**
  EN/ZH each have 121 aligned, indexed cues; human subtitle quality review
  remains open. → [`todo/48`](../todo/48-existing-only-retry-recovery-2026-10-01.md)

- [`subtitle-view-and-failed-run-diagnostic-2026-10-01.md`](./subtitle-view-and-failed-run-diagnostic-2026-10-01.md)
  — **The reported EN+ZH failure was recovered with a host English transcript;
  subtitle viewing is added.** The same run now has 143 aligned cues in each
  language. Legacy retry guidance and human translation quality remain open.
  → [`todo/47`](../todo/47-subtitle-view-and-failed-run-2026-10-01.md)

- [`enrichment-and-hybrid-post-push-code-review-2026-10-01.md`](./enrichment-and-hybrid-post-push-code-review-2026-10-01.md)
  — **Small boundary and naming fixes are commit-ready; enrichment acceptance
  remains open.** Concurrent embedding rejection and injected eligibility
  configuration are repaired. Failed-state retry polling, long bilingual
  transcripts, and human subtitle quality still need work.
  → [`todo/46`](../todo/46-enrichment-and-hybrid-post-push-2026-10-01.md)

- [`pending-commits-readiness-review-2026-09-30.md`](./pending-commits-readiness-review-2026-09-30.md)
  — **Historical 17-commit hold; four P2 findings repaired.** Long CJK
  filenames, metadata-editor load failure, Group availability races, and
  encoded URL titles are fixed in the follow-up. The original review and its
  744-test result remain the pre-fix snapshot; current scoped gates are in
  `todo/43`.
  → [`todo/43`](../todo/43-pending-commits-readiness-2026-09-30.md)

- [`drama-implementation-followup-code-review-2026-09-28.md`](./drama-implementation-followup-code-review-2026-09-28.md)
  — **Follow-up fixes still need repair.** Strict asset mapping omits terminal
  drama fields; retry can retain stale subtitle cues; failed enrichment still
  shows success and batch results auto-clear; marker failure is not durable.
  Node 22 tests (546) and build pass; live/browser gates remain open.
  → [`todo/38`](../todo/38-drama-implementation-followup-2026-09-28.md)

- [`drama-system-adoption-recheck-2026-09-28.md`](./drama-system-adoption-recheck-2026-09-28.md)
  — **Improved but not acceptance-ready.** Rechecks `todo/36` fixes; retry
  duplicates subtitle generations, audit failures can publish synopsis,
  the ready-to-drama handoff is not fully durable, and partial/failed
  enrichment still gets a success UI. 526 tests and build pass; live gates
  remain open. → [`todo/37`](../todo/37-drama-system-adoption-recheck-2026-09-28.md)

- [`drama-episode-processing-adoption-code-review-2026-09-27.md`](./drama-episode-processing-adoption-code-review-2026-09-27.md)
  — **Drama adoption is structurally sound but not acceptance-ready.**
  Partial runs report success; subtitle/director coverage is truncated;
  audit, face verification, timing, and recovery need stronger gates.
  → [`todo/36`](../todo/36-drama-adoption-review-2026-09-27.md)
- [`voice-search-push-review-2026-10-02.md`](./voice-search-push-review-2026-10-02.md)
  — **voice branch pre-push review.** Fixed unfinished-HTTP shutdown and unexpected worker-kill cleanup paths; 536 tests / 17 Python lifecycle scenarios and build pass. Ready for draft PR publication; release gates remain open. → [`todo/56`](../todo/56-voice-search-push-review-2026-10-02.md)

- [`voice-asr-cancellation-implementation-review-2026-10-02.md`](./voice-asr-cancellation-implementation-review-2026-10-02.md)
  — **local ASR worker cancellation.** Compute deadline, disconnect/shutdown termination and capacity recovery pass; actual rebuilt app abort reaps the cached-model worker in 61ms. 536 tests/build pass; wider acceptance remains open. → [`todo/55`](../todo/55-voice-asr-cancellation-2026-10-02.md)

- [`voice-search-commit-review-2026-10-02.md`](./voice-search-commit-review-2026-10-02.md)
  — **voice branch commit review.** Fixed retained uploads and partial moment-result handling; 534 tests and build pass. Optional local ASR compute cancellation and release acceptance remain open. → [`todo/54`](../todo/54-voice-search-commit-review-2026-10-02.md)

- [`voice-search-implementation-review-2026-10-02.md`](./voice-search-implementation-review-2026-10-02.md)
  — **separate Voice tab and file-video voice service.** Node22 suite/build and scoped EIS/ASR/API/browser checks pass; microphone, labeled relevance, performance and deployment acceptance remain open. → [`todo/53`](../todo/53-voice-search-acceptance-2026-10-02.md)

- [`project-level-review-2026-09-23.md`](./project-level-review-2026-09-23.md)
  — **repository as a whole.** `next@14.2.35` carries a critical
  unauthenticated RCE (image optimizer route on by default, no 14.x patch
  exists); six P1s from `todo/22`/`todo/30` were built over for eleven
  commits and six new plans; `app/api`, `lib/embed` and `components` have
  zero tests; README predates the hybrid feature; 104 open items across 20
  trackers with no rollup. → [`todo/31`](../todo/31-project-level-review-2026-09-23.md)

## Current — hybrid metadata search

- [`group-search-followup-code-review-2026-09-30.md`](./group-search-followup-code-review-2026-09-30.md)
  — **Five local Group commits are not push-ready.** The older-asset Variant
  path, unresolved availability, draft-query request gate, and shared actor
  catalog error behavior need repair. Node 22 tests (653) and build pass;
  live/browser gates remain open.
  → [`todo/40`](../todo/40-group-search-followup-2026-09-30.md)

- [`group-search-and-backfill-code-review-2026-09-29.md`](./group-search-and-backfill-code-review-2026-09-29.md)
  — **Group search is wired but not acceptance-ready.** Variant/Group mismatch
  can silently exclude results; selection bounds and catalog failures need
  handling. Node 22 tests (616) and build pass; grouped live search and manual
  backfill writes remain unverified.
  → [`todo/39`](../todo/39-group-search-and-backfill-2026-09-29.md)

- [`suggest-imdb-and-source-boundary-code-review-2026-09-24.md`](./suggest-imdb-and-source-boundary-code-review-2026-09-24.md)
  — **Suggest source and URL safety.** The historical review identified
  credential-bearing URLs and uncited draft handling; the current disposition
  and remaining live/browser gates are in [`todo/33`](../todo/33-suggest-imdb-and-source-boundary-2026-09-24.md).

- [`suggest-metadata-editor-session-review-2026-09-23.md`](./suggest-metadata-editor-session-review-2026-09-23.md)
  — **`reference_urls`, todo/30 S6 citation relaxation, "Known as" alias
  editor + new `PATCH` route, image-search `filters` fix, UI fixes, and the
  Agent Builder prompt rebalance that unblocks IMDb.** Behavior is sound and
  five claims were verified against live infrastructure (mapping,
  persistence, alias-collision 409, deployed prompt, image search), but
  actor candidates were still *silently* discarded when uncited — the exact
  defect S6 existed to fix — and the tree bundles six unrelated concerns
  plus pre-existing third-party work. **P1 and all P2/P3 code findings fixed
  the same day; only the commit-split items (R5/R5a) remain open.**
  → [`todo/32`](../todo/32-suggest-metadata-editor-session-2026-09-23.md)

- [`hybrid-suggest-pipeline-review-2026-09-23.md`](./hybrid-suggest-pipeline-review-2026-09-23.md)
  — **Suggest pipeline.** Write-safety holds (never writes, cancellation safe,
  no secret leak) but the trust boundary does not: failure is displayed as
  success, an *ambiguous* agent answer is auto-applied with a fabricated 0.7
  confidence, fetched page content can be parsed as the agent payload, and an
  unauthenticated route writes model-derived aliases into the search hot path.
  → [`todo/30`](../todo/30-suggest-pipeline-review-2026-09-23.md)
- [`hybrid-metadata-search-independent-code-review-2026-09-23.md`](./hybrid-metadata-search-independent-code-review-2026-09-23.md)
  — **Whole worktree.** Gates are green but do not cover the highest-risk
  path: the guaranteed-recall floor sends `retriever` in an `_msearch` body
  the installed client does not type (`as never` suppresses it), reachable
  only through a silent `catch`, with no test and no live-cluster evidence.
  → [`todo/22`](../todo/22-hybrid-independent-code-review-2026-09-23.md)
- [`hybrid-code-recheck-2026-09-23.md`](./hybrid-code-recheck-2026-09-23.md)
  — independent re-confirmation of the three `todo/22` P1s against current
  source. Supersedes the status wording of the archived phase reviews.
- [`hybrid-metadata-search-holistic-review-2026-09-23.md`](./hybrid-metadata-search-holistic-review-2026-09-23.md)
  — cross-phase verdict and the exact local-only Suggest internet boundary.
  → [`todo/16`](../todo/16-hybrid-holistic-review-and-internet-suggest-2026-09-23.md)
- [`hybrid-internet-suggest-code-review-2026-09-23.md`](./hybrid-internet-suggest-code-review-2026-09-23.md)
  — Agent Builder / Jina tool wiring for Phase 4b. → [`todo/16`](../todo/16-hybrid-holistic-review-and-internet-suggest-2026-09-23.md)
- [`hybrid-suggest-post-rebuild-smoke-2026-09-23.md`](./hybrid-suggest-post-rebuild-smoke-2026-09-23.md)
  — post-rebuild smoke evidence for the Suggest path.

## Archive

`reviews/archive/` holds resolved and superseded reviews. It is **on disk but
not tracked by Git** (`.gitignore`), so it does not appear in diffs, clones or
PR reviews. Treat it as a local record: a fresh clone will not have it.

| Folder | Contents |
| --- | --- |
| `2026-09-10-file-video-search/` | readiness rounds and E2E verification for the original file-video baseline |
| `2026-09-10-live-video-planning/` | superseded live-video architecture and readiness planning rounds |
| `2026-09-12-live-video-code-and-readiness-reviews/` | Phase 1–9 code review and Phase 10 readiness review |
| `2026-09-13-live-video-implementation/` | live-video batch reports, RTSP/E2E run manifests, completion audits — the feature shipped in `93425bc` |
| `2026-09-22-hybrid-planning/` | hybrid plan review rounds 1, 2 and the r3 readiness review; corrections landed in `2043ada` |
| `2026-09-22-hybrid-phase-reviews/` | per-phase hybrid implementation reviews and their fix reports, superseded by the holistic review and the recheck above |

## Policy

- A review produces two files: `reviews/<scope>-<kind>-<YYYY-MM-DD>.md` and a
  numbered `todo/NN-<scope>-<YYYY-MM-DD>.md`. Add the review here on top.
- Review bodies are evidence and are never edited. Supersede them with a new
  dated review instead.
- Move a review to `archive/` when its scope has shipped or a later review has
  superseded it. Open items stay in `todo/`, which is tracked — so archiving
  is safe.
- Keep run artifacts (`*.json` manifests) with the review that produced them.
