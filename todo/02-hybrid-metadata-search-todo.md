# TODO — Hybrid metadata search

Status legend: `[ ]` not started, `[~]` in progress, `[x]` done, `[-]` cancelled.  
Last updated: **2026-09-22 (plan revised after round-2 review)**.

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

- [ ] **Probe the target project for core analysis plugins** (`nori`,
      `smartcn`, `icu`, `phonetic`) and record the result **before** freezing
      the mapping; analyzer choice cannot change without a reindex
- [ ] Extend create mapping and idempotently upgrade existing `video-assets`
      strict mapping: `meta.*`, fixed per-field `review` properties,
      `actor_ids`/`actor_aliases`/`actor_keys`, `tags_key`, `search_text` with
      a `cjk` sub-field, fully qualified `copy_to` from `actor_aliases`;
      mapping upgrade must land **before** any write that sets
      `meta.actor_aliases`
- [ ] Person catalog `data/people.json` + alias index: ID-based `actor_ids`
      filter, alias expansion on save, squashed and sorted-token `actor_keys`,
      bounded backfill when the catalog changes
- [ ] Verify populated-index migration and title-only old assets; use root
      `title` directly, report migration failures/conflicts, no chunk inference
- [ ] Pinned 20-option production country/region catalog (selected EU,
      CN/HK/TW/KR/JP, selected ASEAN, existing US example); one source for
      editor, facet, and API validation
- [ ] Shared metadata validation/catalog: bounds, clear semantics, key
      normalization, controlled type/language/country, per-field provenance
- [ ] Change ingest progress/retry to partial updates of ingest-owned fields
      with `retry_on_conflict`; prevent whole-asset replacement of saved
      metadata; document that arrays are replaced wholesale
- [ ] Safe `GET /api/library/{videoId}` DTO and atomic
      `PATCH /api/library/{videoId}/meta` with `expected_revision`, 404/409,
      `refresh=wait_for`; test concurrent editors and later job writes
- [ ] Script handles the `expected_revision = 0` bootstrap for assets that have
      no `meta` object; no `upsert`/`doc_as_upsert`; no `retry_on_conflict` on
      the metadata PATCH
- [ ] Library “Edit metadata” form (all fields optional; country/region select
      `XX — Name`; handle conflict/reload without silent overwrite)
- [ ] Docs: data-model + api-contract

## Phase 2 — Facet filters in search

- [ ] Dedicated **single-request** asset-ID query (`size: 10000`,
      `_source: false`, `track_total_hits: 10001`), filtered by ready variant
      and explicit video; overflow returns `FILTER_SCOPE_TOO_LARGE` (422)
- [ ] Apply complete allow-list to chunk knn; skip the ID filter entirely when
      no facets are selected; AND across facets, ANY within arrays, inclusive
      years, exact missing/empty/failure behavior
- [ ] Extend text search and image JSON/multipart request validation and
      filters; reject overlimit arrays or reversed year range
- [ ] Search and image UI facets (year range, type, language, country, actors,
      tags); verify zero, overflow, conflict, and out-of-catalog cases
- [ ] Measure kNN latency with a large ID pre-filter before freezing the
      10,000 cap

## Phase 3 — Text hybrid (BM25 + RRF)

- [ ] Prove app-side `embedTextQueryVector` matches the existing
      `query_vector_builder` result (cosine ≈ 1.0) before recording any
      hybrid on/off comparison
- [ ] BM25 on eligible assets as a structured `bool.should` (exact
      `actor_keys` terms, `match_phrase` on `search_text` + its `cjk`
      sub-field, loose `match` on `title^2`/description/abstract) — not a flat
      `multi_match`; lexical window `A = min(20, max(5, ceil(0.2 × eligible)))`
      with a minimum-score floor
- [ ] Empty-residual / name-only behavior: vector channel still runs with
      reduced weight, card labelled “matched on video metadata”, no
      person/event claim at the shown timestamp
- [ ] Retrieve full global per-modality candidate window; expand lexical assets
      with one kNN over the `A`-asset ID set (`k = 5A`) capped per asset in the
      application; union by chunk ID before final top-k
- [ ] Implement documented application-side rank formula with `w_text = 0.4`
      and stable tie breaks; do not compare per-asset local ranks or
      double-count channels; do not clamp injected candidates
- [ ] Drop `.default('visual')` from the search route schema; default `sort_by`
      only after `hybrid.use_text` is known; add `sort_by=hybrid`,
      `score_kind`, text rank/score, branch status, counts, timings, labels
- [ ] Keep `lib/live/search.ts` behavior unchanged when `'hybrid'` joins the
      shared `SearchSortBy` union
- [ ] Keep moment cards and temporal grouping; relax diversity cap when too
      few videos can fill a page
- [ ] Ranking gates in both directions: name/title query lifts the
      metadata-matching video into the top 3; pure-scene query keeps the
      hybrid top 3 equal to the visual-only top 3
- [ ] Compare hybrid on/off relevant-video Recall@5 and scene Recall@5 on
      labeled queries; record p50/p95 latency per stage against the budget
      table and request/inference counts
- [ ] Regression checks for visual, audio, both, no lexical match, no audio,
      prior file/image searches, and shared live search

## Phase 3.5 — Semantic asset channel + deterministic query parser

- [ ] `meta.description_embedding` behind `ASSET_SEMANTIC_ENABLED` (default
      off): embed description+abstract on save, record provider/model/task/
      dims, invalidate on provider change
- [ ] Add `rank_asset_semantic` as a third asset-level term
      (`w_semantic/(60 + rank)`), reusing the already-computed query vector —
      **zero extra query-time inference**
- [ ] Assert no chunk document, `variant_id`, or chunk embedding changes when
      the flag is enabled
- [ ] Deterministic query matcher: person-alias longest match, country/demonym
      table, video-type synonyms, year regexes; shared catalogs with metadata
      validation
- [ ] Removable chips in the UI; extracted facets apply as **boosts**, and
      only promote to hard filters when the user clicks the chip
- [ ] Per-search `hybrid.parse_query` toggle + UI switch, **default off**;
      omitted or `false` skips dictionary *and* model and reproduces Phase 3
      behavior exactly; hidden when no parser is configured; never alters
      hand-selected facets
- [ ] Assert the zero-config default path is byte-identical to the
      pre-feature build (pure vector search, no BM25 channel, no parsing)
- [ ] Response meta `parse` object: `parser`, `vector_query`, `free_text`,
      `scene_terms_present`, `applied`, **`rejected`** (value + reason),
      `confidence`, `elapsed_ms`, `cache`
- [ ] UI collapsible **parse detail** panel rendering applied *and* rejected
      extractions; must appear even when the parse changed no results
- [ ] Treat partial extraction and no-op parses as normal outcomes — not
      errors, not logged as errors, not "fixed" by extracting harder
- [ ] Enforce Rule 0: parser output never reaches a score, rank, hit, or card;
      retrieval/ranking code path identical with the parser on and off
- [ ] Measure BM25-only vs BM25+semantic, and raw vs dictionary parsing, on
      the labeled sets before changing any default

## Phase 3.6 — Optional EIS query parser

- [ ] Create an EIS **`completion`** task endpoint backed by
      **`google-gemini-3.5-flash-lite`**; verify availability by calling it
      once (do not infer from a Serverless version number). Use
      `client.inference.completion({ inference_id, input, timeout,
      task_settings })` → `res.completion[0].result`. **Not**
      `chat_completion` (returns a stream), **not** the ES|QL `COMPLETION`
      command (cannot pass `task_settings`)
- [ ] Determine whether EIS passes provider-native structured output
      (`responseSchema` / JSON mime type) through `task_settings`; if not, use
      prompt + validation + a single repair retry
- [ ] Config window: `QUERY_PARSER_PROVIDER` (`none|dictionary|eis`),
      `QUERY_PARSER_INFERENCE_ID`, `_TIMEOUT_MS` (800, explicit — Serverless
      inference default is 120 s), `_MAX_TOKENS` (256), `_FACET_MODE` (boost),
      `_CACHE_TTL_MS`, `_CACHE_MAX`; startup validation names the offending
      variable
- [ ] Client reuses the `lib/embed/eis.ts` transport pattern against
      `/_inference/completion/<id>` — no new credentials, no parser URL or
      model name in app config; its **own** concurrency gate, never
      `EMBED_CONCURRENCY`
- [ ] Prompt carries closed vocabularies + candidate actor matches only, never
      the whole catalog; returns minimal JSON, `null` over guesses
- [ ] Validate every extracted value against a pinned catalog; drop anything
      unrecognized so the model cannot invent codes or people
- [ ] Three-tier degradation (llm → dictionary → raw); timeout or malformed
      output must not fail the search
- [ ] Parse cache mirroring `lib/live/query-cache.ts`; skip the model when
      nothing is ambiguous; speculative parallel embed of the full query
- [ ] ~50-pair labeled parse set; report **over-trigger rate** (not accuracy)
      for dictionary-only vs dictionary+EIS, recording endpoint ID, resolved
      model, and measured p50/p95 parse latency
- [ ] Confirm no parser credential or endpoint secret reaches app config,
      logs, or API responses

## Phase 4a — Local Suggest (optional to core search)

- [ ] Edit-time `POST …/meta/suggest` with deterministic year/language clues;
      no import or ingest hook
- [ ] Return evidence/source/confidence per field; draft only, never persist
      until PATCH Save; do not overwrite confirmed or newly typed fields
- [ ] Handle provider unavailable, timeout/invalid output, cancellation, and
      late response without mutating the saved record

## Phase 4b — Generative Suggest (separate decision)

- [ ] Select and evaluate a separate caption/LLM/ASR provider, frame/sample
      limits, timeout and cost budget; keep credentials in ignored `.env`
- [ ] Enable description/type/tag drafts only after provenance and quality
      gates pass; never infer actors/country as confirmed facts

## Phase 5 — Optional scale-outs

- [ ] Asset `meta_embedding` dense vector with model/task/version, invalidation,
      and separate re-embedding lifecycle on metadata edits
- [ ] Denormalize cheap facets onto chunks only after measured need, with
      bounded update and consistency rules
- [ ] Live-video metadata (separate decision)
- [ ] Import metadata form/payload across upload, path/URL, batch (separate
      scope from Library-first MVP)
- [ ] Time-coded transcript/caption/recognition for verified scene presence
