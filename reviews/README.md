# Reviews

## Hybrid metadata search

- [`hybrid-metadata-search-independent-code-review-2026-09-23.md`](./hybrid-metadata-search-independent-code-review-2026-09-23.md)
  — **current worktree verdict**: gates are green but do not cover the
  highest-risk path. The G5 guaranteed floor sends `retriever` in an
  `_msearch` body the installed client does not type (`as never` suppresses
  it), is reachable only through a silent `catch`, and has no test or
  live-cluster evidence. Three P1 items before commit.
  [Follow-up](../todo/22-hybrid-independent-code-review-2026-09-23.md).
- [`hybrid-internet-suggest-code-review-2026-09-23.md`](./hybrid-internet-suggest-code-review-2026-09-23.md)
  — **current Internet Suggest verdict**: dedicated agent/tools are live and local fallback is safe, but timeout mismatch, unvalidated agent output, shadowed grounded descriptions, and missing actor-candidate UI block Phase 4b sign-off. [Follow-up](../todo/16-hybrid-holistic-review-and-internet-suggest-2026-09-23.md).
- [`hybrid-metadata-search-holistic-review-2026-09-23.md`](./hybrid-metadata-search-holistic-review-2026-09-23.md)
  — current cross-phase verdict and exact local-only Suggest internet boundary; [internet-grounded plan](../plan/04-internet-grounded-metadata-suggest.md) and [follow-up](../todo/16-hybrid-holistic-review-and-internet-suggest-2026-09-23.md).
- [`hybrid-metadata-search-phase4a-4b-post-rebuild-review-2026-09-22.md`](./hybrid-metadata-search-phase4a-4b-post-rebuild-review-2026-09-22.md)
  — **post-rebuild verdict**: app image and read-only Suggest route pass; 26-asset title probe confirms disclaimer-heavy drafts and no year/type/tag coverage; prior 4a/4b findings stay open. [Follow-up](../todo/14-hybrid-phase4a-4b-review-2026-09-22.md).
- [`hybrid-metadata-search-phase4a-4b-review-2026-09-22.md`](./hybrid-metadata-search-phase4a-4b-review-2026-09-22.md)
  — **current Phase 4a/4b verdict**: local Suggest is implemented, but search contamination, provenance loss, stalled-request handling, and unmeasured Phase 4b quality gates prevent sign-off. [Follow-up](../todo/14-hybrid-phase4a-4b-review-2026-09-22.md).
- [`hybrid-metadata-search-phase3-3.5-3.6-review-2026-09-22.md`](./hybrid-metadata-search-phase3-3.5-3.6-review-2026-09-22.md)
  — **current combined implementation verdict**: prior Phase 3 actor retrieval is repaired, but facet score scale, semantic candidate recall, EIS disambiguation, partial-search failures, and acceptance gates block Phase 3/3.5/3.6 sign-off. [Follow-up](../todo/11-hybrid-phase3-3.5-3.6-review-2026-09-22.md).
- [`hybrid-metadata-search-phase3-implementation-review-2026-09-22.md`](./hybrid-metadata-search-phase3-implementation-review-2026-09-22.md)
  — earlier Phase 3 findings; code fixes are recorded in [`hybrid-metadata-search-phase3-fixes-2026-09-22.md`](./hybrid-metadata-search-phase3-fixes-2026-09-22.md). Remaining acceptance work is tracked in the [Phase 3 follow-up](../todo/08-hybrid-phase3-implementation-review-2026-09-22.md).
- [`hybrid-metadata-search-phase2-implementation-review-2026-09-22.md`](./hybrid-metadata-search-phase2-implementation-review-2026-09-22.md)
  — **current Phase 2 implementation verdict**: live facet query shape works
  on the small fixture, but exact-threshold overflow and UI year handling
  violate filter completeness. [Follow-up](../todo/06-hybrid-phase2-implementation-review-2026-09-22.md).
- [`hybrid-metadata-search-phase1-implementation-review-2026-09-22.md`](./hybrid-metadata-search-phase1-implementation-review-2026-09-22.md)
  — **current Phase 1 implementation verdict**: live mapping and one indexed
  metadata example verified; language validation and mapping-upgrade defects
  plus missing integration/container gates prevent completion sign-off.
  [Follow-up](../todo/05-hybrid-phase1-implementation-review-2026-09-22.md).
- [`hybrid-metadata-search-readiness-review-r3-2026-09-22.md`](./hybrid-metadata-search-readiness-review-r3-2026-09-22.md)
  — **current verdict** for the expanded round-3 plan: not ready end to end;
  catalog deployment, actor API, metadata-write races, ready-only retrieval,
  candidate guarantee, name-only behavior, and optional parser/vector lifecycle
  need correction. **All eight findings (G1–G8) were verified and corrected in
  the plan on 2026-09-22**; the review body is unchanged as evidence and the
  dispositions are in
  [`todo/04-hybrid-search-readiness-r3-2026-09-22.md`](../todo/04-hybrid-search-readiness-r3-2026-09-22.md).
- [`hybrid-metadata-search-plan-review-r2-2026-09-22.md`](./hybrid-metadata-search-plan-review-r2-2026-09-22.md)
  — historical round-2 development-readiness review of the earlier
  plan. H01–H08 all resolved; **ready to start Phase 1 now**, Phase 2 after one
  query-shape change, Phase 3 after settling the text weight, the ranking
  acceptance gate, and query-embedding path equivalence. Adds
  [`reference/elastic-asset-metadata-and-bounded-retrieval.md`](../reference/elastic-asset-metadata-and-bounded-retrieval.md).
- [`hybrid-metadata-search-plan-review-2026-09-22.md`](./hybrid-metadata-search-plan-review-2026-09-22.md)
  — round-1 plan review: sound direction; revise candidate recall, metadata
  persistence, ranking/score contracts, migration, filtering, and
  scene-evidence semantics before implementation sign-off. Its corrections are
  now recorded in
  [`plan/03-hybrid-metadata-search-plan.md`](../plan/03-hybrid-metadata-search-plan.md);
  implementation and measurement remain open in
  [`todo/02-hybrid-metadata-search-todo.md`](../todo/02-hybrid-metadata-search-todo.md).

Active live-video reviews at this level:

- [`live-video-batch6-residuals-2026-09-13.md`](./live-video-batch6-residuals-2026-09-13.md)
  — Batch 6 fix report for program-correctness actionable bugs after Phase 10
  (PATCH transport, age-delete partial/truncated, query preserve, HLS auth +
  capability, SRT passphrase/listener honesty, Phase 10 fixture lockdown).
- [`program-correctness-completion-review-2026-09-13.md`](./program-correctness-completion-review-2026-09-13.md)
  — superseding current-worktree audit: **not complete**; RTSP localhost MVP is
  substantial, while delivery gates and Phase 10 protocol correctness/evidence
  remain open. Machine-readable findings:
  [`program-correctness-completion-review-2026-09-13.json`](./program-correctness-completion-review-2026-09-13.json).
- [`live-video-batch5-residuals-2026-09-13.md`](./live-video-batch5-residuals-2026-09-13.md)
  — historical Batch 5 fix report for completion-review bugs (age-delete safety,
  RTSP-only create, app-path gate honesty, loopback Compose, L2/L3). Phase 10
  was still closed when that report was written; use Batch 6 + the superseding
  review above for current status.
- [`project-completion-review-2026-09-13.md`](./project-completion-review-2026-09-13.md)
  — prior whole-project completion audit: **not complete** as a release claim; RTSP
  localhost MVP implemented/demonstrated with remaining delivery/evidence gaps.
  Machine-readable findings:
  [`project-completion-review-2026-09-13.json`](./project-completion-review-2026-09-13.json).
- [`live-video-batch4-residuals-2026-09-12.md`](./live-video-batch4-residuals-2026-09-12.md)
  — Batch 4 implementation evidence: A-20, application-path E2E, and 10-minute
  protocol probe.
- [`live-video-review-triage-2026-09-12.md`](./live-video-review-triage-2026-09-12.md)
  — **current action plan**: code + readiness review triage vs worktree
  (statuses, objections, fix batches). Prefer this over archived finding dumps.
- [`live-video-batch3-verification-2026-09-12.md`](./live-video-batch3-verification-2026-09-12.md)
  — Batch 3 readiness hygiene (**PASS WITH NOTES**); STRICT aggregator proven;
  app-path E2E / 10-min soak blocked by Elastic Cloud DNS on this host.
- [`live-rtsp-readiness-2026-09-11.md`](./live-rtsp-readiness-2026-09-11.md)
  — Phase 9 RTSP end-to-end readiness (**PASS WITH NOTES**); JSON manifests
  `live-rtsp-readiness-readymtx3xg5w.json` (protocol) and
  `live-rtsp-readiness-readymtxc7oky.json` (build/offline).
- [`live-video-planning-review-2026-09-10.md`](./live-video-planning-review-2026-09-10.md)
  — planning-readiness verdict, review-comment dispositions, and
  implementation gates.
- [`live-feasibility-spike-2026-09-10.md`](./live-feasibility-spike-2026-09-10.md)
  — earlier MediaMTX/FFmpeg latency spike (superseded by Phase 9 readiness).
- [`plan-live-video-search-2026-09-10.md`](./plan-live-video-search-2026-09-10.md)
  — planning-era plan review retained for history.

## Archived review sets

- [`archive/2026-09-12-live-video-code-and-readiness-reviews/`](./archive/2026-09-12-live-video-code-and-readiness-reviews/)
  — Phases 1–9 code review and Phase 10 readiness/function review
  (2026-09-12); superseded as working documents by the triage above.
- [`archive/2026-09-10-file-video-search/`](./archive/2026-09-10-file-video-search/)
  — readiness rounds, responses, E2E verification, and self-review for the
  completed file-video search baseline through commit `78d7e56`.
- [`archive/2026-09-10-live-video-planning/`](./archive/2026-09-10-live-video-planning/)
  — superseded architecture and development-readiness review rounds retained as
  planning history.

Archive policy:

- move resolved or superseded reviews into a dated folder;
- preserve filenames and content;
- keep active findings at the top level until resolved;
- add current-run evidence as a new dated review instead of rewriting history.
