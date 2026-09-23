# Phase 3 implementation review follow-up — 2026-09-22

Review: [`reviews/hybrid-metadata-search-phase3-implementation-review-2026-09-22.md`](../reviews/hybrid-metadata-search-phase3-implementation-review-2026-09-22.md).

- [x] P1: Preserve exact actor-alias retrieval in mixed name-plus-scene queries (`findContainedAliases` / `buildBm25Should`).
- [x] P1: Failed lexical expansion clears lexical prior → global-vector-only scoring.
- [x] P2: Batch global kNN (`Promise.all`) and floor kNN (`msearch`); record HTTP / subsearch / attempt counts.
- [x] P2: Prefer ≤2 temporal groups per video when others can fill top-k; relax + test.
- [x] P2: Embedding + separate global/lexical timings; empty-eligibility `branch`.
- [ ] Acceptance: embed cosine ≈ 1.0 vs EIS; labeled Recall@5; p50/p95 under load; broad regression.
