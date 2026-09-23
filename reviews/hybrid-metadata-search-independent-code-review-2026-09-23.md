# Hybrid metadata search — independent code review, 2026-09-23

Scope: the current **uncommitted** hybrid feature in the working tree on
`live-video-search` (33 modified tracked files, ~70 new files, zero commits),
reviewed against `plan/03-hybrid-metadata-search-plan.md`, the G1–G8
corrections in `todo/04`, and the traps recorded in `AGENTS.md`. Read-only:
no file was modified, no index or deployment was mutated. This does not
replace the dated phase reviews; it is an independent pass over the whole
worktree.

**Verdict: gates are green but they do not cover the highest-risk path.**
`yarn test` passes 61 files / 380 tests and `yarn build` completes in 75s, yet
the guaranteed-recall floor — the mechanism G5 exists to provide — uses an
Elasticsearch request shape the installed client does not type, is reachable
only through a silent `catch`, and has no test and no live-cluster evidence.
Three P1 items below should be closed before this work is committed.

The G1–G8 corrections and the `AGENTS.md` traps are, with those exceptions,
correctly implemented. That part of the work is good and is recorded at the
end of this document rather than omitted.

## P1 — blocking

### F1 — The guaranteed floor sends `retriever` in an `_msearch` body, with the type error suppressed

`lib/es/hybrid-search.ts:392-415`

```ts
searches.push({
  size: 2,
  _source: [...FILE_SOURCE_FIELDS],
  retriever: { knn: knnRetrieverBody(params.field, 2, /* … */) },
});
// …
const res = await client.msearch({ searches: searches as never });
```

`MsearchMultisearchBody` in the installed client (8.19.2,
`node_modules/@elastic/elasticsearch/lib/api/types.d.ts`) exposes `query` and
`knn?: KnnSearch | KnnSearch[]`. It has **no `retriever` key**. The
`searches as never` cast is the only reason this compiles.

Impact. This is the entire G5 floor. If the cluster rejects `retriever` in a
multi-search body, `msearchFloorKnn` throws, the failure is caught at
`hybrid-search.ts:874`, `lexical` becomes `[]`, and the BM25 rank-1 asset
receives **zero candidates** — precisely the outcome the floor was introduced
to make impossible (`plan/03-…` §B step 3, `todo/04` G5). The only external
signal is `text_channel_status: 'failed'` in the response body.

Evidence that this is unverified rather than merely untyped:

- `lib/es/hybrid-search.test.ts` covers `buildBm25Should`,
  `buildHybridQueryDslExplain` and `truncateIdList` only. There is no test for
  `msearchFloorKnn`, `expandLexicalChunks` or `searchChunksHybrid`.
- `reviews/hybrid-metadata-search-phase3-3.5-3.6-review-2026-09-22.md` lists
  "forced partial `msearch` failure" under **NOT RUN**.

Required: use the msearch-supported top-level `knn` form, remove the
`as never`, and verify against the target cluster. A unit test cannot settle
this — the question is what the server accepts.

### F2 — A matched actor removes the rest of the query from BM25

`lib/metadata/query-parse.ts:355-361`, consumed at `app/api/search/route.ts:246`

```ts
const residual = stripSpans(raw, spans);
const freeParts: string[] = [];
if (extracted.actor_ids?.length) {
  freeParts.push(...actors.map((a) => a.alias));
}
const free_text = freeParts.length > 0 ? freeParts.join(' ') : residual || raw.trim();
```

`bm25Query = parsed.free_text`, so for `"Audrey Hepburn Roman Holiday"` the
BM25 branch receives `"Audrey Hepburn"` and `"Roman Holiday"` reaches only the
vector channel. `buildBm25Should` does query `title^2`, `meta.description` and
`meta.abstract` directly (`lib/es/hybrid-search.ts` ~line 434-453), so the
clauses exist — they are simply fed a query with the title removed.

This inverts the stated reason for choosing a structured `bool.should` over a
flat `multi_match`: that a name can straddle fields, "Audrey" in the title and
"Hepburn" in the aliases. `free_text` should be alias terms **plus** residual.

### F3 — Five silent `catch` blocks and no logging in the hybrid path

`lib/es/hybrid-search.ts:874, 881, 947, 951, 967`

```
$ grep -n "console\.\|logger" lib/es/hybrid-search.ts
(no output)
```

A persistent Elasticsearch failure on the assets or chunks index — mapping
drift, expired credentials, a circuit breaker — degrades hybrid to
vector-only **indefinitely and silently**. The blocks at `:951` and `:967` do
not even set a status field; the semantic channel and facet boosts simply
disappear from the response.

Compounding: the request counters are incremented only on the success paths
(`:851-853`, `:924-927`, `:965-966`), so `branch.es_attempts` and
`es_http_requests` **under-report load exactly when requests are failing**. A
degraded request and a cheap request are indistinguishable in telemetry, which
removes the one signal that would surface F1 in production.

## P2 — should fix

| # | Location | Problem |
| --- | --- | --- |
| F4 | `hybrid-search.ts:733-767` | The speculative-embed optimization is inverted. The pre-warmed vector is reused **only when the parser extracted nothing**; as soon as an actor, year, country or type matches, the residual differs and a second serialized embed is issued — adding a round trip to precisely the queries the parser exists to serve. `embedCalls` correctly reports 2, so the cost is visible. |
| F5 | `hybrid-search.ts:312, 360, 390, 599, 652` | Injected `cfg` is ignored. `searchChunksHybrid(params, cfg)` uses the injected config for `embedQueryVector` and the explain payload, but `searchLexicalAssets`, `knnChunks`, `msearchFloorKnn`, `searchSemanticAssets` and `loadAssetFacetSnapshots` each call `getConfig()` internally. A caller passing `cfg` receives a response describing a query that was not run. Note `:892` gates on `config.ASSET_SEMANTIC_ENABLED` while `:602` re-reads `cfg.ASSET_SEMANTIC_ENABLED` from the global. |
| F6 | `mapping-diff.ts:54-72` | `!(key in existing)` is treated as a hard conflict, but Elasticsearch **omits mapping parameters equal to their default** in `getMapping` output — `index: true` and `similarity: 'cosine'` on a `dense_vector` are exactly that case. Against a cluster whose mapping is correct, `upgradeVideoAssetsMapping` can throw `MappingUpgradeConflictError` and break `yarn setup-indices`. This is `AGENTS.md` trap #8 in another costume. |
| F7 | `app/api/search/route.ts:169-185` | Filter-mode facet merge can build an impossible year range. `year_from` takes `Math.max`, `year_to` takes `Math.min`, and the merged object never returns through `parseSearchFilters`, which is where `year_from <= year_to` is enforced. Selecting 1990–1995 with an extracted 2010 yields `gte: 2010, lte: 1995` → zero eligible assets, no explanation. Reachable only when `QUERY_PARSER_FACET_MODE=filter`, which is not the default. |
| F8 | `resolve-query-parse.ts:313-314` | A degraded parse is written to the cache. One EIS blip pins that query to a dictionary-only parse for the whole `QUERY_PARSER_CACHE_TTL_MS`. Fallbacks should not be cached, or should carry a much shorter TTL. |
| F9 | `people.ts:191-195`, `query-parse.ts:298-300, 345-356` | Span arithmetic is computed on a lowercased string and applied to the original. `'İstanbul'.normalize('NFKC').toLowerCase()` is one UTF-16 unit longer than its source, so any such character shifts every subsequent offset, corrupting the residual and the alias text fed to BM25. |

## P3 — repository hygiene

| Item | Detail |
| --- | --- |
| `.next.failed-20260923-0950/` | **553 MB**, not in `.gitignore`. One `git add .` away from being committed. |
| `.cursor/` | Not in `.gitignore`. |
| `plan/03-hybrid-metadata-search-plan (1).md` | 276 lines against the live plan's 1259 — a stale duplicate. |
| `todo/02-hybrid-metadata-search-todo (1).md` | 50 lines; same pattern. |
| `chn.docs/混合元数据检索规划 (1).md` | 39 lines; same pattern. |
| `scripts/_probe-hur-jun-once.ts` | 44-line single-use probe left in the tree. |
| `.gitignore` | Not modified at all in this change. |
| `lib/es/hybrid-search.test.ts:60` | Real type error: `Property 'query_vector' does not exist on type 'HybridQueryDslExplain'`. `next build` does not catch it. The `ProcessEnv` errors in `lib/live/*.test.ts` are pre-existing — verified against `HEAD` — and unrelated to this change. |
| Commit state | 33 modified tracked files and ~70 new files, **zero commits**. Phases 1–4b plus two new plans (`plan/04`, `plan/05`) are all in the working tree. |

## Corrected during review — not defects

One finding raised during the pass was checked and rejected rather than
reported: that `meta.search_text` is never derived and therefore the
`match_phrase` clauses against it can never match a title, description or
abstract. The first half is true; the conclusion is not. The plan specifies
`search_text` as the `copy_to` target for `meta.actor_aliases` only, with
`title`, `meta.description` and `meta.abstract` queried by their own clauses —
which `buildBm25Should` does. The observable symptom is real, but its cause is
**F2**, not a missing derivation.

## What is implemented correctly

Verified against the tree, not taken on trust:

- **G3 / trap #4** — `persistJob` now routes through `createAssetIfAbsent` +
  `patchIngestOwnedFields` (`retry_on_conflict: 3`); `upsertAsset` is retained
  for scripts and tests. The Painless script throws `revision_mismatch`, which
  `retry_on_conflict` does not retry, so transport races and stale editor
  revisions are cleanly separated.
- **G4** — `searchChunksHybrid` calls `enumerateEligibleAssetIds`
  unconditionally (`hybrid-search.ts:694`), so the ready-ID allow-list applies
  with or without facets.
- **T-1** — `sort_by` no longer carries `.default()`
  (`app/api/search/route.ts:25-26`), with the reason in a comment; defaulting
  happens after `hybrid.use_text` is known.
- **Defaults off** — `use_text` and `parse_query` both default to `false`.
- **Eligibility** — single request, `size: 10000`, `_source: false`,
  `track_total_hits: 10001`, overflow → `FILTER_SCOPE_TOO_LARGE`; nested
  variant with `status=ready` required.
- **Fusion** — formula and weights match the plan; missing modality
  contributes zero rather than a default rank; `A` and `W` windows match.
- **Secrets** — no hardcoded credentials found in new or modified files;
  `.env.example` carries placeholders only.

## Gates

| Gate | Result |
| --- | --- |
| `yarn test` | **PASS** — 61 files, 380 tests |
| `yarn build` | **PASS** — 75.5s |
| `npx tsc --noEmit` | **1 new error** (`hybrid-search.test.ts:60`); remaining errors pre-existing in `lib/live/*.test.ts`, confirmed against `HEAD` |
| Secret scan | **PASS** |
| Live-cluster verification of the floor `msearch` | **NOT RUN** — and it is the one gate F1 depends on |
| Labeled relevance, p50/p95 latency, browser E2E, configured EIS parser, semantic channel | **NOT RUN** |

A green unit suite is not evidence for F1. The failing shape is a
server-accepted-request question, and the code path that would expose it is
wrapped in a `catch` that produces no log line.

Follow-up tracker: [`todo/22-hybrid-independent-code-review-2026-09-23.md`](../todo/22-hybrid-independent-code-review-2026-09-23.md).
