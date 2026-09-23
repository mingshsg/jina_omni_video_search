# Hybrid metadata search — Phase 2 implementation review

Reviewed 2026-09-22 on `live-video-search` at `b303e15` plus the current
uncommitted Phase 1/2 worktree. Scope: facet validation, asset-ID enumeration,
chunk prefilters, text and image routes, UI, and read-only checks against the
configured Elasticsearch instance. No implementation files or instance data
were changed by this review.

**Verdict: Phase 2 is not ready to mark complete.** The asset-to-chunk filter
flow is structurally correct and works on the small live fixture, but one
overflow boundary silently truncates eligible assets and the text UI can
silently drop a selected year filter. The image API accepts filters, while its
UI does not expose them; full API-path and large-scope acceptance remains open.

## Findings

### P1 — Exactly 10,001 eligible assets pass the 10,000 cap without an error

`lib/metadata/search-filters.ts:273–300` requests `size: 10000` and
`track_total_hits: 10001`, but rejects overflow only when
`relation === 'gte' && total > 10000`. Elasticsearch tracks the exact count
through the supplied threshold: at **10,001** matches the response can be
`{ value: 10001, relation: 'eq' }`. The current condition is false, so only
the first 10,000 IDs become the hard-filter scope and one valid asset silently
disappears. This violates the planned `FILTER_SCOPE_TOO_LARGE` contract.

**Fix:** reject whenever `total > FILTER_SCOPE_CAP`, regardless of relation;
also fail closed on an unexpected `gte` or missing/ambiguous total rather than
using the returned hit count as proof of completeness. Test 10,000, 10,001,
and more than 10,001 matches with mocked ES responses and, if practical, a
disposable index. [Elasticsearch's search API](https://www.elastic.co/docs/solutions/search/the-search-api)
defines `eq` as exact and says integer `track_total_hits` remains exact up to
that threshold. The live instance has only 26 assets, so this boundary was
confirmed by code/API semantics, not a large live fixture.

### P1 — A non-integer year entered in the text-search UI is silently omitted

`components/SearchFacets.tsx:48–55` converts a non-empty year input with
`Number(...)` and only assigns it when `Number.isInteger` is true. For example,
`1960.5` stays visibly entered, but `facetsToApiFilters` emits no `year_from`.
The server correctly rejects the same value if received directly. If this is
the only selected facet, the request has no `filters` at all and searches the
entire vector corpus; with other facets, it broadens the intersection. This
breaks the plan's “never silently drop a selected filter” rule.

**Fix:** keep the entered value in validation state and block submission with
an inline error, or submit it and show the server's 400. Do not omit a
non-empty invalid value. Add a UI-to-request test for malformed and reversed
year bounds.

### P2 — The image-search UI cannot select Phase 2 facets

The JSON and multipart image routes parse `filters`, and
`searchChunksByImage` uses the same eligible-ID prefilter as text search. But
`app/search-image/page.tsx:245–267` has no `SearchFacets` state/component and
never appends a multipart `filters` field. Users of the image page cannot use
the feature even though the API supports it. The main Phase 2 todo notes the
UI is “still thin” while checking off the search UI item; the plan's touch
list includes the image page.

**Fix:** either reuse `SearchFacets` on the image page and send the serialized
filters, or explicitly narrow Phase 2's UI deliverable to text search and
leave a visible unchecked image-UI task. Keep JSON/multipart API coverage.

### P2 — Multipart image request validation differs from JSON

`app/api/search/image/route.ts:62–67,109–117` silently defaults an invalid
or non-finite `size`, truncates a fractional value, and does not apply the
JSON route's `size <= 100`, `variant_id <= 64`, or `video_id <= 128` bounds.
The downstream search clamps size, but clients receive a normal result rather
than a 400 for invalid input. **Fix:** validate a parsed multipart DTO with
the same shared schema as JSON before image preparation or embedding; add
equivalent tests for both transports.

### P2 — Acceptance coverage does not yet prove the route contract

The five new `search-filters` tests cover normalization and query shape, but
not 10,000/10,001 overflow, empty eligibility before embedding, `video_id`
conflicts through the route, image JSON/multipart parity, lookup failure,
cross-script actor selection, or actual chunk-hit isolation. Large-ID kNN
latency is already an unchecked Phase 2 todo. These are evidence gaps, not
observed failures on the current 26-asset instance.

## What works on the configured instance

Read-only Elasticsearch queries used the same nested ready-variant and asset
facet clauses as the implementation. The one asset with actor metadata was
returned by `meta.actor_ids` under a ready variant. Adding a wrong explicit
`video_id`, impossible year, or nonexistent ready variant each returned zero
assets. The eligible asset has 402 matching chunk documents. A `size: 10000`,
`track_total_hits: 10001` lookup completed on this fixture (2 ms server
`took` for the positive actor query). This verifies the basic ES query shape,
not the app route or large-scope latency.

The code short-circuits empty eligible sets before embedding; filters join
with AND across fields and `terms` gives ANY within an array. Existing
no-facet vector search stays on the legacy path; the ready-only allow-list for
hybrid-without-facets is intentionally deferred to Phase 3.

## Verification status

- **PASS:** `yarn test` — 50 files, 267 tests; focused facet/search tests 20/20.
- **PASS:** read-only ready/actor, actor+wrong-video, actor+wrong-year,
  actor+wrong-variant ES queries above; `git diff --check`.
- **FAIL:** repository-wide TypeScript check — 41 errors in unchanged
  `lib/live/*.test.ts` `ProcessEnv` fixtures; no Phase 2 file named.
- **NOT RUN:** text/image API end-to-end requests, browser UI, >10,000 fixture,
  forced ES lookup failure, and large allow-list kNN p95. The instance has 26
  assets, only one with actor metadata, so it cannot establish broad facet
  coverage or the overflow threshold.

Follow-up: [`todo/06-hybrid-phase2-implementation-review-2026-09-22.md`](../todo/06-hybrid-phase2-implementation-review-2026-09-22.md).
