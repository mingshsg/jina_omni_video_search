# Hybrid Phase 1 implementation review follow-up — 2026-09-22

Source: [Phase 1 implementation review](../reviews/hybrid-metadata-search-phase1-implementation-review-2026-09-22.md).

- [x] **P1:** Make every advertised `primary_language` value round-trip through PATCH; add a catalog-wide contract test (`zh-Hans`/`zh-Hant` currently fail).
- [x] **P1:** Recursively validate/add nested `meta.*` mapping children; fail on incompatible existing types, analyzers, and `copy_to`; test partial migration and rerun.
- [x] **P2:** Normalize tags before validation; whitespace-only tags must clear or fail, not save an empty confirmed value.
- [x] **P2:** Distinguish exhausted Elasticsearch update-version conflicts from stale `meta.revision` in API response and docs (`META_TRANSPORT_CONFLICT`).
- [x] Decide whether bounded catalog-alias backfill belongs to Phase 1; implement it or mark it explicitly deferred in the main todo.
      → **Deferred to Phase 5** (recorded in `todo/02`).
- [ ] Run built-image catalog load and metadata editor save/clear/reload smoke; verify no secrets or media paths in the GET DTO.
- [ ] Add integration tests for PATCH 404/409/bootstrap/clear and interleaved ingest/editor updates on a disposable index; verify metadata and chunk vectors survive.
- [ ] Resolve or explicitly waive the repository-wide TypeScript errors in unchanged live-video tests; make lint noninteractive; clear `git diff --check` before sign-off.
      → `docs/data-model.md` trailing whitespace cleared; live-test `tsc` / lint gates remain waived for this track.
