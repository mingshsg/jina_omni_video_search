# Hybrid metadata search plan review — 2026-09-22

**Verdict: sound product direction; revise the retrieval and persistence contracts before implementation sign-off.** Metadata on assets, structured facets as hard filters, BM25 first, and metadata edits without chunk re-embedding are good choices. The locked country selector, edit-time suggestions, and moment-only results can all remain.

Reviewed [English plan](../plan/03-hybrid-metadata-search-plan.md), [Chinese summary](../chn.docs/混合元数据检索规划.md), and [implementation todo](../todo/02-hybrid-metadata-search-todo.md) against branch `live-video-search`, HEAD `93425bc`, including existing uncommitted planning files. “Scene” below means a retrieved time window, not an automatically detected shot boundary. This is a plan review, not a hybrid implementation or production-readiness claim.

## Findings

### H01 — P1: Define candidate expansion; metadata boosting alone cannot recover missing videos

**Plan:** lines 69–80 and 99–114. **Code:** [search.ts](../lib/es/search.ts), especially lines 208–241 and the final `searchChunks` wrapper.

The diagram sends BM25 video IDs into the vector pre-filter, but the numbered algorithm says only facets restrict the corpus. These have different semantics. Restricting the main vector search to lexical matches loses visually relevant scenes from videos with missing or differently worded metadata. Conversely, running ordinary global vector search and then boosting its returned chunks cannot recover a metadata-matching video absent from that candidate set.

Concrete failure: asset A is BM25 rank 1 for “Audrey Hepburn”, but none of A's chunks is in the vector candidate window. Projecting A's asset rank onto existing vector hits changes nothing; the advertised person-name success case fails. The current single-modality executor also returns only `size` hits despite a potentially larger internal kNN rank window, so fusing after `executeChunkSearch` compounds the cutoff.

**Add:** two bounded recall paths: global moment candidates within hard filters, plus moment candidates retrieved from top lexical assets within those same filters. Union/deduplicate by chunk identity before final ranking and result truncation. Define the asset window, per-asset scene budget, total candidate cap, and treatment of assets without the requested variant/modality. Keep the unrestricted-by-text moment path when BM25 returns zero. Update the diagram to show both paths.

**Acceptance:** recover A when initially absent from global kNN, retain a relevant video with no metadata, and never reintroduce a video excluded by facets or explicit `video_id`.

### H02 — P1: Existing ingestion writes can erase newly saved metadata

**Plan:** lines 62, 165–171, 231 and 259–264. **Code:** [index-assets.ts](../lib/es/index-assets.ts) lines 65–80; [job-store.ts](../lib/ingest/job-store.ts) lines 244–288 and 364 onward.

`upsertAsset` replaces the whole asset. `jobToAssetDoc` reconstructs it from ingestion state without editorial fields, and `persistJob` calls that replacement on job updates. Adding `meta` and a PATCH endpoint alone leaves a path where an ingestion update or retry drops saved metadata. Merely copying metadata into an in-memory job once still permits stale writes to overwrite later edits.

**Add:** field ownership and concurrency rules. Ingestion should update only ingestion-owned fields on existing assets; metadata writes should update only editorial fields. Define conflict handling for concurrent edits, omitted-versus-cleared fields, search visibility after save, and a 404 for a nonexistent asset rather than creating a metadata-only asset. Cover retry/hydration paths and add `lib/ingest/job-store.ts` to the touch list.

**Acceptance:** save metadata, then persist progress/retry/restart hydration; metadata survives. Two edits cannot silently overwrite each other's newer state. Chunk IDs, counts, variant IDs, and embeddings remain unchanged by metadata edits.

### H03 — P2: Asset-rank projection is a custom ranking rule that needs an explicit formula

**Plan:** lines 106–109 and 116–118. **Code:** [search.ts](../lib/es/search.ts) lines 245 onward; [search-core.ts](../lib/es/search-core.ts) lines 259–292.

Assets and chunks are different documents. Elasticsearch's RRF combines rank contributions for the same document identity; it does not perform the proposed parent-to-chunk join. Assigning every child its parent's rank can be a useful metadata prior, but it is an application-level extension. [Elastic RRF reference](https://www.elastic.co/docs/reference/elasticsearch/rest-apis/reciprocal-rank-fusion).

The plan also leaves open whether to fuse an already fused visual/audio list with text or fuse the original channels together. These produce different orders and modality influence. Repeating one asset's text contribution across many windows can crowd other videos out; the existing temporal grouping only combines nearby windows, not all windows of a video.

**Add:** choose one algorithm and execution location. A reasonable MVP is application-side fusion over the shared chunk candidate pool, using explicit visual/audio rank contributions and one parent text contribution. Specify weights, rank constant, missing-channel behavior, tie breaks, and whether ranks refer to global windows or a reranked common candidate pool. Do not treat separate per-video kNN ranks as globally comparable. Set candidate/per-video diversity limits and test the tradeoff before freezing defaults. Avoid double-counting visual/audio evidence through both a fused list and its component lists.

### H04 — P2: The current sort and score contract disables the proposed visual-plus-text mode

**Plan:** lines 175–200, notably the example with `modality: visual`. **Code:** [search route](../app/api/search/route.ts) lines 17 and 56–59; [search page](../app/page.tsx) lines 78–80 and 288–304; [search-core.ts](../lib/es/search-core.ts) lines 279–292.

Today the route converts RRF sorting to the selected modality unless modality is `both`; the UI disables RRF otherwise. The single-modality executor bypasses fusion, and `score` means kNN similarity in that case. Adding only `rank_text` and `asset_text_score` leaves visual+text either sorted incorrectly or presented with misleading score labels.

**Add:** separate retrieval modality from ranking mode. Define the default when hybrid is enabled, what an explicit visual/audio sort does, and the response's effective ranking strategy. Retain separate modality similarity values and expose an explicitly typed hybrid score. Update route serialization, UI labels, grouping representative selection, and image-search behavior. Preserve old requests with hybrid omitted/disabled. Shared search helpers also serve live search, so protect that unchanged contract with regression checks.

### H05 — P2: Mapping migration omits existing-title backfill and precise field definitions

**Plan:** lines 38–53 and 213–219. **Code:** [indices.ts](../lib/es/indices.ts) lines 161–178; [setup-indices.ts](../scripts/setup-indices.ts).

The plan correctly calls for mapping updates, but the current setup command only creates missing indices and skips existing ones. New mapping definitions must therefore be accompanied by an actual additive upgrade path. Existing asset titles will not automatically populate a newly introduced copied text field just because the mapping changes. This matters even for assets whose metadata is never edited. Mapping adoption requires document reprocessing; it does not require chunk embedding. [Elastic update-by-query example](https://www.elastic.co/docs/reference/elasticsearch/rest-apis/update-by-query-api).

**Add:** verify an upgrade from the current mapping, backfill assets with counts/failure/conflict reporting if retaining `copy_to`, and check title-only search before and after migration. Alternatively, query the existing root `title` alongside new metadata text fields to avoid requiring title copies. Validate any change to the existing title mapping on the supported ES version before choosing that path.

Specify `meta` as an ordinary `object` unless ES `nested` semantics are intentionally needed. Define the children of `meta_confidence` under the strict mapping. Use fully qualified `copy_to` targets, and remember copied values are absent from `_source`; evidence snippets should come from original fields. [Elastic copy_to reference](https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/copy-to).

### H06 — P2: Hard-filter completeness and semantics are not yet specified

**Plan:** lines 101–114, 124–129 and 183–191. **Code:** [list-assets.ts](../lib/es/list-assets.ts) lines 62–80.

The hard-filter video set must include every eligible video within the declared supported catalog size. It cannot be a top-N lexical result or the Library listing, which defaults to 100 and caps at 500. A truncated allow-list silently excludes valid results well before a 10k-video scale threshold.

**Add:** a dedicated ID query with explicit size/pagination and overflow handling. Detect an incomplete result and return a clear limit/error state; never silently drop filters or use an arbitrary prefix. Bound request size as well as catalog size. Elasticsearch's default `terms` limit is 65,536, but this does not remove application fetch limits. [Elastic terms query reference](https://www.elastic.co/docs/reference/query-languages/query-dsl/query-dsl-terms-query).

Define AND between facet types and ANY/ALL within each array (actors/tags especially), inclusive year bounds, missing values, casing/name normalization, and intersection with existing `video_id` and `variant_id`. Apply eligibility before selecting top lexical assets so unavailable variants do not consume the text window. Specify hard-failure behavior for facet lookup failure; BM25 failure may degrade only with a visible response flag. For image search, define the same filters for both JSON and multipart requests.

### H07 — P2: Video metadata cannot prove a person or event occurs in the returned scene

**Plan:** lines 86, 95–112 and 272–274.

An actor list identifies cast membership at video level. Every scene inherits the same asset rank, including scenes where that actor is absent. Likewise, a plot description can mention an event absent from a trailer. A higher-ranked video or window is not evidence of the correct timestamp.

**Add:** make the MVP promise explicit: metadata helps select videos; window-level embeddings propose scenes. Keep moment-only cards, but show a separate reason such as “video metadata matched: actors” alongside visual/audio evidence. A name-only query can show candidate scenes without claiming verified person presence. Accurate actor/event localization needs timestamped supporting evidence such as captions, transcript/OCR segments, or separately evaluated recognition; treat that as later scope.

Measure relevant-video recall and correct-scene recall separately. “The video's moments rose” can pass while every returned timestamp is wrong.

### H08 — P2: Suggestion provenance and the generation dependency are underspecified

**Plan:** lines 138–155 and 234. **Code:** [embedding provider interface](../lib/embed/types.ts) lines 37–42.

The existing provider returns vectors; the repository has no generation method in that interface. The plan names captions/LLM/ASR but does not choose a captioning provider, configuration, limits, or failure behavior. Also, a single `meta_source: mixed` plus confidence cannot identify which individual fields were manually confirmed, so it cannot implement the promised per-field overwrite protection.

**Add:** either explicitly defer generation beyond the core MVP, or define a separate suggestion provider and its deployment requirements. Keep any credentials in ignored environment files. Specify frame sampling, timeout/cost limits, malformed-response handling, unavailable-provider UI, and no persistence on Suggest. Pass current draft state or merge suggestions into untouched fields so a late response cannot replace edits made while the request was running.

Model confirmation/source per field, independently from confidence, including explicit clearing. Prefer unknown values to unsupported year/country guesses; frame-derived descriptions should be identified as sample-based. A small manual metadata search MVP is independently useful and should not depend on this feature being configured.

## Smaller additions and scope alignment

- **Import:** the UI section promises a metadata panel, but phases/todo omit its ingestion payload and persistence work. Explicitly defer it or cover upload, path/URL, and batch contracts; specify whether batch metadata applies to every file or varies per item.
- **Read API:** the asset-by-ID route currently implements DELETE only. Decide whether to add the proposed safe GET or enrich the list DTO; include `lib/es/list-assets.ts` if choosing the latter. Do not serialize internal asset paths just to supply the editor.
- **Tags/series/episode:** tags promise a weak boost but are absent from the listed text input; series/episode promise filtering but are absent from the request contract. Either implement these roles or narrow the schema description.
- **Validation and analyzers:** bound strings/arrays, define whitespace and clear semantics, reject reversed year ranges, and choose an actor/tag normalization policy. Include Chinese/English name and description queries in evaluation; BM25 is not automatically cross-language semantic retrieval.
- **Field meaning:** define year as release/production year and country as production country; do not silently use capture date or setting. Decide whether co-production countries are supported. Description and abstract need distinct intended roles if both remain.
- **Long `.keyword` values:** if “truncated” means `ignore_above`, correct the wording: that setting omits over-limit values from indexing rather than shortening them. Consider omitting keyword subfields on long descriptions entirely. [Elastic ignore_above reference](https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/ignore-above).
- **Latency:** “two ES round-trips” is incomplete for both-modality attribution and candidate expansion. Set budgets for asset lookup, lexical retrieval, embedding, chunk retrieval, and fusion; reuse one query embedding where the chosen execution path allows it.
- **Optional v2 vectors:** specify metadata embedding model/task/dimensions, document versus query roles, revision-based invalidation, and re-embedding on metadata changes. Keep metadata-vector lifecycle distinct from unchanged chunk embeddings.

## Suggested revised MVP flow

1. Validate filters and determine eligible video IDs, including explicit video/variant constraints. Empty eligible set returns empty results before inference.
2. Obtain global moment candidates and top BM25 assets under those constraints. Missing metadata does not remove videos from the global path.
3. Retrieve a bounded number of candidate windows from lexical assets not sufficiently represented in the global path. No arbitrary expansion to every chunk of a long movie.
4. Union candidates, establish comparable per-modality ranks, then apply the documented text contribution and modality ranking formula.
5. Apply deterministic ordering and the chosen diversity/grouping policy; return moment cards with separate asset and scene evidence.
6. Persist metadata through isolated field updates; migrate old assets and verify ingestion cannot erase edits.

This is a proposed correction for plan revision, not a claim that the algorithm or parameter values have been empirically validated.

## Acceptance gates to add before sign-off

| Gate | Required evidence |
| --- | --- |
| Candidate recall | Metadata rank-1 video absent from initial global vector candidates becomes eligible for final results; no-metadata visual match remains eligible. |
| Scene correctness | Labeled expected intervals for scene queries; separate relevant-video Recall@K and scene Recall@K with an agreed overlap rule. Include a cast member absent from the target scene. |
| Ranking | Visual+text, audio+text, both+text, text off, missing audio, no lexical match, ties, long videos, and grouping. Verify defaults and alternate sorts. |
| Hard filters | Zero matches, more matches than one ID page, cap overflow, explicit video conflict, variant mismatch, multi-value ANY/ALL, missing values, and failed facet lookup. |
| Migration | Fresh setup and upgrade from current populated mapping; title-only old assets searchable; rerun idempotent; no chunk rewrite/inference. |
| Persistence | Edit/clear/reload, progress write after edit, retry/restart, concurrent editors, nonexistent asset, and save-to-search visibility. |
| Suggestions | Disabled provider, timeout/invalid output, draft cancellation, late response, confirmed fields, and no writes before Save. |
| Compatibility | Existing file text/image requests still work; JSON and multipart image facets agree; shared live search behavior remains unchanged. |
| Performance | Measured end-to-end latency and request counts at the declared demo catalog/candidate limits, with explicit timeout and degradation behavior. |

Use a small labeled set covering person/title, pure scene, person+scene, multilingual, missing/wrong metadata, no audio, and unrelated-video negatives. Compare visual/audio-only versus hybrid with fixed candidate budgets. Freeze quality thresholds before calling the demo successful.

## Verification and preserved inputs

- **PASS:** static cross-check of the plan against the current mapping, ingestion persistence, search executor, API, and UI.
- **PASS:** `yarn vitest run lib/es/search.test.ts lib/es/search-core.test.ts lib/es/group-hits.test.ts` — 3 files, 21 tests. These validate existing helpers, not the proposed hybrid design.
- **PASS:** `git diff --check`, review/tracker local links, and original planning-file SHA-256 comparisons.
- **NOT RUN:** hybrid runtime search, migration, metadata PATCH/Suggest, browser E2E, relevance evaluation, or performance measurements; the reviewed feature is still a plan.
- Original English plan, Chinese summary, and hybrid implementation todo were preserved. Follow-up: [review task tracker](../todo/03-hybrid-search-plan-review-2026-09-22.md).

Input SHA-256 values:

```text
2abdf0df5d4442b5e6826aea4addfd333fd07624e8bf360f179fdd5d30a9018b  plan/03-hybrid-metadata-search-plan.md
15e4a4329e12cb36e87b9cfc540cc2dd8bb3f8b147d16d82e0f1fb590559c1bc  todo/02-hybrid-metadata-search-todo.md
7ea50b3f55ffa92ab17484ed5cacf834f3067e1d8ee7fcc00e64574589d85932  chn.docs/混合元数据检索规划.md
```
