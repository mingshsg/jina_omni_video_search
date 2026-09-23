# Phase 3 / 3.5 / 3.6 review follow-up — 2026-09-22

Review: [`reviews/hybrid-metadata-search-phase3-3.5-3.6-review-2026-09-22.md`](../reviews/hybrid-metadata-search-phase3-3.5-3.6-review-2026-09-22.md).  
Fixes: [`reviews/hybrid-metadata-search-phase3-3.5-3.6-fixes-2026-09-22.md`](../reviews/hybrid-metadata-search-phase3-3.5-3.6-fixes-2026-09-22.md).

- [x] **P1:** Reconcile the plan and implementation facet formula so an inferred facet is genuinely weaker than BM25/scene evidence; add rank-order and unrelated-video negatives.
- [x] **P1:** Expand chunks for semantic-only assets missing from global and BM25 candidate pools; retain readiness/variant filters and test recovery.
- [x] **P1:** Let valid EIS null/empty fields clear dictionary guesses; add disambiguation tests for actor, type, country, year, vector residual, and free text.
- [x] **P1:** Detect failed/missing `msearch` floor items and assert the text-channel status, global-only fallback, and per-asset floor.
- [x] **P2:** Enforce active embedding provider/model/task/dims for `state=current` semantic vectors; verify migration/reindex and provider-change behavior.
- [x] **P2:** Derive `parse.applied` and `no_effect` from actual candidate matches; define parser-only behavior, handle snapshot failures, and implement or remove `QUERY_PARSER_FACET_MODE=filter`.
- [x] **P2:** Reconcile EIS skipping with unknown-phrase generalization using a labeled set; keep latency and over-trigger gates.
- [x] **P2:** Validate EIS actor IDs against the prompt's candidate set, not just the full person catalog.
- [x] **P2:** Bound or queue description embedding after PATCH and reconcile stale vectors after unrelated revision advances; test rapid edits and failures.
- [x] **P2:** Account for speculative/residual embedding calls and zero-eligibility cost in response metrics.
- [x] **P2:** Repair the two new `AppConfig` test fixtures and rerun TypeScript/build.
- [ ] **Acceptance:** Run semantic and EIS paths on configured disposable/live fixtures, embedding-equivalence check, labeled video/scene Recall@5 and parse over-trigger set, representative p50/p95, and broad UI/file/image/live regression before phase completion.
