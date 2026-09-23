# Hybrid code recheck — 2026-09-23

Scope: current `d0b3403` code plus the small Suggest provenance correction in
this worktree. Rechecked the asynchronous Suggest path, Agent Builder names
contract, and the highest-risk hybrid search findings against current source.
This review supersedes the status wording of older reviews; their bodies remain
historical evidence.

## Verdict

**Suggest's code path is materially improved, but the hybrid feature is not
ready for implementation sign-off.** The browser now creates a background job,
polls visible stages, and can cancel it. The dedicated Agent skill requires
`names.en` and omits missing `zh`/`native` keys; `native.lang="ja"` means a
Japanese-script native name. The parser tolerates older `null` replies by
stripping those keys. The new UI shows sourced candidates and pending values.

This pass fixed two concrete UI provenance gaps: changed `country` now calls
`takeSource('country')` before PATCH, and an explicitly applied pending value
retains the Suggest `request_id` and retrieval timestamp. The schema example
in `plan/06` now says optional name keys are omitted, while documenting the
legacy-null sanitizer.
The Suggest callback also now depends on `country`, so changing only that field
cannot leave the captured draft and empty-field decision stale.

## Open findings, ordered by impact

1. **P1 — guaranteed lexical floor remains unverified.**
   `lib/es/hybrid-search.ts:392-415` places `retriever` in an `_msearch` body
   and casts `searches as never`. The installed Elasticsearch client 8.19.2
   `MsearchMultisearchBody` exposes `knn` but not `retriever`. This does not
   prove the current Serverless endpoint rejects it, but there is no
   live-cluster or unit coverage of the floor path. A rejection is swallowed
   at `hybrid-search.ts:874`, losing the lexical asset's guaranteed chunks.
   Use a client-supported request shape and verify the exact request against
   the target project before claiming candidate recall.
2. **P1 — actor plus title query loses title terms in BM25.**
   `lib/metadata/query-parse.ts:356-362` sets `free_text` to actor aliases
   whenever an actor is found, discarding `residual`. For `Audrey Hepburn Roman
   Holiday`, `Roman Holiday` is absent from the BM25 query even though it is
   the strongest work-title term. Append residual terms and add a regression.
3. **P1 — ES degradation is silent and attempt counts are incomplete.**
   `lib/es/hybrid-search.ts:874,881,947,951,967` catches failures without
   recording an error. Expansion and facet request counters are incremented
   only after success, so failures make cost/health telemetry look smaller.
   Keep a stable degraded-channel code and count attempted requests before
   sending them.
4. **P2 — standalone TypeScript check remains red.**
   `lib/es/hybrid-search.test.ts:60` accesses `HybridQueryDslExplain.query_vector`,
   a property absent from the type. The other current `tsc --noEmit` errors
   are in older `lib/live/*` test fixtures. `yarn build` does not typecheck
   those tests, so its success does not close this gate.
5. **Acceptance gap — current app-path Suggest and new UI controls.** The
   running container passed `GET /api/library` with HTTP 200, but it predates
   the latest actor-name/UI commit. The current build was verified locally.
   A POST Suggest smoke and browser interaction were not run in this pass:
   automatic command approval rejected the POST because it would send video
   title clues to the external Agent/Jina service and might consume quota.
   Live skill push and direct Korean/Chinese calls are recorded separately in
   `todo/23`; they do not prove this latest browser path.

## Gates in this pass

| Gate | Result |
| --- | --- |
| `yarn test` | **PASS**, 62 files / 398 tests |
| `yarn build` | **PASS** after all UI and provenance corrections (59.44s final run) |
| `git diff --check` | **PASS** |
| Container `GET /api/library` | **PASS**, HTTP 200 on the prior image |
| `tsc --noEmit` | **FAIL**, one hybrid test type error plus pre-existing live-test errors |
| Current-image browser/POST Suggest | **NOT RUN**, latest image not built; POST auto-review rejected external egress |
| Floor `_msearch` live shape, relevance and latency | **NOT RUN** |

Follow-up for the three hybrid blockers remains in
`todo/22-hybrid-independent-code-review-2026-09-23.md`. Suggest UI/browser
follow-up remains in `todo/23-actor-name-and-suggest-ui-2026-09-23.md`.
