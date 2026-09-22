# Round-3 hybrid-search readiness follow-up — 2026-09-22

Review: [round-3 readiness findings](../reviews/hybrid-metadata-search-readiness-review-r3-2026-09-22.md).
Scope: plan corrections before the affected phase; implementation has not begun.

- [x] **Phase 1 / G1:** relocate and package the person catalog outside ignored/media `data/`; container-load acceptance.  
      → relocated to `config/people.json`; Dockerfile copies `config/`; built-container load is an acceptance gate
- [x] **Phase 1–2 / G2:** define person-ID PATCH/GET/search DTO, ambiguous-name handling, and actor facet semantics.  
      → client sends `actor_ids` only (`400 META_UNKNOWN_ACTOR_ID`); server derives display/aliases/keys; facet is `filters.actor_ids` ANY; no free-text names in MVP
- [x] **Phase 1 / G3:** handle `_update` version races separately from stale `meta.revision`; test ingest/editor interleaving.  
      → transport version conflict vs semantic revision mismatch separated; bounded `retry_on_conflict` on **both** writers (safe: never retries a script-thrown mismatch); 409 only for stale `expected_revision`
- [x] **Phase 2–3 / G4:** reconcile ready-variant ID enforcement on unfiltered hybrid global retrieval.  
      → ready-ID allow-list now applied whenever hybrid is on, with or without facets; only the default pure-vector path keeps today's unfiltered behavior
- [x] **Phase 3 / G5:** guarantee a BM25-selected asset's candidate minimum or change its acceptance gate.  
      → two-stage lexical expansion — guaranteed floor (`msearch`, top `G=min(5,A)` × 2 chunks) then pooled fill; pooled-only was unsound
- [x] **Phase 3 / G6:** make name-only detection available before optional parsing, or defer the special behavior and retain honest scene labels.  
      → Phase 3 uses a labelling contract needing no detector; `scene_terms_present` + vector down-weight moved to Phase 3.5
- [x] **Phase 3.5–3.6 / G7:** correct Rule 0 and specify extracted-boost scoring; sync English/Chinese/todo.  
      → Rule 0 corrected — parser shapes query *inputs* and proposes boosts, but cannot read results, assign scores, reorder hits, or write user-visible text; boost formula and `w_facet`=0.2 published
- [x] **Phase 3.5 / G8:** tie description embeddings to the metadata revision/content and define stale/failure behavior.  
      → `description_embedding_meta` with `source_revision`/`source_digest`/`state`; publish only if revision still matches; query only `state: current`
- [ ] Freeze labeled relevance fixtures and thresholds before Phase-3 tuning; probe actual analyzer and EIS capabilities before using optional services.
- [ ] Re-review revised plan and move the readiness verdict only when affected gates are closed with evidence.

## Disposition — 2026-09-22

All eight findings verified against the repository before acting; all eight
were valid. Five (G2, G4, G5, G6, G7) were regressions introduced by my own
edits in the preceding rounds, not pre-existing gaps:

- G2 listed `actor_ids` as server-derived while the editor was specified to
  store IDs, and the search example still filtered on free-text `actors`.
- G4 was a latency optimization that silently created two different
  visibility contracts.
- G5 replaced a correct per-asset `msearch` with a pooled query that cannot
  satisfy the acceptance gate it was written under.
- G6 demanded a flag at a phase where nothing could compute it.
- G7 overstated the invariant to the point of forbidding the parser's purpose.

Corrections are in the plan, todo, and Chinese summary. Still open and
unchanged: labeled relevance fixtures gate Phase 3, the ~50-pair parse set
gates Phase 3.6, and the analyzer/EIS probes must run before the mapping is
frozen or the parser enabled.
