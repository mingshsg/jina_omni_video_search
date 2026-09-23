# Holistic review + Phase 4a/4b prerequisite fixes — 2026-09-23

Source: [`hybrid-metadata-search-holistic-review-2026-09-23.md`](./hybrid-metadata-search-holistic-review-2026-09-23.md), [`plan/04-internet-grounded-metadata-suggest.md`](../plan/04-internet-grounded-metadata-suggest.md), [`todo/14`](../todo/14-hybrid-phase4a-4b-review-2026-09-22.md).

## Implemented now (code)

| ID | Change |
| --- | --- |
| **F4-01** | Description/abstract values are short title clues only; caveats moved to `evidence` (not BM25/semantic text). |
| **F4-02** | Suggest merges values + provenance atomically via `formRef` + single source/evidence maps (no cross-updater mutation). |
| **F4-03** | Save sends **dirty fields only**; load restores `review` → fieldSources/provenance so later Saves do not relabel unchanged suggestions as manual. |
| **F4-04** | Suggest uses `AbortController` + 8s timeout; Cancel Suggest; Save stays enabled while Suggest runs. |
| **F4-05** | Per-field evidence/confidence shown in form helpText; PATCH accepts `field_provenance`; mapping adds `review.*.evidence`. |
| **F4-06** | Title cleanup: leading indexes, Official Trailer / trailing Trailer decorations, trailer-over-movie precedence, keep “Interview with …”. |
| **F4-08** | Caller language labeled `caller_hint` (confidence 0.3); `media_tag` only when `verified: true`. |
| **Embed lifecycle** | Publish checks ES `result !== 'noop'` before claiming published; timeout schedules one delayed retry. |

## Not implemented now (need ops / labeled eval / network)

- Internet Suggest / Jina MCP / Agent Builder (`plan/04` packages 2–5)
- Full durable embed job across process restarts
- Live browser + indexed POST→PATCH→search acceptance
- External catalog license/spike and Phase 4b precision gates

## Verification

- `yarn test`: 57 files / **335+** tests (after provenance tests)
- Mapping upgrade needed for `review.*.evidence` on existing clusters (`scripts/setup-indices` / mapping diff path)
