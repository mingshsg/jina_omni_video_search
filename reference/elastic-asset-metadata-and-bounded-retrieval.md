---
title: "Asset metadata in Elasticsearch: strict-mapping evolution, safe partial writes, and bounded filter/pagination limits"
sources:
  - https://www.elastic.co/docs/manage-data/data-store/mapping/explicit-mapping
  - https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/copy-to
  - https://www.elastic.co/docs/reference/elasticsearch/rest-apis/optimistic-concurrency-control
  - https://www.elastic.co/docs/reference/elasticsearch/rest-apis/paginate-search-results
  - https://www.elastic.co/docs/reference/query-languages/query-dsl/query-dsl-terms-query
  - https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-update
downloaded: 2026-09-22
note: Condensed offline notes for plan/03-hybrid-metadata-search-plan.md (Phases 1–3). Short quotations from the Elastic docs; the rest is our summary and arithmetic. Re-verify against the live URLs before relying on a default value.
---

# Why this document exists

The hybrid-metadata plan adds `meta.*` to the existing `dynamic: strict`
`video-assets` index, writes it through an API that must not collide with
ingestion, and builds a hard-filter allow-list of video IDs that feeds the
chunk kNN. Three mechanics decide whether that plan is implementable as
written, and none of them were covered by the existing `reference/` library:

1. what a strict mapping lets you add in place versus what needs a reindex;
2. what a partial/scripted update actually does to an existing document;
3. what the real size limits are on ID enumeration and `terms` filters.

# 1. Evolving a `dynamic: strict` mapping in place

`lib/es/indices.ts` creates `video-assets` with `dynamic: 'strict'`.

**Adding new fields to an existing index is supported.** From the explicit
mapping docs:

> "You can use the [update mapping] API to add one or more new fields to an
> existing index."

So `PUT /video-assets/_mapping` with just the new `meta` properties is a valid,
additive, idempotent-if-identical upgrade. `ensureIndex()` in
`lib/es/indices.ts` currently returns `'skipped'` for an existing index and
never calls `putMapping`, so this is new code, exactly as the plan states.

**Changing an existing field is not supported.**

> "Except for supported mapping parameters, you can't change the mapping or
> field type of an existing field. Changing an existing field could invalidate
> data that's already indexed. … create a new index with the correct mapping
> and reindex your data into that index."

Consequences for this plan:

- Root `title` is already `text` with a `.keyword` subfield. **Adding a
  `copy_to` to it would be a mapping-parameter change on an existing field**
  and, even if accepted, would only apply to documents indexed afterwards. The
  plan's decision to query root `title` directly instead of copying it is the
  correct one and avoids a full backfill.
- `meta.search_text`, `meta.actors_key`, `meta.tags_key` and the fixed
  `meta.review.*` children are all *new* fields, so they can be added in place.
- Renaming later requires a `field alias`, not a mapping edit.

**Verification to run once, on a populated copy**: `PUT _mapping` with the new
properties, then `GET _mapping` and diff; then run `PUT _mapping` again and
confirm a 200 with no change (idempotent rerun). Also confirm the update is
rejected when a property conflicts, so the setup script can report
`conflicted` rather than silently diverging.

# 2. `copy_to` under a strict mapping

From the `copy_to` reference:

- "It is the field *value* which is copied, not the terms."
- "The original `_source` field will not be modified to show the copied
  values." → snippets/highlights must come from the original field, never from
  `meta.search_text`.
- "If `dynamic` is set to `strict`, copying to a non-existent field will result
  in an error." → `meta.search_text` **must** exist in the mapping before any
  document carrying `meta.actors` is indexed. Order the migration: add mapping
  first, then allow writes.
- "If the target field is nested, then `copy_to` fields must specify the full
  path … Omitting the full path will lead to a `strict_dynamic_mapping_exception`.
  Use `"copy_to": ["parent_field.child_field"]`." → the plan's
  `copy_to: "meta.search_text"` (fully qualified) is required and correct; a
  bare `"search_text"` would throw.
- "You cannot copy recursively using intermediary fields." → not an issue here
  (only `meta.actors` copies), but do not later chain `description → search_text
  → something_else`.

**`copy_to` applies at index time only.** Existing assets will not gain
`meta.search_text` content from a mapping change alone. This is harmless for
this plan because no existing asset has `meta.actors` yet — but the moment
anyone backfills actor names by a route that does not re-index the document,
the field will be silently empty. Every write path that sets `meta.actors`
must go through a real index/update operation.

Note `actors` is a `keyword` array and `meta.search_text` is `text`: copying a
keyword value into a text field is exactly the right way to make exact-match
names searchable by BM25, because the target field's analyzer runs on the
copied value.

# 3. Partial and scripted updates

## What `_update` does

`POST /<index>/_update/<id>` with a `doc` performs a **shallow merge** of the
partial document into the stored `_source`, then re-indexes the whole document.
Key consequences:

- **Objects merge; arrays do not.** Supplying `variants` replaces the entire
  array. This is fine for the plan because callers already merge variants in
  memory, but it must be stated: a partial ingest update still rewrites the
  whole `variants` array.
- Because the document is re-indexed, `copy_to` re-runs on every update. A
  metadata PATCH that changes `meta.actors` correctly refreshes
  `meta.search_text`; clearing actors correctly empties it.
- `_update` on a missing document returns **404 `document_missing_exception`**
  unless `doc_as_upsert`/`upsert` is supplied. The plan's "no upsert path,
  404 if absent" is therefore the default behaviour — just do not add
  `doc_as_upsert`.
- `retry_on_conflict=N` makes Elasticsearch re-read and re-apply the update on
  a version conflict. Useful for the **ingest** writer (progress updates are
  idempotent and last-write-wins is acceptable). It must **not** be used to
  paper over a metadata edit conflict, which needs to surface as 409.

## Two safe concurrency designs

Optimistic concurrency control uses `_seq_no`/`_primary_term`:

> "By noting down the sequence number and primary term returned, you can make
> sure to only change the document if no other change was made to it since you
> retrieved it. This is done by setting the `if_seq_no` and `if_primary_term`
> parameters."

That is **document-level**. In this application ingest and the editor write to
the same asset document, so `if_seq_no` would make a routine job-progress write
invalidate an in-flight metadata edit — a false conflict. Hence the plan's
choice of a **field-level guard inside a script**:

```json
POST /video-assets/_update/<video_id>
{
  "script": {
    "source": "if (ctx._source.meta == null) { if (params.expected != 0) { throw new IllegalArgumentException('conflict'); } ctx._source.meta = params.init; } else if (ctx._source.meta.revision != params.expected) { throw new IllegalArgumentException('conflict'); } ... ",
    "params": { "expected": 3, "patch": { }, "init": { } }
  }
}
```

Points to settle in implementation:

- **Bootstrap.** Existing assets have **no `meta` object at all**. Define
  `expected_revision = 0` as "no metadata yet" and have the script create
  `meta` with `revision = 1`. The plan currently does not state this case.
- Signal a conflict by throwing from the script and mapping the resulting
  400 to HTTP 409, or by having the script no-op (`ctx.op = 'noop'`) and
  returning the current revision — pick one and test it.
- `refresh=wait_for` on the update makes the edit visible to the next search,
  as the plan requires.
- Scripted updates are ordinary Painless; they are unrelated to *scripted
  metric aggregations*, which are the thing unavailable on Serverless.
  Still worth one integration test on the target project.

**Ingest side:** switch `persistJob` from `client.index()` (whole-document
replace) to `client.update({ doc: <ingest-owned fields only>, retry_on_conflict: 3 })`,
and keep a single `op_type=create` (or first `index`) for asset creation. This
is the only change that actually prevents metadata loss; adding the PATCH
endpoint alone does not.

# 4. Bounded ID enumeration and `terms` filters

## `index.max_result_window` = 10,000

> "By default, you cannot use `from` and `size` to page through more than
> 10,000 hits. This limit is a safeguard set by the `index.max_result_window`
> index setting."

The plan caps the eligible set at 10,000 IDs — i.e. exactly the single-request
window. Therefore **`search_after` + point-in-time is not required** for the
declared limit. A single request is enough:

```json
POST /video-assets/_search
{
  "size": 10000,
  "_source": false,
  "track_total_hits": 10001,
  "query": { "bool": { "filter": [ /* facets + nested ready variant */ ] } }
}
```

- `_id` of an asset **is** the `video_id` (`upsertAsset` uses
  `id: doc.video_id`), so `_source: false` still yields every ID. No field
  fetch needed.
- `track_total_hits: 10001` returns `total.relation: "gte"` when more than
  10,000 match — a cheap, exact overflow signal for `FILTER_SCOPE_TOO_LARGE`.
- This replaces up to **20 sequential round trips** (500 IDs per page) with
  one, which matters because the enumeration is on the critical path of an
  interactive search, before embedding and before kNN.

Keep PIT + `search_after` in reserve for a future limit above 10,000; at that
point the whole allow-list approach (Option A) should be re-evaluated against
denormalization (Option B) anyway.

## `terms` query size

The default `index.max_terms_count` is **65,536**, so a 10,000-ID `terms`
filter is accepted. The real costs are elsewhere:

- request body size — 10,000 UUIDs ≈ 380 KB of JSON, sent on every kNN branch
  that uses the global path;
- kNN filtering — the `filter` on a kNN branch is a **pre-filter applied during
  approximate graph search** (see `reference/elastic-knn-query.md`). A large or
  highly selective filter can degrade HNSW traversal or push Elasticsearch to
  exact search. With `bbq_hnsw` and `num_candidates = min(max(k*2,50),10000)`
  as currently computed in `lib/es/search-core.ts`, this must be measured, not
  assumed.

A cheap optimisation worth testing: when the eligible set is *all* ready assets
of that variant (no facets selected), omit the ID filter entirely and keep only
`variant_id`.

## Per-asset top-N is not free

A single kNN returns a global top-k; it cannot return "5 best chunks for each
of 20 assets". Options, cheapest first:

1. **One kNN over the 20-asset ID set** with `k = 100`, then cap per asset in
   the application. One request per modality. Distribution is uneven — a
   strongly matching video may take most of the 100 — but the plan already caps
   per-video output groups, so this is usually acceptable.
2. **`collapse` on `video_id` with `inner_hits`** — still limited by what the
   top-k contained, so it does not guarantee 5 per asset.
3. **`msearch` of 20 single-video kNN queries** per modality — guarantees the
   per-asset budget, but is 20–40 kNN executions per user search.

Option 1 is the recommended MVP; escalate only if recall testing shows the
lexical path is starved.

# 5. Score comparability across the two candidate paths

The plan assigns each modality rank by sorting the union of that modality's
hits by raw kNN `_score`. That is sound, because with `similarity: cosine`
Elasticsearch's kNN `_score` is a pure function of the query and document
vectors — it does not depend on the corpus or the filter. So a score from the
global branch and a score from a single-video branch are directly comparable,
and a chunk missing from the global top-W will normally sort below it.

Two caveats to test rather than assume:

- `bbq_hnsw` is quantized and approximate. The same (query, document) pair can
  in principle score slightly differently when `num_candidates`/oversampling
  differ between a 10,000-video search and a single-video search.
- Approximate search may legitimately *miss* a true top-W chunk; the lexical
  path then surfaces it with a score above the global cut-off. That is a
  recall repair and should be allowed to sort high — do not clamp injected
  candidates to ranks below the global window.

# 6. Checklist

- [ ] `PUT _mapping` adds `meta.*` to the live index; rerun is a no-op; conflicts are reported.
- [ ] `meta.search_text` exists before any `meta.actors` write; `copy_to` uses the fully qualified path.
- [ ] Snippets/highlights read original fields, never `meta.search_text`.
- [ ] `persistJob` becomes a partial `_update` of ingest-owned fields with `retry_on_conflict`.
- [ ] Metadata PATCH is a script guarded on `meta.revision`, no upsert, `refresh=wait_for`, 404/409 mapped; `revision = 0` bootstrap for assets with no `meta`.
- [ ] Eligible-ID enumeration is one request with `size: 10000`, `_source: false`, `track_total_hits: 10001`.
- [ ] Lexical-path expansion uses one kNN over the asset ID set, capped per asset in the app.
- [ ] Measure kNN latency with a large ID pre-filter before freezing the 10,000 cap.
