# Hybrid search plan review — 2026-09-22

Scope: review `plan/03-hybrid-metadata-search-plan.md` against the current file-video implementation. Preserve the proposed plan and implementation; record findings separately.

- [x] Read the English plan, Chinese summary, and companion implementation todo.
- [x] Inspect retrieval, ranking, grouping, asset persistence, mapping setup, and API/UI contracts.
- [x] Check relevant Elasticsearch behavior against official documentation.
- [x] Record prioritized findings, suggested design corrections, and acceptance gates in a dated review.
- [x] Verify review links and preserve the original planning files (SHA-256 unchanged).
- [x] Run existing search/grouping tests: 3 files, 21 tests passed; `git diff --check` passed.

Review: [hybrid-metadata-search-plan-review-2026-09-22.md](../reviews/hybrid-metadata-search-plan-review-2026-09-22.md).

## Plan revisions after review

The planning corrections below are documented in the revised
[plan](../plan/03-hybrid-metadata-search-plan.md). Implementation remains open
in [`todo/02-hybrid-metadata-search-todo.md`](./02-hybrid-metadata-search-todo.md);
the review's original findings remain preserved as historical evidence.

- [x] H01 (P1): define independent global/lexical candidate paths and recall tests.
- [x] H02 (P1): isolate metadata writes from ingestion replacement and define concurrency behavior.
- [x] H03 (P2): specify parent-rank projection, formula, candidate/rank windows, and diversity.
- [x] H04 (P2): define hybrid sort/score/API/UI contracts for every modality.
- [x] H05 (P2): add mapping upgrade, existing-title handling, and precise object definitions.
- [x] H06 (P2): define complete bounded facet lookup and filter semantics for text/image requests.
- [x] H07 (P2): distinguish video metadata evidence from scene evidence and evaluate both.
- [x] H08 (P2): defer generative provider choice; define per-field confirmation, local suggestions, and draft merge rules.
- [x] Resolve import/read API/schema/field meaning/scope gaps; state analyzer and latency uncertainties.
- [x] Add functional acceptance gates and metrics with thresholds to be set from labeled baseline.
- [x] Narrow the production country/region selector to 20 explicit codes per
      the user's EU/East Asia/ASEAN preference, retaining `US` for the existing
      demo example; sync English and Chinese plans and implementation todo.

## Round-2 review and plan revisions

Second-round development-readiness review:
[`hybrid-metadata-search-plan-review-r2-2026-09-22.md`](../reviews/hybrid-metadata-search-plan-review-r2-2026-09-22.md).
Verdict: H01–H08 all resolved; ready to start Phase 1. The revisions below are
recorded in the [plan](../plan/03-hybrid-metadata-search-plan.md); both review
documents remain unedited as historical evidence.

- [x] R1 (P1): text weight starts at **0.4**, not 1, with the rank-constant
      arithmetic stated; lexical window becomes catalog-relative
      `A = min(20, max(5, ceil(0.2 × eligible)))` with a minimum-score floor.
- [x] R2 (P1): acceptance gates assert **ranking in both directions**, not
      mere eligibility.
- [x] R3 (P2): eligible-ID enumeration is a **single** request
      (`size: 10000`, `track_total_hits: 10001`); lexical expansion is one kNN
      over the asset ID set capped per asset; a per-stage latency budget table
      with a 1,500 ms p95 envelope was added.
- [x] R4 (P2): hybrid uses app-side `embedTextQueryVector`; equivalence with
      the existing `query_vector_builder` path must be proven before any
      hybrid on/off comparison.
- [x] T-1: drop `.default('visual')` so omitted vs explicit `sort_by` is
      distinguishable.
- [x] T-2: `expected_revision = 0` bootstrap for assets with no `meta`.
- [x] T-3: `lib/live/search.ts` added to the touch list (shared `SearchSortBy`).
- [x] T-4: partial updates replace arrays wholesale; `retry_on_conflict` on
      the ingest writer only.
- [x] T-5: mapping upgrade must precede any `meta.actors` write under
      `dynamic: strict`.
- [x] T-6: snippets/highlights read original fields, never `meta.search_text`.
- [x] Added [`reference/elastic-asset-metadata-and-bounded-retrieval.md`](../reference/elastic-asset-metadata-and-bounded-retrieval.md)
      and linked it from the plan, todo, and `reference/00-index.md`.
- [x] Synced the Chinese summary with the round-2 changes.

Open and unchanged: the labeled evaluation set (todo/02 Phase 0) still gates
Phase 3, and every numeric default remains provisional until measured.

## Round-3 revisions — multilingual names, semantic assets, query understanding

Raised by the user after the round-2 review, planned in the same
[plan](../plan/03-hybrid-metadata-search-plan.md):

- [x] **Actor names (schema change).** Replace `actors_key` with a person
      catalog + `actor_ids` (filter) / `actor_aliases` (BM25) / `actor_keys`
      (squashed + sorted-token fuzz). A name is an entity with an alias set,
      not a string; normalization cannot bridge Hangul/Han/romanized forms.
- [x] **Analyzers.** `standard` splits Han per character, which is a precision
      collapse for CJK names. Add a `cjk` sub-field; probe the project for
      `nori`/`smartcn`/`icu`/`phonetic` before freezing the mapping.
- [x] **Description embeddings.** New Phase 3.5 asset-level channel behind
      `ASSET_SEMANTIC_ENABLED`; zero extra query-time inference; must never
      share a field with chunk vectors; chunks still never re-embed.
- [x] **Query understanding.** New plan §C: deterministic catalog matcher in
      3.5, optional operator-supplied LLM in 3.6 for disambiguation and
      generalization only, with a minor configuration window
      (`QUERY_PARSER_*`), closed-vocabulary validation, three-tier
      degradation, parse cache, and speculative parallel embed.
- [x] **Extracted facets are boosts, not filters** (user-selected facets stay
      hard filters). This is the rule that makes a parser error a ranking
      nuisance rather than an empty results page.
- [x] **Empty-residual / name-only behavior** defined in Phase 3, before any
      parser exists: the vector channel still runs at reduced weight and the
      card is labelled "matched on video metadata" rather than presenting a
      noise-derived timestamp as person evidence.

- [x] **Parser transport decided (user, 2026-09-22).** Use Elastic Inference
      Service via `_inference` `chat_completion`, pinned to
      `google-gemini-3.5-flash-lite`. Reuses existing Elasticsearch
      credentials, so the config window collapses to an endpoint ID plus
      timeout/cache knobs. Agent Builder rejected (agentic, seconds of
      latency). ES|QL `COMPLETION` rejected for parsing (single-string input,
      cluster-setting dependency, planner overhead) but retained as a Phase 5
      option for row-wise per-hit explanations.

Open: the labeled relevance set still gates Phase 3, and a separate ~50-pair
parse set gates Phase 3.6. Whether EIS exposes provider-native structured
output is a Phase 3.6 verification item. Every numeric default remains
provisional.

- [x] **Parser scope clarified (user, 2026-09-22).** Rule 0 added: the parser
      produces query structure only and never participates in retrieval or
      ranking. No generative output may reach a score, rank, hit, or card. The
      ES|QL `COMPLETION` per-hit-explanation idea is withdrawn entirely rather
      than deferred, so there is no ambiguity about generative output entering
      the result path.
- [x] **Per-search toggle (user, 2026-09-22).** `hybrid.parse_query` plus a UI
      switch, with a five-case precedence table and a `parser` field in
      response meta. `false` skips dictionary *and* model and reproduces
      Phase 3 behavior byte-for-byte; the toggle never alters hand-selected
      facets.

Post-revision SHA-256 (round 3 + parser transport, scope, and toggle; the
round-2 review records the pre-revision inputs):

```text
68dcbaa3abe7207d4b34f3aa3f8baf09af6b51ed163a032d913f716f73e12ae3  plan/03-hybrid-metadata-search-plan.md
1f0f98976b7734bb3040d3171ac321b03ca38ea6fde5651448d38a6fd5c20c9a  todo/02-hybrid-metadata-search-todo.md
3d8f29a062948633d1c8ca7d81ad463746246e93b97316d824e0063670cd2736  chn.docs/混合元数据检索规划.md
```
