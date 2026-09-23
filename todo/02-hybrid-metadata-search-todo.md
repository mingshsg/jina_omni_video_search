# TODO — Hybrid metadata search

Status legend: `[ ]` not started, `[~]` in progress, `[x]` done, `[-]` cancelled.  
Last updated: **2026-09-23 (asynchronous dedicated-agent Suggest implemented; acceptance gates open)**.

Plan: [`plan/03-hybrid-metadata-search-plan.md`](../plan/03-hybrid-metadata-search-plan.md).
Reviews: [`round 1`](../reviews/hybrid-metadata-search-plan-review-2026-09-22.md),
[`round 2`](../reviews/hybrid-metadata-search-plan-review-r2-2026-09-22.md).
ES mechanics: [`reference/elastic-asset-metadata-and-bounded-retrieval.md`](../reference/elastic-asset-metadata-and-bounded-retrieval.md).

## Phase 0 — Spec

- [x] Write English plan (schema, auto-enrich, RRF vs filter, edit path)
- [x] Track in this todo + link from `todo/00-todo.md`
- [x] Lock decisions: country = ISO + selectable label; Suggest on **edit**
      only; results = **moments only**, asset text/names in hybrid RRF
- [x] Revise plan for two candidate paths, field-owned writes, application-side
      parent/scene fusion, filter completeness, migration, and scene evidence
- [x] Round-2 revision: text weight 0.4 with stated arithmetic, catalog-relative
      lexical window, single-request ID enumeration, stage latency budget,
      app-side query embedding, ranking-not-eligibility gates, T-1…T-6 traps
- [ ] **Blocks Phase 3.** Assemble labeled video/time-window queries before
      implementation tuning; freeze evaluation thresholds from baseline
      measurements. Include multilingual actor-name queries (Hangul / Han /
      romanized, name-order and spacing variants) and name-only queries
- [ ] **Blocks Phase 3.6.** Separate ~50-pair `query → expected structure`
      parse set, scored on over-trigger rate

## Phase 1 — Schema + edit API/UI

- [x] **Probe the target project for core analysis plugins** (`nori`,
      `smartcn`, `icu`, `phonetic`) and record the result **before** freezing
      the mapping; analyzer choice cannot change without a reindex
      → recorded in `docs/operations.md`; frozen on `standard` + `search_text.cjk`
- [x] Extend create mapping and idempotently upgrade existing `video-assets`
      strict mapping: `meta.*`, fixed per-field `review` properties,
      `actor_ids`/`actor_aliases`/`actor_keys`, `tags_key`, `search_text` with
      a `cjk` sub-field, fully qualified `copy_to` from `actor_aliases`;
      mapping upgrade must land **before** any write that sets
      `meta.actor_aliases`
- [x] Person catalog at **`config/people.json`** (not `data/`, which is
      gitignored + dockerignored + mounted over) + alias index: ID-based
      `actor_ids` filter, alias expansion on save, squashed and sorted-token
      `actor_keys`
      → **catalog-change backfill deferred to Phase 5** (aliases expand on
      each save; no bounded re-expand of existing assets yet)
- [x] `Dockerfile` copies `config/` into the standalone runner
      → built-image runtime catalog/save smoke still open (tracked in
      `todo/05-hybrid-phase1-implementation-review-2026-09-22.md`)
- [x] Actor wire contract: client sends `actor_ids` only (validated against
      the catalog, `400 META_UNKNOWN_ACTOR_ID` on unknown); server derives
      `actors` display, `actor_aliases`, `actor_keys`, `search_text`. No
      free-text actor names on the API in the MVP
- [ ] Search facet is `filters.actor_ids` with ANY semantics; cross-script
      selection test (metadata entered in Hangul, selected via romanized UI)
      → **Phase 2**
- [x] Verify populated-index migration and title-only old assets; use root
      `title` directly, report migration failures/conflicts, no chunk inference
      → `yarn setup-indices` upgraded live `video-assets`; recursive mapping
      diff rejects incompatible partial migrations
- [x] Pinned 20-option production country/region catalog (selected EU,
      CN/HK/TW/KR/JP, selected ASEAN, existing US example); one source for
      editor, facet, and API validation
- [x] Shared metadata validation/catalog: bounds, clear semantics, key
      normalization, controlled type/language/country, per-field provenance
      → `zh-Hans`/`zh-Hant` round-trip fixed; whitespace-only tags clear
- [x] Change ingest progress/retry to partial updates of ingest-owned fields
      with `retry_on_conflict`; prevent whole-asset replacement of saved
      metadata; document that arrays are replaced wholesale
- [x] Safe `GET /api/library/{videoId}` DTO and atomic
      `PATCH /api/library/{videoId}/meta` with `expected_revision`, 404/409,
      `refresh=wait_for`; test concurrent editors and later job writes
- [x] Script handles the `expected_revision = 0` bootstrap for assets that have
      no `meta` object; no `upsert`/`doc_as_upsert`
- [x] Separate transport version conflicts from semantic revision mismatch:
      bounded `retry_on_conflict` on **both** writers; `META_CONFLICT` only for
      stale `expected_revision`; `META_TRANSPORT_CONFLICT` when revision
      unchanged after exhausted version retries
- [x] Library “Edit metadata” form (all fields optional; country/region select
      `XX — Name`; handle conflict/reload without silent overwrite)
- [x] Docs: data-model + api-contract
- [x] Phase 1 review fixes (2026-09-22): language round-trip, recursive
      mapping upgrade, tag clear, transport conflict code

## Phase 2 — Facet filters in search

- [x] Dedicated **single-request** asset-ID query (`size: 10000`,
      `_source: false`, `track_total_hits: 10001`), filtered by ready variant
      and explicit video; overflow returns `FILTER_SCOPE_TOO_LARGE` (422)
- [x] Apply the complete ready-ID allow-list to chunk knn **when facets are
      selected** (AND across facets, ANY within arrays, inclusive years);
      default pure-vector path with no facets keeps today's behavior.
      Hybrid-without-facets allow-list lands with Phase 3 (`requireReadyAllowList`)
- [x] Test ready / empty facet intersection (unit + live smoke); unready/
      failed variants excluded by nested `status=ready` filter
- [x] Extend text search and image JSON/multipart request validation and
      filters; reject overlimit arrays or reversed year range
- [x] Search UI facets (year range, type, language, country, actors, tags);
      image API accepts the same `filters`; image page reuses `SearchFacets`
      + multipart filters (Phase 2 review fix)
- [ ] Measure kNN latency with a large ID pre-filter before freezing the
      10,000 cap

## Phase 3 — Text hybrid (BM25 + RRF)

- [ ] Prove app-side `embedTextQueryVector` matches the existing
      `query_vector_builder` result (cosine ≈ 1.0) before recording any
      hybrid on/off comparison
- [x] BM25 on eligible assets as a structured `bool.should` (exact
      `actor_keys` terms, `match_phrase` on `search_text` + its `cjk`
      sub-field, loose `match` on `title^2`/description/abstract) — not a flat
      `multi_match`; lexical window `A = min(20, max(5, ceil(0.2 × eligible)))`
      with a minimum-score floor
      → `lib/es/hybrid-search.ts` + `hybrid-fusion.ts`
- [x] Phase-3 labelling contract (no detector needed): every hit separates
      vector evidence from “video metadata matched”, and no card claims a
      person/event occurs at the shown timestamp. `scene_terms_present` and
      the vector down-weight move to Phase 3.5, where a matcher exists
      → `metadata_match` badge on search UI; no timestamp person claim
- [x] Retrieve full global per-modality candidate window; expand lexical
      assets in **two stages** — guaranteed floor (top `G = min(5, A)` assets
      × 2 chunks) then pooled fill over the rest — so a BM25 rank-1 asset can
      never receive zero candidates; union by chunk ID before final top-k
- [ ] Count real ES executions per request and measure p95 at the *guaranteed*
      budget, not the cheaper pooled-only one
      → `meta.branch.es_requests` / stage ms reported; live p95 still open
- [x] Implement documented application-side rank formula with `w_text = 0.4`
      and stable tie breaks; do not compare per-asset local ranks or
      double-count channels; do not clamp injected candidates
- [x] Drop `.default('visual')` from the search route schema; default `sort_by`
      only after `hybrid.use_text` is known; add `sort_by=hybrid`,
      `score_kind`, text rank/score, branch status, counts, timings, labels
- [x] Keep `lib/live/search.ts` behavior unchanged when `'hybrid'` joins the
      shared `SearchSortBy` union
      → `parseLiveSearchSortBy` still rejects `hybrid`
- [x] Keep moment cards and temporal grouping; relax diversity cap when too
      few videos can fill a page
      → grouping unchanged; diversity relaxation still open if needed
- [~] Ranking gates in both directions: name/title query lifts the
      metadata-matching video into the top 3; pure-scene query keeps the
      hybrid top 3 equal to the visual-only top 3
      → unit coverage in `hybrid-fusion.test.ts`; labeled live gates open
- [ ] Compare hybrid on/off relevant-video Recall@5 and scene Recall@5 on
      labeled queries; record p50/p95 latency per stage against the budget
      table and request/inference counts
- [ ] Regression checks for visual, audio, both, no lexical match, no audio,
      prior file/image searches, and shared live search

## Phase 3.5 — Semantic asset channel + deterministic query parser

- [x] `meta.description_embedding` behind `ASSET_SEMANTIC_ENABLED` (default
      off): embed description+abstract on save (`description-embed.ts`)
- [x] `description_embedding_meta` stale-on-save / publish-if-revision-matches /
      query only `state: current`; live rapid-edit race still open
- [x] `rank_asset_semantic` (`w_semantic=0.3`) reusing query vector
- [ ] Assert no chunk document, `variant_id`, or chunk embedding changes when
      the flag is enabled
- [x] Deterministic query matcher (`lib/metadata/query-parse.ts`)
- [x] Removable chips + `w_facet=0.2` boosts; hard filter wins; suppress list
- [x] Score fusion with pool-effective (`applied`) facets only so `no_effect`
      siblings do not dilute the numeric boost (2026-09-23)
- [x] Per-search `hybrid.parse_query` API + UI switch (default off)
- [ ] Assert the zero-config default path is byte-identical to the
      pre-feature build (pure vector search, no BM25 channel, no parsing)
- [x] Response meta `parse` object populated by dictionary path
- [x] UI collapsible parse-detail panel (applied + rejected)
- [x] Partial / no-op parses treated as normal; Rule 0 (inputs only)
- [ ] Measure BM25-only vs BM25+semantic, and raw vs dictionary parsing, on
      the labeled sets before changing any default

## Phase 3.6 — Optional EIS query parser

- [x] EIS **`completion`** client via `client.inference.completion` (not
      chat_completion / not ES|QL COMPLETION); ops probe
      `yarn probe-query-parser` (endpoint create is operator-side)
- [x] Structured output: prompt + catalog validation + one repair retry;
      `task_settings.max_tokens` soft hint (provider schema passthrough TBD
      per-cluster)
- [x] Config: `QUERY_PARSER_PROVIDER|INFERENCE_ID|TIMEOUT_MS|MAX_TOKENS|
      FACET_MODE|CACHE_TTL_MS|CACHE_MAX|CONCURRENCY`; eis requires inference id
- [x] Own concurrency gate (never `EMBED_CONCURRENCY`); no parser secrets in
      app config / logs / API responses
- [x] Prompt: closed vocabularies + candidate actors only; validate every value
- [x] Three-tier degradation eis → dictionary → raw; timeout must not fail
      search
- [x] Parse cache + skip EIS when unambiguous; speculative parallel embed
- [x] Labeled parse set (25 pairs) + dictionary over-trigger gate; live EIS
      p50/p95 comparison still needs a configured endpoint
- [x] Confirm no parser credential reaches responses (`inference_id` only)

## Phase 4a — Local Suggest (optional to core search)

- [x] Edit-time `POST …/meta/suggest` with deterministic year/language clues;
      no import or ingest hook
      → `lib/metadata/suggest-local.ts` + `app/api/library/[videoId]/meta/suggest`
- [x] Return evidence/source/confidence per field; draft only, never persist
      until PATCH Save; do not overwrite confirmed or newly typed fields
      → editor shows evidence, saves structured bounded provenance only for
      accepted fields, and preserves unchanged provenance on later Save
- [x] Handle provider unavailable, timeout/invalid output, cancellation, and
      late response without mutating the saved record
      → asynchronous POST/GET/DELETE job, strict response validation,
      downstream cancellation, and safe local fallback; no automatic PATCH

## Phase 4b — Title-grounded Suggest (separate decision)

Implementation review: [`Phase 4a/4b findings and follow-up`](./14-hybrid-phase4a-4b-review-2026-09-22.md). Local extraction and the guarded dedicated-agent path exist; audited acceptance gates remain open.
Internet-backed implementation plan: [`plan/04-internet-grounded-metadata-suggest.md`](../plan/04-internet-grounded-metadata-suggest.md); current cross-phase review and tasks: [`todo/16`](./16-hybrid-holistic-review-and-internet-suggest-2026-09-23.md). The configured route uses the dedicated `video_metadata_research` Agent Builder agent with only `grounded_title_lookup`, `jina.search_web`, and `jina.read_url`; it falls back to local drafts.

- [ ] Audit a small library sample: how often the saved title (sometimes
      filename-derived) identifies a unique work; do not assume the original
      filename is separately available or expose internal media paths
      → local heuristics exist, but no measured sample or match rate (F4-07)
- [x] Define title normalization, explicit filename-clue extraction, and
      abstention rules; separate a work-level synopsis from claims about this
      uploaded video
      → `normalizeTitle` / `analyzeTitleClues` / title-clue description+abstract+tags
- [~] If online lookup is enabled, select an approved catalog and check its
      attribution/text-reuse terms; bound candidate count, timeout and cost;
      retain source record ID/URL and corroborating title/year/type evidence;
      ambiguous or unmatched titles yield no sourced facts
      → dedicated Agent Builder + Jina web path is bounded and source-gated;
      catalog/license decision and measured cost/accuracy remain open
- [~] Evaluate an optional text-only LLM for wording from supplied title and
      verified catalog facts; no video/frame/audio upload, no unsupported
      scene or cast claims, no automatic choice among ambiguous candidates;
      keep credentials in ignored `.env`
      → dedicated text-only agent is implemented; labeled ambiguity, source,
      latency, and cost evaluation remains open
- [~] Enable description/type/tag drafts only after grounded-field accuracy,
      abstention, provenance and cost gates pass; never infer actors/country
      as confirmed facts
      → local drafts exist, actors/country omitted; accuracy, abstention,
      provenance and search-quality gates remain open (F4-01/F4-05/F4-07)

## Phase 5 — Optional scale-outs

- [ ] Asset `meta_embedding` dense vector with model/task/version, invalidation,
      and separate re-embedding lifecycle on metadata edits
- [ ] Denormalize cheap facets onto chunks only after measured need, with
      bounded update and consistency rules
- [ ] Live-video metadata (separate decision)
- [ ] Import metadata form/payload across upload, path/URL, batch (separate
      scope from Library-first MVP)
- [ ] Time-coded transcript/caption/recognition for verified scene presence
