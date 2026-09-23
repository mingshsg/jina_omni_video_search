# Hybrid Phase 2 review — fixes applied (2026-09-22)

Source review:
[`reviews/hybrid-metadata-search-phase2-implementation-review-2026-09-22.md`](./hybrid-metadata-search-phase2-implementation-review-2026-09-22.md).

## P1 / P2 findings

| Finding | Disposition |
| --- | --- |
| Overflow at exactly 10,001 eligible assets | **Fixed** — `interpretEligibleTotal` rejects `total > 10000` regardless of `relation`; fail-closed on ambiguous totals. Covered in `lib/metadata/search-filters.test.ts`. |
| Non-integer year silently dropped in UI | **Fixed** — `facetsToApiFilters` returns `{ ok: false, error }` for non-integers / reversed bounds; text + image pages block submit. |
| Image search UI missing facets | **Fixed** — `/search-image` reuses `SearchFacets` and sends multipart `filters`. |
| Multipart image validation weaker than JSON | **Fixed** — shared zod bounds for `size` / `variant_id` / `video_id`. |

## Still open (from review)

- Route/integration tests for empty eligibility, cross-script actors, lookup failure, chunk isolation.
- Large allow-list kNN p50/p95 before freezing the 10k cap.
- Repo-wide `tsc` disposition for pre-existing live `ProcessEnv` fixture errors (unchanged by Phase 2/3).

Phase 3 implementation started after these fixes; see
[`todo/07-hybrid-phase3-progress-2026-09-22.md`](../todo/07-hybrid-phase3-progress-2026-09-22.md).
