# Independent hybrid code review follow-up — 2026-09-23

Review: [`hybrid-metadata-search-independent-code-review-2026-09-23.md`](../reviews/hybrid-metadata-search-independent-code-review-2026-09-23.md).
Current recheck: [`hybrid-code-recheck-2026-09-23.md`](../reviews/hybrid-code-recheck-2026-09-23.md). F1–F3 remain open at `d0b3403`; the local 398-test suite and build do not exercise the live floor request.
Scope: current uncommitted worktree on `live-video-search`. Nothing was
modified during the review. Prior phase findings remain open in `todo/05`,
`todo/06`, `todo/11`, `todo/14`, and `todo/16`.

## P1 — blocking, close before committing

- [x] **F1 — floor `msearch` uses an unsupported `retriever` body.** Fixed:
      `msearchFloorKnn` now sends a top-level `knn` (typed `estypes.KnnSearch`,
      matches `MsearchMultisearchBody.knn`), `as never` removed. **Live-cluster
      verified** (2026-09-23) against the real `video-chunks` index: both the
      old `retriever`-in-msearch shape and the new top-level-`knn` shape
      return HTTP 200 with real hits on this deployment — so the specific
      "server rejects the request" failure mode did not reproduce here, but
      the fix is still correct (matches the documented/typed API, no more
      unverified `as never`) and this is the *first* live-cluster evidence
      this path has ever had, across three prior reviews that all said NOT
      RUN. Verified the exact `msearchFloorKnn` NDJSON pattern (3 header/body
      pairs, one `msearch` call) end to end. Added `msearchFloorKnn`
      documentation of the remaining owed check (F1's shape is now correct;
      relevance/latency of the floor path is still NOT RUN).
- [x] **F2 — a matched actor strips the rest of the query from BM25.** Fixed:
      `free_text` is now alias terms **plus** residual, not alias terms alone.
      Added `lib/metadata/query-parse.test.ts` regression:
      `"Audrey Hepburn Roman Holiday"` → `free_text` contains both
      `"audrey hepburn"` and `"roman holiday"`.
- [x] **F3 — five silent `catch` blocks, no logging in the hybrid path.**
      Fixed: added `logHybridDegradation(phase, err)` (structured
      `console.error`, matches the existing `lib/live/worker-loop.ts`
      convention) at all five degradation points
      (`lexical_expansion_failed`, `bm25_lexical_search_failed`,
      `semantic_expansion_failed`, `semantic_search_failed`,
      `facet_snapshot_failed`). Verified `attempts` was already incremented
      pre-call in every branch (not itself under-reporting); `es_http_requests`
      /`es_subsearches` are documented as counting *successful* round-trips by
      design, left unchanged.

## P2 — should fix

- [ ] **F4** — speculative embed is reused only when the parser extracted
      nothing, so a successful parse costs a second serialized embed
      (`hybrid-search.ts:733-767`).
- [ ] **F5** — injected `cfg` ignored by five ES helpers; explain payload can
      describe a query that was not run (`hybrid-search.ts:312, 360, 390,
      599, 652`).
- [ ] **F6** — `mapping-diff.ts:54-72` treats an absent key as a conflict, but
      Elasticsearch omits default-valued mapping parameters; this can break
      `yarn setup-indices` against a correct cluster. (`AGENTS.md` trap #8.)
- [ ] **F7** — filter-mode facet merge can produce `year_from > year_to`
      without re-validation (`app/api/search/route.ts:169-185`); only
      reachable with `QUERY_PARSER_FACET_MODE=filter`.
- [ ] **F8** — degraded EIS parses are cached for the full TTL
      (`resolve-query-parse.ts:313-314`).
- [ ] **F9** — span offsets computed on a lowercased string and applied to the
      original (`people.ts:191-195`, `query-parse.ts:298-300, 345-356`).

## P3 — repository hygiene

- [ ] Add `.next.failed-*/` and `.cursor/` to `.gitignore`. The failed build
      directory is **553 MB** and currently one `git add .` from being
      committed.
- [ ] Delete stale duplicates: `plan/03-hybrid-metadata-search-plan (1).md`
      (276 lines vs the live 1259), `todo/02-…-todo (1).md`,
      `chn.docs/混合元数据检索规划 (1).md`.
- [ ] Remove or promote `scripts/_probe-hur-jun-once.ts`.
- [x] Fix `lib/es/hybrid-search.test.ts:60` (`query_vector` not on
      `HybridQueryDslExplain`). Fixed 2026-09-23: the assertion checked a
      field that does not exist on the type; replaced with the correct
      `dsl.knn_global?.query_vector === 'omitted'` check the neighbouring
      comment already described. The pre-existing `ProcessEnv` errors in
      `lib/live/*.test.ts` are unrelated and were confirmed against `HEAD`.
- [ ] Commit the work. 33 modified tracked files and ~70 new files are
      currently uncommitted.

## Checked and rejected

- [x] "`meta.search_text` is never derived, so title/description/abstract can
      never match." Half true, wrong conclusion: the plan defines
      `search_text` as the `copy_to` target for `meta.actor_aliases` only, and
      `buildBm25Should` queries `title^2`, `meta.description` and
      `meta.abstract` with their own clauses. The symptom is real; the cause
      is **F2**.

## Confirmed working

- [x] G3 / trap #4 — create-or-partial-update ingest writes; script-thrown
      `revision_mismatch` is not retried by `retry_on_conflict`.
- [x] G4 — ready-ID allow-list applied whether or not facets are selected.
- [x] T-1 — `sort_by` has no `.default()`; defaulting happens after
      `hybrid.use_text` is known.
- [x] Hybrid and parsing both default off.
- [x] Eligibility enumeration, fusion formula and weights, `A`/`W` windows.
- [x] No hardcoded secrets.

## Gates

`yarn test` PASS (62 files / 428 tests, up from 61/380 — 5 new regression
tests added alongside the F1–F3 fixes). `yarn build` PASS (73.8s). `tsc
--noEmit` clean outside pre-existing, unrelated `lib/live/*.test.ts` errors
(confirmed against `HEAD`).

**Still NOT RUN:** labeled relevance, p50/p95 latency at the guaranteed-floor
budget, browser E2E, configured EIS parser, and the semantic channel. F1's
live-cluster check (2026-09-23) covered request-shape acceptance only, not
relevance or load.
