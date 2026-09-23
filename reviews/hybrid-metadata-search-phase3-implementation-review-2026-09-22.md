# Hybrid metadata search — Phase 3 implementation review

Reviewed 2026-09-22 on `live-video-search` at `b303e15` plus the current uncommitted worktree. Scope: opt-in BM25 and vector candidate retrieval, application fusion, API/UI contracts, and read-only searches against the configured Elasticsearch instance. No implementation files or instance data were changed.

**Verdict: not ready to mark Phase 3 complete.** The opt-in path runs on the small live fixture, retains the global visual candidates when BM25 is empty, and applies the ready-asset allow-list. The mixed actor-plus-scene query loses the actor text match; a partial lexical failure can still apply the text boost while reporting that channel failed. The planned batched retrieval, diversity policy, and evaluation gates are also incomplete.

## Findings

### P1 — Adding scene words to an actor query can remove the actor match

`lib/es/hybrid-search.ts:82-123` constructs exact actor keys and both `match_phrase` clauses from the **entire** user query. For `Audrey Hepburn running`, neither the exact key nor the phrase equals the indexed alias `Audrey Hepburn`; the loose `match` clauses do not search actor aliases. On the configured instance, the same ready-variant scope returned `text_channel_status=ok`, `lexical_assets=1`, and `rank_text=1` for `Audrey Hepburn`, but `text_channel_status=empty`, `lexical_assets=0`, and no metadata-matched top-five hit for `Audrey Hepburn running`. The latter is a retrieval-channel failure demonstration, not a judgment that this video contains a running scene.

The plan includes name-plus-scene queries in the Phase 3 labeled set, and the second candidate path cannot rescue a metadata-matched video when BM25 returns no asset. Extract or otherwise match a contained catalog alias without requiring the entire query to be a name, while preserving the scene words for vector retrieval. Add a fixture where the actor's video is absent from global kNN and the mixed query must still retrieve its moments. Measure unrelated-name negatives so partial matching does not broadly boost wrong assets.

### P1 — A failed lexical expansion still changes ranking

`lib/es/hybrid-search.ts:401-446` catches BM25 and lexical kNN expansion together. If BM25 succeeds but any floor or pooled expansion call throws, `text_channel_status` becomes `failed`, yet `lexical` remains populated and is projected onto global candidates at lines 446-452. Those candidates receive `rank_text`, `metadata_match=true`, and the 0.4 text term despite the advertised failed text channel. The plan's failure contract says a failed text branch falls back to **global vector candidates only**. Clear the lexical prior on expansion failure, or report a distinct partial status with explicitly defined ranking semantics. Test both BM25 failure and failure after BM25 success, including response score and badge assertions.

### P2 — Per-asset floor searches are serial instead of batched

`lib/es/hybrid-search.ts:245-285` awaits each top-`G` asset search in a loop; global visual/audio searches at lines 372-393 are also serial. At `G=5` and `modality=both`, the path makes up to 16 dependent Elasticsearch requests: one enumeration, two global kNN, one BM25, ten floor kNN, and two pooled kNN. The plan specifies one `msearch` for floor entries per modality, and its 1.5-second provisional p95 envelope is not established by a one-off small-fixture latency. Batch independent searches and measure actual p50/p95 under representative catalog size and concurrency. Keep a count of subsearches as well as HTTP round trips so the cost is reviewable.

### P2 — The planned two-groups-per-video preference is not implemented

`lib/es/group-hits.ts:166-174` groups temporally and takes the first `k`; the hybrid path at `lib/es/hybrid-search.ts:455` takes raw top hits before the UI groups them. Neither step prefers at most two groups per video while another eligible video's groups can fill the page, as specified in plan step 6. On one live 50-hit query the displayed five groups happened to meet the preference, but the code does not enforce it. Add a deterministic fixture with three high-ranked, separated groups from one video and a lower-ranked group from another, then implement the provisional diversity rule after temporal grouping (with relaxation when too few videos qualify).

### P2 — Diagnostics and acceptance coverage are incomplete

`lib/es/hybrid-search.ts:330-394,499-508` times total and kNN work but does not expose embedding time/call count or separate global and lexical candidate timings. `es_requests` increments only after successful searches, so it undercounts attempted calls when the text branch fails. The empty-eligibility response has no `branch` record. The six fusion tests check sizing and simple ordering but do not exercise two-path orchestration, failures, `both`/missing-audio, or the route's omitted-vs-explicit `sort_by` contract. Record stable branch metrics and add targeted orchestrator/API tests; do not infer relevance or latency acceptance from unit success.

## Verification status

- **PASS:** `yarn test` — 52 files, 280 tests; `git diff --check`.
- **PASS, bounded:** Read-only live `Audrey Hepburn` visual hybrid query returned five hits, one lexical asset, two lexical chunks, and `text_channel_status=ok`; the same ready variant had six eligible assets. A 50-hit query produced five displayed groups across three videos. This shows the small-fixture path runs, not that ranking/diversity meets the labeled gates.
- **FAIL:** Read-only `Audrey Hepburn running` query in the same scope returned `text_channel_status=empty` and zero lexical assets; the actor metadata was no longer recognized.
- **FAIL (existing baseline):** `yarn tsc --noEmit --pretty false` still reports errors in `lib/live/*.test.ts` `ProcessEnv` fixtures; no Phase 3 source error appeared in this run. This is not a Phase 3-specific pass.
- **NOT RUN:** controlled lexical-failure injection, app-side embedding versus EIS `query_vector_builder` cosine comparison, frozen labeled video/scene Recall@5, equal-budget hybrid-on/off comparison, p50/p95 under load, browser interaction, and broad file/image/live regression. These remain explicit completion gates in the plan and Phase 3 progress tracker.

Follow-up: [`todo/08-hybrid-phase3-implementation-review-2026-09-22.md`](../todo/08-hybrid-phase3-implementation-review-2026-09-22.md).
