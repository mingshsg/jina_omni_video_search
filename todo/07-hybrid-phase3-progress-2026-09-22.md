# Hybrid Phase 3 progress — 2026-09-22

Plan: [`plan/03-hybrid-metadata-search-plan.md`](../plan/03-hybrid-metadata-search-plan.md).  
Main todo: [`todo/02-hybrid-metadata-search-todo.md`](./02-hybrid-metadata-search-todo.md).

## Done

- [x] App-side fusion helpers (`lib/es/hybrid-fusion.ts`) with `w_text=0.4`,
      lexical window, guaranteed floor sizing, stable tie-breaks
- [x] Hybrid retrieval path (`lib/es/hybrid-search.ts`): ready-ID allow-list,
      BM25 assets, global knn + two-stage lexical chunk expand, fusion
- [x] `POST /api/search`: optional `hybrid.use_text`; no schema `.default` on
      `sort_by`; defaults after hybrid is known; response meta + hit fields
- [x] Search UI: “Include text (hybrid)” switch, hybrid score label,
      `metadata_match` badge
- [x] Live keeps rejecting `sort_by=hybrid` (`parseLiveSearchSortBy`)
- [x] Docs: `docs/api-contract.md` Phase 3 hybrid section

## Still open (blocks Phase 3 complete)

- [ ] Prove app-side query embedding ≈ EIS `query_vector_builder` (cosine ≈ 1)
- [ ] Labeled query Recall@5 / ranking gates on the live fixture
- [ ] Stage p50/p95 vs latency budget; ES request count under load
- [ ] Broader regression (visual/audio/both, image, live) smoke
