# Hybrid metadata search — Phase 3, 3.5, and 3.6 implementation review

Reviewed 2026-09-22 on `live-video-search` at `b303e15` plus the current uncommitted worktree. Scope: hybrid candidate retrieval, semantic asset embeddings, deterministic and EIS query parsing, ranking, API/UI evidence, and the plan's acceptance gates. This is a review only; no implementation or instance data was changed.

**Verdict: the phases are implemented in outline but are not ready for completion sign-off.** The prior Phase 3 actor-plus-scene defect is fixed on the small live fixture. The Phase 3.5 facet term is on the wrong numerical scale, the semantic asset branch cannot introduce an otherwise absent video, and Phase 3.6 cannot use an EIS `null` to correct a dictionary extraction. Several failure and lifecycle paths still need tests. The configured environment has semantic search off and no EIS completion endpoint configured, so those two paths were reviewed statically and with local reproductions, not live end-to-end.

## Findings

### P1 — Inferred facets overwhelm the published rank formula

`lib/es/hybrid-fusion.ts:39-76,240-262` adds `w_facet × matched / selected` directly to RRF terms. With one matched facet this is **0.2**; rank-1 visual is `1/61 = 0.01639` and rank-1 BM25 is `0.4/61 = 0.00656`. The facet term is **30.5 times** the top text term, despite plan §C describing it as below text evidence. A single inferred country/type can dominate visual, audio, BM25, and semantic ranks together. The unit test at `hybrid-fusion.test.ts:34-41` asserts the problematic `+0.2` rather than its intended relative influence. This is also a plan arithmetic error, not just an implementation error. Put the facet term on the same scale as the rank terms (or explicitly redesign the formula), set the threshold against labeled negatives, and test a strong scene hit against an unrelated video with one inferred facet.

### P1 — Semantic asset hits cannot create candidate moments

`lib/es/hybrid-search.ts:440-481,689-734` obtains semantic asset ranks but never retrieves chunks for those asset IDs. Fusion only maps `semanticByVideo` onto the existing global/BM25 chunk union. A local reproduction with a semantic rank for `v2` and scene candidates only for `v1` returns only `v1`. Therefore the optional channel cannot recover a paraphrase or cross-language video absent from both global kNN and BM25, which is its stated purpose in plan §B. Add a bounded per-asset or pooled chunk expansion for semantic-only assets, preserving ready/variant filters and moment-only output; test the absent-from-both-paths case.

### P1 — EIS cannot veto a dictionary guess

`lib/metadata/resolve-query-parse.ts:157-180` merges `{...dict.extracted, ...validated.extracted}`. `validateEisParsePayload` omits a field when EIS sends `null`, so the dictionary value survives. For `Audrey Hepburn interview`, the dictionary extracts `video_type=interview`; a valid EIS response with `video_type:null` still yields `interview`. Empty/null `vector_query` and `free_text` also fall back to dictionary values. This defeats Phase 3.6's central disambiguation use case: deciding that “interview” is a scene term rather than the asset type. Distinguish an absent EIS field from an explicit null/empty decision, and test EIS removal of each dictionary field as well as transport fallback.

### P1 — A failed `msearch` item is silently treated as an empty asset

`lib/es/hybrid-search.ts:281-304` maps any floor response without `hits` to `[]`, never checks per-item `error`/`status`, and never verifies one response per requested asset. Elasticsearch's [multi-search response contract](https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-msearch) permits an error object in place of an individual search response. The outer HTTP call can succeed while one top BM25 asset contributes no two-chunk floor, yet `text_channel_status` stays `ok`. Reject an errored or missing floor item and apply the documented text-path fallback (or a defined partial result); inject one failed item among successful items in an orchestrator test.

### P2 — Semantic vector identity is stored but not enforced at query time

`lib/metadata/description-embed.ts:103-111` records provider/model/task/dims, but `lib/es/hybrid-search.ts:452-468` filters only `state:current`. Changing the embedding provider/model can leave old `current` asset vectors in a different space while a new query vector is used. Plan §B requires provider invalidation. Filter for the active identity, or explicitly mark mismatched vectors stale and backfill them before enabling the branch. Also test a provider change without any metadata edit.

### P2 — Parser applicability and reported effects disagree

`app/api/search/route.ts:133-168,179-206` reports every unsuppressed extraction as `meta.parse.applied` before checking whether any candidate asset matches. If the asset snapshot lookup fails, `lib/es/hybrid-search.ts:709-719` silently uses an empty map, yet the response still says the boosts were applied. With `parse_query=true` and `use_text=false`, extracted boosts are reported but are not passed to `searchChunks` at all. Plan §C requires unmatched values under `rejected` with `no_effect` and `applied` to mean a scoring effect. Compute this from actual candidate matching, distinguish unavailable snapshot data, and either require hybrid text for boost application or make parser-only semantics explicit. `QUERY_PARSER_FACET_MODE=filter` is accepted by config but has no consumer, so the documented evaluation mode is also inert.

### P2 — The EIS skip rule prevents its advertised generalization case

`lib/metadata/resolve-query-parse.ts:27-49,256-265` skips EIS whenever the dictionary finds no catalog entity. The plan gives unlisted wording such as `南朝鲜的片子` as a reason to use the LLM, yet the local dictionary returned no extraction for that phrase and `shouldSkipEis` returned `no_catalog_hit`. The skip rule in plan §C2 and its generalization promise conflict. Decide which limited unknown-word cases merit EIS, and measure the added calls/over-trigger rate on the parse set before changing the default.

### P2 — EIS actor IDs are checked against the whole catalog, not prompt candidates

`lib/metadata/resolve-query-parse.ts:52-71` tells EIS to choose only from a short `candidate_actors` list, but `lib/metadata/validate-eis-parse.ts:55-73` accepts any ID that exists in `config/people.json`. A malformed or over-eager completion can therefore add an unrelated, catalog-valid actor boost. Pass the candidate-ID set into validation, reject IDs outside it with a visible reason, and test the case. This is more consequential while the facet boost remains numerically dominant.

### P2 — Semantic publishing is synchronous and can strand a stale vector

`lib/es/asset-meta.ts:270-287` awaits embedding and an ES update inside the PATCH request, although plan §B calls for stale-on-save then queued inference. There is no request-level bound around provider retry/queue time. A simultaneous unrelated metadata edit can advance `meta.revision` after the description edit; `publishDescriptionEmbedding` then no-ops on revision mismatch (`description-embed.ts:113-134`), while the unrelated edit does not schedule another embedding, leaving the new description stale indefinitely. Queue or otherwise bound the work, and reconcile stale vectors when revision changes but description digest is unchanged. Test two rapid description edits **and** description followed by an unrelated edit.

### P2 — Phase 3.6 latency and call metrics omit speculative inference

`app/api/search/route.ts:126-177` may launch `embed(full_query)` before eligibility is known, then `lib/es/hybrid-search.ts:563-568` embeds the residual again if parsing changes it. Even an empty eligible set can trigger the speculative call. `branch.embed_calls` is fixed at 1 and `embed_ms` is 0 when the speculative vector is reused (`hybrid-search.ts:563-569,787-789`), so response diagnostics do not describe actual calls or time. Include speculative and residual calls in counts/timing, and decide whether to defer the first call until after hard-filter enumeration when zero-result filters are common.

### P2 — TypeScript gate has two new configuration-fixture failures

`yarn tsc --noEmit --pretty false` reports 43 errors. Forty-one are the previously recorded live-test fixture baseline; two new errors in `lib/ingest/chunk-presets.test.ts` and `lib/ingest/pipeline.test.ts` arise because `ASSET_SEMANTIC_ENABLED` is now required on `AppConfig` but those test fixtures still allow `boolean | undefined`. Unit tests run, but the repository type/build gate is red. Update the fixtures or their common factory, then rerun the full type/build gate.

## Verification and limits

- **PASS:** `yarn test` — 56 files, 305 tests; `git diff --check`.
- **PASS, bounded live:** Read-only `Audrey Hepburn running` visual hybrid query on the configured ready variant returned `text_channel_status=ok`, one lexical asset and two lexical chunks, fixing the prior actor-plus-scene miss. One request took 275 ms; this is not a p95 result.
- **FAIL:** Local arithmetic and reproductions above confirm the facet scale, semantic candidate omission, EIS-null merge, and no-catalog-hit EIS skip. TypeScript fails with 43 errors, including two new config-fixture errors.
- **NOT RUN:** Live semantic indexing/query (flag off), EIS parser (no endpoint configured), forced partial `msearch` failure, rapid-edit races, app-side versus EIS-builder cosine check, labeled video/scene Recall@5, equal-budget comparisons, representative p50/p95 under load, and full browser/file/image/live regression. These remain acceptance gates; no production-readiness claim follows from the green unit suite.

Follow-up: [`todo/11-hybrid-phase3-3.5-3.6-review-2026-09-22.md`](../todo/11-hybrid-phase3-3.5-3.6-review-2026-09-22.md).
