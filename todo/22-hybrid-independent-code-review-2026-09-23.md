# Independent hybrid code review follow-up — 2026-09-23

Review: [`hybrid-metadata-search-independent-code-review-2026-09-23.md`](../reviews/hybrid-metadata-search-independent-code-review-2026-09-23.md).
Scope: current uncommitted worktree on `live-video-search`. Nothing was
modified during the review. Prior phase findings remain open in `todo/05`,
`todo/06`, `todo/11`, `todo/14`, and `todo/16`.

## P1 — blocking, close before committing

- [ ] **F1 — floor `msearch` uses an unsupported `retriever` body.**
      `lib/es/hybrid-search.ts:392-415`. `MsearchMultisearchBody` (client
      8.19.2) has `query` and `knn` but no `retriever`; `searches as never`
      suppresses the error. Switch to the top-level `knn` form, remove the
      cast, and **verify against the target cluster** — a unit test cannot
      settle what the server accepts. Add coverage for `msearchFloorKnn` and
      `expandLexicalChunks`; today neither is tested.
- [ ] **F2 — a matched actor strips the rest of the query from BM25.**
      `lib/metadata/query-parse.ts:355-361`. `free_text` should be alias terms
      **plus** residual, not alias terms alone. Add a
      `"<actor> <title>"` case asserting the title tokens reach the BM25
      branch.
- [ ] **F3 — five silent `catch` blocks, no logging in the hybrid path.**
      `hybrid-search.ts:874, 881, 947, 951, 967`. Log every degraded branch
      with a stable code, and increment the request counters **before** the
      call so `es_attempts` / `es_http_requests` do not under-report on
      failure.

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
- [ ] Fix `lib/es/hybrid-search.test.ts:60` (`query_vector` not on
      `HybridQueryDslExplain`). The pre-existing `ProcessEnv` errors in
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

`yarn test` PASS (61 files / 380 tests). `yarn build` PASS (75.5s).
**NOT RUN:** live-cluster verification of the floor `msearch` — the one gate
F1 turns on — plus labeled relevance, p50/p95 latency, browser E2E,
configured EIS parser, and the semantic channel.
