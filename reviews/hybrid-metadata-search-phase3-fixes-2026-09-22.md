# Hybrid Phase 3 review — fixes applied (2026-09-22)

Source:
[`reviews/hybrid-metadata-search-phase3-implementation-review-2026-09-22.md`](./hybrid-metadata-search-phase3-implementation-review-2026-09-22.md).

## P1

| Finding | Disposition |
| --- | --- |
| Mixed name+scene drops actor BM25 | **Fixed** — `findContainedAliases` + `actorKeysForQuery`; BM25 phrases each contained catalog alias. Tests cover `Audrey Hepburn running`. |
| Failed lexical expansion still applies text boost | **Fixed** — on expansion failure after BM25 success, clear `lexical` and set `text_channel_status=failed` so fusion uses global vector candidates only. |

## P2

| Finding | Disposition |
| --- | --- |
| Serial floor / global kNN | **Fixed** — global visual/audio via `Promise.all`; floor via one `msearch` per modality. |
| Two-groups-per-video diversity | **Fixed** — `groupSearchHitsTopK` prefers ≤2 groups/video, relaxes when too few videos, backfills if needed. |
| Branch diagnostics | **Improved** — `embed_ms`/`embed_calls`, separate `knn_global_ms`/`knn_lexical_ms`, `es_http_requests` / `es_subsearches` / `es_attempts`; empty eligibility returns a `branch` record. Live p50/p95 measurement still open. |

## Still open (acceptance)

- App-side embed vs EIS builder cosine ≈ 1
- Labeled Recall@5 / equal-budget hybrid on/off
- Representative p50/p95 under load
- Facet-boost scoring + UI chips (started in Phase 3.5)

Follow-up todo: [`todo/08-hybrid-phase3-implementation-review-2026-09-22.md`](../todo/08-hybrid-phase3-implementation-review-2026-09-22.md).
