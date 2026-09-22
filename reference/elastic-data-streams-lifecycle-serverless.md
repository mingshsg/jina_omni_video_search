---
title: "Elasticsearch data streams, Data Stream Lifecycle, and Serverless write semantics (live-video planning notes)"
sources:
  - https://www.elastic.co/docs/manage-data/data-store/data-streams
  - https://www.elastic.co/docs/manage-data/data-store/data-streams/use-data-stream
  - https://www.elastic.co/docs/manage-data/lifecycle/data-stream/tutorial-data-stream-retention
  - https://www.elastic.co/docs/deploy-manage/deploy/elastic-cloud/differences-from-other-elasticsearch-offerings
  - https://www.elastic.co/docs/reference/elasticsearch/rest-apis/optimistic-concurrency-control
downloaded: 2026-09-10
note: Condensed offline notes for the live-video plan (AD-6, AD-7, AD-8, AD-15). Prefer the live URLs for the latest text. Quotations are short excerpts; the rest is our summary.
---

# Why this document exists

The live-video plan stores `live-video-chunks` and `live-video-events` as
**create-only data streams with Data Stream Lifecycle (DSL)** and relies on
deterministic `_id` + `op_type=create` + HTTP 409 to make restart recovery
idempotent (`docs/live-video-data-model.md`, `docs/live-video-state-recovery.md`).
None of the existing files in `reference/` covered data streams, DSL, or the
Serverless write path. This note collects the facts the implementation depends
on and flags the one that the plan currently gets wrong.

# 1. Data stream fundamentals

- A data stream is an abstraction over hidden, auto-generated **backing
  indices**. Reads go to all backing indices; **writes go only to the current
  write index** (the newest backing index).
- Every document **must** carry `@timestamp` mapped as `date` or `date_nanos`.
  If the template does not map it, Elasticsearch maps it as `date` with default
  options. The plan maps `@timestamp = window_end_at` — correct.
- A data stream **requires a matching index template** with `data_stream: {}`.
  Templates cannot be deleted while in use.
- Backing index names (`.ds-<name>-<yyyy.MM.dd>-<generation>`) are an
  implementation detail: "no intelligence should be derived from it".

## Append-only rules (verbatim constraints)

> "You cannot add new documents to a data stream using the index API's
> `PUT /<target>/_doc/<_id>` request format. To specify a document ID, use the
> `PUT /<target>/_create/<_id>` format instead. Only an `op_type` of `create`
> is supported."

> Bulk: "Only `create` actions are supported."

Updates/deletes must target the **backing index** by name (obtained from a
search hit's `_index`) with `if_seq_no` / `if_primary_term`, or use
update-by-query / delete-by-query on the stream.

## `_id` uniqueness is per backing index — IMPORTANT for the plan

The suitability guidance says a data stream is a good fit when:

> "You index documents without an `_id`, or when indexing documents with an
> explicit `_id` you expect first-write-wins behavior."

and

> "If you frequently send multiple documents using the same `_id` expecting
> last-write-wins, you may want to use an index alias with a write index
> instead."

Combined with "The stream adds new documents to [the write] index only", the
consequence is:

**A `create` with an explicit `_id` is rejected with 409 only if that `_id`
already exists in the *current write index*. After a rollover, the same `_id`
can be created again in the new write index, producing two documents with the
same `_id` in different backing indices.** Both are returned by search.

Implications for `live-video-chunks` and `live-video-events`:

1. Recovery replay after a worker crash **cannot rely on 409** as the duplicate
   detector across a rollover boundary. Rollover timing on Serverless is
   managed by Elastic and is not under application control.
2. Before re-creating any window or event during recovery, the worker must
   run a `term` query on `chunk_id` (or `event_id`) against the data stream
   and fingerprint-verify the hit, treating "found" the same way the plan
   currently treats a fingerprint-matching 409.
3. Defense in depth at query time: add `collapse: { field: "chunk_id" }` (or
   dedupe by `chunk_id` in the application after retrieval) so a rare
   duplicate can never surface as two logical hits (LVR-FR-14, LVR-NFR-4).
4. Alternatively, use plain indices with an alias and application-side
   retention (delete-by-query on `@timestamp`). That keeps exact `_id`
   uniqueness but loses DSL. The data-stream + query-before-create approach is
   the smaller change.

# 2. Data Stream Lifecycle (DSL) retention

- Retention is configured per data stream as `data_retention`, either in the
  index template (`template.lifecycle.data_retention`) for future streams or
  via `PUT /_data_stream/<name>/_lifecycle` for existing ones.
- Template example (from the tutorial):

  ```json
  PUT _index_template/my-template
  {
    "index_patterns": ["my-data-stream*"],
    "data_stream": {},
    "priority": 500,
    "template": { "lifecycle": { "data_retention": "7d" } },
    "_meta": { "description": "Template with data stream lifecycle" }
  }
  ```

  The plan's rule "index_patterns contains only the configured name, no broad
  wildcard" is compatible — a pattern may be an exact name.
- **Retention is a minimum, not an exact deletion time.** Verbatim: "Retention
  does not define the period that the data will be removed, but the minimum
  time period they will be kept." DSL deletes **rolled-over backing indices**
  whose `generation_time` (time since rollover) exceeds the effective
  retention. Documents therefore live for *retention + up to one rollover
  period*.
- Cluster-level `data_streams.lifecycle.retention.default` and `.max` may cap
  or fill in retention; the effective value is reported by
  `GET /_data_stream/<name>/_lifecycle` as `effective_retention` and
  `retention_determined_by`. Phase 1 read-back should assert on
  `effective_retention`, not on the configured value alone.
- Consequence for the plan's rule "event retention ≥ vector retention": it
  holds only at backing-index granularity. Configure `LIVE_EVENT_RETENTION`
  strictly greater than `LIVE_VECTOR_RETENTION` (for example `8d` vs `7d`)
  rather than equal, or accept that a cursor may occasionally expire while a
  chunk is still searchable.

# 3. Serverless-specific facts

From the "Compare Elastic Cloud Hosted and Serverless" page:

- **Data lifecycle management: Data stream lifecycle only** ("No data tiers in
  Serverless"). ILM is not available — the plan's "no ILM on Serverless" is
  correct.
- **Custom routing is not supported** (`_routing`, `routing` parameter). The
  plan does not use routing.
- **Baseline write latency is 200 ms**: "Writes are batched over a 200ms window
  to ensure durability ... single-document indexing can appear slower". Add
  this to the index-stage latency budget; micro-batching (as planned) is the
  recommended mitigation.
- **`refresh_interval` is a user-configurable index-level setting** in
  Serverless ("Indexing settings such as `refresh_interval`" are available;
  defaults "might have different default values or value constraints"). The
  plan's assumption that Serverless refresh dominates the budget should be
  **measured**, and `index.refresh_interval` on the live-chunks template is a
  legitimate knob if `refresh=wait_for` proves too slow.
- **Version reporting is not meaningful**: "`GET /` root API always reports
  the next target Elasticsearch release version ... does not indicate which
  features are available." The repository's "observed 9.6.0" therefore says
  nothing about API availability; use `build_flavor: serverless` to detect
  Serverless. Client compatibility is determined by the Serverless REST
  surface, not by that number.
- CORS is not available; browser code must go through the Next.js backend (the
  existing design already does this).

# 4. Optimistic concurrency and create semantics used by the plan

- `if_seq_no` + `if_primary_term` on index/update/delete requests reject the
  write with **409 `version_conflict_engine_exception`** if the document's
  current `_seq_no`/`_primary_term` differ. Search hits can return them with
  `seq_no_primary_term: true`; GET returns them by default. This is what the
  plan's compare-and-set on `live-video-sources.active_session_id` and on
  `live-video-sessions.reserved_revision` requires. Retry on 409 by
  re-reading, re-merging, and re-writing.
- `op_type=create` (or `PUT /<index>/_create/<id>`) on a **plain index** is
  create-if-absent with 409 on conflict; this is how the plan should create
  `live-video-sessions` documents. This works reliably on plain indices; see
  section 1 for why it is weaker on data streams.
- Bulk responses report **per-item** status; a 409 on one `create` item does
  not fail the request. The plan's "verify each bulk item independently" is
  required.
- `refresh=wait_for` on index/bulk waits until the next refresh makes the
  change visible; it does not force an immediate refresh by itself. On an
  index with a long `refresh_interval`, `wait_for` can stall accordingly.

# 5. Client support in the repository (checked 2026-09-10)

The installed `@elastic/elasticsearch` **8.19.2** already types the calls the
plan needs:

- `client.indices.putIndexTemplate({ name, index_patterns, data_stream: {}, template: { mappings, settings, lifecycle: { data_retention } }, _meta })`
  (`IndicesPutIndexTemplateIndexTemplateMapping.lifecycle` exists in
  `lib/api/types.d.ts`).
- `client.indices.createDataStream`, `getDataStream`, `getDataLifecycle`,
  `putDataLifecycle`, `explainDataLifecycle`.
- `client.bulk({ refresh: 'wait_for', operations: [{ create: { _index, _id } }, doc] })`.
- `client.index({ op_type: 'create', if_seq_no, if_primary_term })`.

The existing application already talks to the target Serverless project with
this client (index create, bulk, `retriever.rrf`, `_inference` via
`transport.request`). Phase 1 still needs an integration test against the
target project, but "upgrade the client" is not a prerequisite.

# 6. Checklist for the live-video implementation

- [ ] Template per data stream with exact-name `index_patterns`,
      `data_stream: {}`, strict mappings, `@timestamp: date`,
      `lifecycle.data_retention`, `_meta`.
- [ ] Read back `effective_retention` and `retention_determined_by`.
- [ ] All chunk/event writes use `create` with deterministic `_id`.
- [ ] Recovery replay: **search by `chunk_id`/`event_id` first**, then create;
      never treat "no 409" as proof of uniqueness.
- [ ] Retrieval: `collapse` or application dedupe on `chunk_id`.
- [ ] Event retention strictly greater than vector retention.
- [ ] Measure index+refresh latency on the target project before tuning
      `refresh_interval` or batch size.
