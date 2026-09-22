# Hybrid metadata search — second-round plan review (development readiness)

Date: **2026-09-22**  
Round: **2** — re-review of the revised plan after
[`hybrid-metadata-search-plan-review-2026-09-22.md`](./hybrid-metadata-search-plan-review-2026-09-22.md)  
Scope: [`plan/03-hybrid-metadata-search-plan.md`](../plan/03-hybrid-metadata-search-plan.md)
(revised), [`todo/02-hybrid-metadata-search-todo.md`](../todo/02-hybrid-metadata-search-todo.md),
[`chn.docs/混合元数据检索规划.md`](../chn.docs/混合元数据检索规划.md), reviewed against
branch `live-video-search`, HEAD `93425bc`.  
Implementation reviewed: **none** — this feature is still a plan. The existing
file/live search implementation was read to check the plan's assumptions.

## Verdict

**READY TO START PHASE 1. Phases 2–3 are ready in design but carry four
quantified risks that should be settled before or during implementation, not
after.**

All eight findings from round 1 (H01–H08) are genuinely resolved, not merely
acknowledged. I re-derived the central claims rather than taking them on trust,
and the two that mattered most hold up:

- **The two-path candidate design is correct.** Because kNN `_score` with
  `similarity: cosine` is a pure function of the query and document vectors, it
  is corpus- and filter-independent. Sorting the union of a modality's hits by
  raw score therefore produces a coherent ordering in which lexically injected
  candidates land below the global window unless approximate search genuinely
  missed them. The plan's step 4 is sound, and the recovery case it promises
  does work (worked example below).
- **The write-ownership design is the right one.** Guarding on
  `meta.revision` inside a script — rather than document-level
  `if_seq_no` — is the only approach that lets ingest progress writes and
  editor writes coexist without false conflicts. That is a non-obvious call and
  the plan got it right.

The plan is also honest in the places that matter: it labels every numeric
budget provisional, separates relevant-video recall from correct-scene recall,
and refuses to claim that cast metadata proves a person appears at a timestamp.

What follows is not a rejection of the design. R1–R4 are risks I can quantify
now that would otherwise be discovered late, plus six small implementation
traps where the plan states a contract the current code shape cannot express.

## What I verified (evidence)

| Plan claim | Verified against | Result |
| --- | --- | --- |
| `video-assets` is `dynamic: strict`, `title` is `text` + `.keyword` | `lib/es/indices.ts:22-93` | **Confirmed.** BM25 on root `title^2` works with no mapping change. |
| `upsertAsset` replaces the whole document; `persistJob` calls it | `lib/es/index-assets.ts:69-80`, `lib/ingest/job-store.ts:244,286-288,476` | **Confirmed.** Metadata loss is real without the Phase 1 change. |
| Library listing caps at 100/500 and must not be the facet source | `lib/es/list-assets.ts:65,71` | **Confirmed.** |
| Asset-by-ID route implements DELETE only | `app/api/library/[videoId]/route.ts:11` | **Confirmed.** GET and `/meta` are new. |
| Executor returns only `size` hits | `lib/es/search-core.ts:269` (`primary.slice(0, size)`) | **Confirmed.** Full-window return is a required change, and the plan says so. |
| Shared helpers also serve live search | `lib/live/search.ts:4,163,231,242` uses `executeChunkSearch`; `SearchSortBy` exported from `search-core.ts:6` | **Confirmed** — see T-3. |
| `copy_to` must be fully qualified under a strict mapping | Elastic `copy_to` reference | **Confirmed.** `"meta.search_text"` is correct; a bare name would throw `strict_dynamic_mapping_exception`. |
| New fields can be added to a strict mapping in place | Elastic explicit-mapping reference | **Confirmed.** Also confirms the decision *not* to add `copy_to` on root `title` (that would be a change to an existing field and would need a backfill). |
| Country catalog is 20 options | Plan lines 69–72 | **Confirmed** — 8 EU + 5 East Asia + 6 ASEAN + US = 20. English and Chinese docs agree. |
| Candidate cap arithmetic "≤ 400" | 2 × (100 + 20×5) | **Confirmed.** |
| Baseline test suite | `yarn test` | **PASS** — 47 files, 243 tests. |

**NOT RUN:** any hybrid runtime behaviour, mapping migration, metadata
PATCH, relevance measurement, or latency measurement. None of it exists yet.

## Quantified risks to settle (R1–R4)

### R1 — P1: `w_text = 1` is not a neutral default; on this catalog it will dominate

**Where:** plan lines 158–165 (formula and provisional weights), 397.

Work through the arithmetic of
`score_hybrid = Σ_m w_m/(60 + rank_m) + w_text/(60 + rank_asset)`:

| Term | Range |
| --- | --- |
| Text (`rank_asset` 1…20) | `1/61 = 0.01639` … `1/80 = 0.01250` |
| One modality (`rank_m` 1…200) | `1/61 = 0.01639` … `1/260 = 0.00385` |

The text term's *entire* range sits at or above the top of the modality term's
range. In other words, **merely being in the BM25 top-20 is worth roughly as
much as being the single best visual match.** For the default
`modality: visual` (a single channel), text is ~50% of the total score.

Worked recovery case (the plan's own acceptance gate): asset A is BM25 rank 1;
its best chunk `c` is absent from the global window (`W = 50`), so after union
sorting `c` gets modality rank ≈ 51.

- `c`: `1/(60+51) + 1/(60+1)` = 0.00901 + 0.01639 = **0.02540**
- Best pure-visual chunk `g` (global rank 1, no metadata match): **0.01639**

The gate passes — `c` is recovered. But it passes *too well*: a visually
mediocre chunk outranks the single best visual match in the corpus. Scaled up,
20 BM25 assets × 2 permitted groups = 40 metadata-boosted slots ahead of any
non-matching video, so for `size: 5` the page is entirely BM25-asset videos.

**This is sharper on the actual demo catalog.** `data/proxies` holds **36**
video directories. A top-20 lexical window is **56% of the catalog**, so
"being in the top 20" carries almost no information — yet it confers the
largest single score term. On a small catalog this default converts hybrid
search into "metadata search with vector tie-breaking".

**Recommend:** start `w_text` at **0.3–0.5**, not 1.0; and size the lexical
window relative to the catalog (e.g. `min(20, max(5, ceil(0.2 × eligible)))`)
or require a minimum BM25 score so a weak lexical match earns no prior. Record
the above arithmetic in the plan so the tuning exercise starts from a
hypothesis rather than from scratch.

### R2 — P1: The second acceptance gate cannot detect the failure R1 describes

**Where:** plan lines 439–441; todo line 64.

> "a visually relevant asset without metadata remains **eligible**"

Eligibility is trivially satisfied — the global path always includes it. The
gate will pass even if every metadata-matching video outranks it. Restate as a
*ranking* assertion, for example: "for a pure-scene query with no name or
title terms, the top-3 hybrid results match the top-3 visual-only results" and
"a no-metadata asset that is visual rank 1 remains in the hybrid top-3."

Pair it with the inverse guard so tuning has two sides to balance.

### R3 — P2: Hidden round-trip cost on the interactive path

**Where:** plan lines 197–199 (500-ID pages) and 146–150 (per-asset expansion).

Two parts of the critical path are more expensive than the plan's "two ES
round-trips" framing suggests:

1. **ID enumeration.** Paging 10,000 IDs at 500 per page is **up to 20
   sequential round trips** before embedding even starts. It is also
   unnecessary: `index.max_result_window` is 10,000, which is exactly the
   plan's own cap, so a single request suffices —
   `size: 10000`, `_source: false`, `track_total_hits: 10001`. Asset `_id`
   **is** the `video_id` (`upsertAsset` uses `id: doc.video_id`), so no field
   fetch is needed, and `total.relation: "gte"` is an exact, cheap overflow
   signal for `FILTER_SCOPE_TOO_LARGE`. Keep PIT + `search_after` in reserve
   for a future cap above 10,000.
2. **Per-asset expansion.** "At most 5 best chunks per asset per modality" for
   20 assets cannot come from one kNN — a single kNN returns a global top-k.
   As written it implies an `msearch` of 20 queries per modality, i.e. **20–40
   kNN executions per user search**. Cheaper: one kNN over the 20-asset ID set
   with `k = 100`, then cap per asset in the application. Distribution is
   uneven, but the per-video group cap already handles that.

Also add actual numeric latency budgets. The plan requires measuring p50/p95
but never states a target, so the performance gate has no pass condition.

Details and query shapes: `reference/elastic-asset-metadata-and-bounded-retrieval.md` §4.

### R4 — P2: Switching to app-side query embedding changes the non-hybrid baseline

**Where:** plan lines 140, 148 ("Embed the text query once", "with the same
query embedding"). **Code:** `lib/es/search.ts:135-159`.

`resolveQueryVectorMode` returns a **`query_vector_builder`** for the `eis`
provider — inference runs inside Elasticsearch and the application never sees
the vector. Reusing one embedding across branches therefore requires the
hybrid path to use `embedTextQueryVector` (already present, added for live
search) instead.

That is the right move, but it means hybrid and non-hybrid runs of the *same
query text* go through two different inference paths: `{ input: [text] }`
app-side via `provider.embedText(query, 'query')` versus
`query_vector_builder: { inference_id, input }` server-side. If those produce
even slightly different vectors, every "hybrid on/off at the same candidate
budget" comparison in the acceptance plan is confounded.

**Add** a Phase 3 precondition: assert cosine similarity ≈ 1.0 between the two
paths for a sample of queries, or switch the file text path to app-side
embedding wholesale and re-baseline. Note this also changes where inference
cost is billed and removes one ES round trip.

## Implementation traps (T-1 … T-6)

Small, concrete, cheap to fix now.

| # | Trap | Detail |
| --- | --- | --- |
| **T-1** | `sort_by` default blocks the stated contract | Plan lines 311–317 require distinguishing *omitted* `sort_by` from *explicit* `visual`. `app/api/search/route.ts:17` declares `sort_by: z.enum([...]).optional().default('visual')`, so after parsing the two are indistinguishable. Drop the `.default()` and apply defaulting after `hybrid.use_text` is known. |
| **T-2** | `meta.revision` bootstrap undefined | Existing assets have **no `meta` object**. The plan specifies the conflict compare but not the first-edit case. Define `expected_revision = 0` ⇒ "no metadata yet", script creates `meta` with `revision = 1`; anything else is 409. |
| **T-3** | `lib/live/search.ts` missing from the touch list | Plan lines 406–417 list `lib/es/search.ts`/`search-core.ts` but not `lib/live/search.ts`, which imports `executeChunkSearch` and the shared `SearchSortBy` union (`search-core.ts:6`). Adding `'hybrid'` to that union ripples into `parseLiveSearchSortBy`. The acceptance list mentions live regression; the touch list should too. |
| **T-4** | Partial update replaces arrays wholesale | Switching ingest to a partial `_update` still rewrites the entire `variants` array (arrays are replaced, not merged). Harmless — callers already merge in memory — but state it so nobody expects element-level merging. Use `retry_on_conflict` on the *ingest* writer only; never on the metadata PATCH, which must surface 409. |
| **T-5** | `meta.search_text` must exist before the first `meta.actors` write | Under `dynamic: strict`, `copy_to` to a non-existent field is an **error**, not a silent skip. Order the migration: mapping first, then enable writes. |
| **T-6** | Evidence snippets must not read `meta.search_text` | `copy_to` content is absent from `_source`. The plan says this once (line 362); make it a UI acceptance item so highlights are wired to original fields. |

## Round-1 findings: disposition

All eight are resolved in the revised plan. Verified individually:

| ID | Resolution | Verdict |
| --- | --- | --- |
| H01 | Independent global + lexical candidate paths; explicit "never use BM25 IDs to restrict the global path" (lines 129–150); diagram updated | **Resolved** |
| H02 | Field ownership table, ingest partial updates, scripted revision guard, no upsert, 404/409, `refresh=wait_for` (lines 262–272); `job-store.ts` added to touch list | **Resolved** |
| H03 | Explicit formula, application-side, stated as *not* an ES join, no double counting of fused channels, stable tie breaks, diversity cap (lines 98–101, 151–174) | **Resolved** (see R1 on the weight value) |
| H04 | Retrieval modality separated from ranking mode; `score_kind=hybrid_rrf`; per-modality scores retained; legacy defaults preserved; image search excluded from text (lines 311–327) | **Resolved** (see T-1) |
| H05 | `object` not `nested`; explicit `review` children; fully qualified `copy_to`; root `title` queried directly to avoid backfill; idempotent mapping upgrade with conflict reporting; `.keyword` dropped on long text (lines 40–57, 344–363) | **Resolved** |
| H06 | Dedicated paginated ID query, 10k cap, `FILTER_SCOPE_TOO_LARGE`, AND/ANY semantics, inclusive years, missing-value rule, image JSON + multipart, distinct failure behaviour per branch (lines 182–204, 303–309) | **Resolved** (see R3 on mechanism) |
| H07 | Explicit "not proof" language (lines 166–174), separate asset/scene evidence labels, separate Recall@5 metrics with a 50%-overlap rule (lines 421–432) | **Resolved** (see R2 on gate wording) |
| H08 | Generation deferred to Phase 4b behind a separate provider decision; Phase 4a is local deterministic clues only; per-field `review.source`/`confirmed`/`confidence`; draft-merge and late-response rules (lines 208–236) | **Resolved** |

Smaller round-1 items — import deferred, safe GET DTO, tags narrowed to no
implicit boost, series/episode deferred, validation bounds, `year` = release
year and `country` = production country, `ignore_above` wording corrected,
optional v2 vectors given a lifecycle — are all addressed. The Chinese summary
is synchronised with the English plan, including the 20-option catalog and the
evidence-boundary paragraph.

## Readiness by phase

| Phase | Ready to start? | Blocking condition |
| --- | --- | --- |
| **1 — Schema + edit** | **Yes, now** | None. Apply T-2, T-4, T-5. Self-contained and independently valuable; it is the highest-value, lowest-risk slice. |
| **2 — Facets** | **Yes** | Adopt the single-request enumeration in R3 before writing the paginator. |
| **3 — Hybrid** | **Design ready; hold on defaults** | Settle R1 (weight), R2 (gate wording), R4 (embedding-path equivalence) first. Assemble the labeled set (todo Phase 0, still `[ ]`) — Phase 3 cannot be evaluated without it. |
| **4a — Local Suggest** | Yes, optional | Correctly decoupled from core search. |
| **4b — Generative Suggest** | Correctly blocked | Provider decision outstanding by design. |
| **5 — Scale-outs** | Deferred | Appropriate. |

**Recommended order:** Phase 1 → Phase 2 → assemble the labeled set → Phase 3.
The one open Phase 0 item (labeled queries with expected video IDs *and* time
intervals) is the real gate on Phase 3, because every tuning decision in R1
and every threshold in the acceptance section depends on it. Building it before
Phase 3 rather than during is the difference between tuning and guessing.

## Reference document added

| File | Why |
| --- | --- |
| [`reference/elastic-asset-metadata-and-bounded-retrieval.md`](../reference/elastic-asset-metadata-and-bounded-retrieval.md) | Strict-mapping evolution (what can be added in place vs what needs reindex), `copy_to` rules under `dynamic: strict`, partial vs scripted updates and why field-level concurrency beats `if_seq_no` here, `max_result_window`/`max_terms_count`, per-asset top-N retrieval options, and kNN score comparability across the two candidate paths. Sources the fixes in R3, T-2, T-4, T-5 and the correctness argument for step 4. |

`reference/00-index.md` updated. Existing `elastic-knn-query.md`,
`elastic-rrf-retriever.md` and `elastic-knn-retriever.md` already cover the
kNN pre-filter, RRF `rank_constant`/`rank_window_size`, and
`query_vector_builder` vs `query_vector`; no new copies were made.

## Verification log

- **PASS** — `yarn test`: 47 files, 243 tests.
- **PASS** — static cross-check of the revised plan against `lib/es/indices.ts`,
  `lib/es/index-assets.ts`, `lib/es/list-assets.ts`, `lib/es/search.ts`,
  `lib/es/search-core.ts`, `lib/live/search.ts`, `lib/ingest/job-store.ts`,
  `app/api/search/route.ts`, `app/api/library/[videoId]/route.ts`.
- **PASS** — plan/Chinese-summary/todo consistency, including the 20-code
  country catalog and phase numbering.
- **PASS** — Elastic documentation checks for `copy_to`, explicit mapping
  updates, optimistic concurrency, and result-window pagination.
- **NOT RUN** — hybrid retrieval, migration, PATCH/Suggest, browser E2E,
  relevance, latency. The feature is a plan.
- Planning files were left unmodified by this review; only this document, the
  new reference note, `reference/00-index.md`, and `reviews/README.md` changed.

Input SHA-256 (revised plan as reviewed):

```text
5c8b7f5742cf68e3c946877a7b96a18f45fdbf70e89cdbb8e347d9c2bd9dd57c  plan/03-hybrid-metadata-search-plan.md
bcba134c524baaccc47b25c4998f30828176966941088eacc5c658d9241d19f8  todo/02-hybrid-metadata-search-todo.md
425a168bcfd41266fa4816ffef753789adc8bc379b53db1980fe0e554d4d15e3  chn.docs/混合元数据检索规划.md
```
