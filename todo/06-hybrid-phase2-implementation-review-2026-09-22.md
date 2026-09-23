# Hybrid Phase 2 implementation review follow-up — 2026-09-22

Review: [Phase 2 implementation review](../reviews/hybrid-metadata-search-phase2-implementation-review-2026-09-22.md).

- [x] **P1:** Reject `total > 10000` even when `relation=eq`; fail closed on ambiguous totals. Test 10,000 / 10,001 / larger scopes.
- [x] **P1:** Never omit a non-empty invalid year from the UI request; show validation and block or surface the server's 400. Test UI-to-request behavior.
- [x] **P2:** Add `SearchFacets` to image search and send multipart filters, or explicitly defer image-UI facets in the Phase 2 acceptance scope.
- [x] **P2:** Validate image multipart `size`, `variant_id`, and `video_id` with the same constraints as JSON; reject invalid values instead of truncating/defaulting.
- [ ] Add route/integration tests for empty eligibility before embedding, actor ID across scripts, explicit-video conflict, image JSON/multipart filters, lookup failure, and no chunk leakage.
- [ ] Measure p50/p95 kNN and request size with a large eligible-ID prefilter before freezing the 10,000 limit.
- [ ] Re-run the repository TypeScript gate and record a sign-off disposition for unchanged live-test errors.
