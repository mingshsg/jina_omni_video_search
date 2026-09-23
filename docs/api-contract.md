# API contract

**Status:** Phase 11 close-out (2026-08-26) — verified against implemented routes.  
**Scope:** ingest job lifecycle, SSE progress, ingest/search/library/media shapes.  
Search modality attribution and RRF contract are **normative** as of Phase 8.

Related: [data-model.md](./data-model.md), [data-flow.md](./data-flow.md),
[plan/00-implementation-plan.md](../plan/00-implementation-plan.md).

---

## Conventions

- JSON request/response bodies; UTF-8.
- Errors never include credentials, raw URLs with query/userinfo, or filesystem paths
  outside sanitized provenance (`source_origin_path` + `source_fingerprint`).
- Timestamps are ISO-8601 UTC (`created_at`, `updated_at`, SSE `ts`).
- `video_id` is the asset document `_id`. Chunk `_id` =
  `{video_id}_{variant_id}_{chunk_index}` (upsert on re-ingest).

---

## Job state machine (FR-20)

### Asset / job status

| Status | Meaning |
| --- | --- |
| `pending` | Job accepted; source on disk; probe may already be available |
| `awaiting_confirm` | Workload estimate ready; pipeline not started (NFR-10) |
| `processing` | Pipeline running |
| `ready` | Variant indexed; **may include individually failed windows** |
| `failed` | Fatal failure (could not plan/run) **or** every window failed |

Per-variant `variants[].status` uses the same set (`pending` | `processing` |
`ready` | `failed`).

### Pipeline stages (`job.stage`)

| Stage | When |
| --- | --- |
| `accepted` | Job created |
| `estimating` | Windows planned; workload computed |
| `awaiting_confirm` | Waiting for confirm (when `auto_start: false`) |
| `playback_proxy` | Building or skipping 720p playback proxy |
| `encoding` | Per-window visual/audio proxies + thumbnail |
| `embedding` | Provider inference (passage) |
| `indexing` | Bulk upsert into `video-chunks` |
| `complete` | Terminal success (`status=ready`) |
| `failed` | Terminal failure (`status=failed`) |

### Transitions

```
pending
  → awaiting_confirm   (estimate ready, auto_start=false)
  → processing         (auto_start=true, default)

awaiting_confirm
  → processing         (POST /api/jobs/{id}/confirm)
  → failed             (optional cancel — not required in Phase 7)

processing
  → ready              (≥1 window indexed successfully)
  → failed             (fatal error, or 0 windows indexed)

ready | failed
  → processing         (POST /api/jobs/{id}/retry — idempotent manual retry)
```

### Crash / resume policy (explicit non-goals)

- **No automatic resume** after process death or mid-pipeline crash.
- Durability: job/asset state is written to Elasticsearch `video-assets` so the
  UI can show the last known status after a restart.
- Recovery: **idempotent manual retry** only — same `video_id` + `variant_id`
  re-upserts chunk `_id`s; chunk count for that variant must not grow.
- Failed windows are visible via SSE `window_failed` and a summary on the asset
  (`error` / variant `error`); they do not block other windows.

### In-memory job store (process-local)

- Active job progress for SSE lives in process memory (`lib/ingest/job-store.ts`)
  in addition to ES persistence.
- After a job reaches terminal `ready` or `failed`, the in-memory entry is
  eligible for drop (default TTL **5 minutes**, or ~30 s after the last SSE
  subscriber disconnects). This does **not** delete `video-assets` /
  `video-chunks` or media on disk (NFR-5).
- `GET /api/jobs/{id}/stream` and retry may **hydrate** a read-only snapshot
  from ES if the in-memory entry was already dropped.

---

## Workload estimate (NFR-10)

Computed after probe + window planning, **before** confirm (or emitted as the
first progress facts when `auto_start` is true):

| Field | Definition |
| --- | --- |
| `windows` | `planChunks(...).length` |
| `inference_calls` | `windows` if no audio; `2 * windows` if `has_audio` |
| `has_audio` | from ffprobe |
| `variant_id` | derived from current config |
| `chunk_preset` | `standard` \| `60s` \| `30s` \| `20s` \| `fine` \| `2s` \| `custom` |

This is a **workload** estimate (windows / inference calls), not currency cost.

---

## Throughput (NFR-9)

On `complete`, SSE (and the job snapshot) report:

- `throughput_windows_per_min` — successfully indexed windows ÷ elapsed minutes
  (from pipeline start to completion). Failed windows are excluded from the
  numerator.

---

## SSE event schema (FR-14)

**Endpoint:** `GET /api/jobs/{job_id}/stream`  
**Content-Type:** `text/event-stream`  
**Framing:** standard SSE — `event:` + `data:` (JSON) + blank line.  
**Heartbeat:** `event: heartbeat` about every 15 s while the connection is open.

### Event names

| `event` | Meaning |
| --- | --- |
| `snapshot` | Immediate state on connect (also after reconnect) |
| `estimate` | Workload estimate available |
| `progress` | Stage / percent / window counters changed |
| `window_done` | One window encoded, embedded, and queued/indexed |
| `window_failed` | One window failed; job continues |
| `complete` | Terminal `ready` |
| `error` | Terminal `failed` |
| `heartbeat` | Keep-alive |

### Payload shape (all events except bare heartbeat)

```json
{
  "job_id": "uuid",
  "video_id": "uuid",
  "status": "processing",
  "stage": "embedding",
  "progress_pct": 42.5,
  "windows_total": 8,
  "windows_done": 3,
  "windows_failed": 1,
  "current_chunk_index": 4,
  "variant_id": "a1b2c3d4e5f67890",
  "workload": {
    "windows": 8,
    "inference_calls": 16,
    "has_audio": true,
    "chunk_preset": "standard"
  },
  "throughput_windows_per_min": null,
  "message": "optional human-readable",
  "window_error": {
    "chunk_index": 2,
    "code": "PROXY_BUDGET_EXHAUSTED",
    "message": "safe summary"
  },
  "error": {
    "code": "PIPELINE_FATAL",
    "message": "safe summary"
  },
  "ts": "2026-08-26T04:00:00.000Z"
}
```

- `throughput_windows_per_min` is set on `complete` (and may appear on final
  `snapshot`).
- `window_error` only on `window_failed`.
- `error` on terminal `error` events (and failed snapshots).
- Clients should treat unknown fields as ignorable (forward compatible).

---

## Ingest APIs

### `POST /api/ingest`

JSON body (discriminated by `mode`):

```json
{ "mode": "url", "source": "https://example.com/a.mp4", "title": "optional", "auto_start": true, "chunk_preset": "30s" }
```

```json
{ "mode": "local", "source": "/abs/path/under/LOCAL_IMPORT_ROOT/a.mp4", "title": "optional", "auto_start": true, "chunk_preset": "standard" }
```

| Field | Default | Notes |
| --- | --- | --- |
| `auto_start` | `true` | If `false`, job stops at `awaiting_confirm` until confirm |
| `chunk_preset` | env `CHUNK_PRESET` | Named window: `standard` (64s/4s), `60s` (60s/4s), `30s` (30s/4s), `20s` (20s/2s), `fine` (10s/2s), `2s` (2s/1s). Hashes into `variant_id` so presets coexist. |
| `window_ms` + `overlap_ms` | — | Optional free-form alternative (both required together); optional `min_ms`. Labels as `custom` unless `chunk_preset` is also set. |

**200 response:**

```json
{
  "job_id": "uuid",
  "video_id": "uuid",
  "status": "processing",
  "mode": "url",
  "variant_id": "a1b2c3d4e5f67890",
  "workload": {
    "windows": 3,
    "inference_calls": 6,
    "has_audio": true,
    "chunk_preset": "standard"
  },
  "probe": {
    "duration_ms": 158000,
    "width": 1280,
    "height": 720,
    "has_audio": true
  },
  "provenance": {
    "source_origin_path": "https://example.com/a.mp4",
    "source_fingerprint": "hex…"
  }
}
```

`provenance` only for `mode=url`. Raw `source` is never echoed.

### `POST /api/ingest/upload`

`multipart/form-data`: field `file` (required), `title` (optional),
`auto_start` (`"true"` / `"false"`, default true), optional `chunk_preset`
(same names as JSON ingest) or `window_ms` + `overlap_ms` (+ optional `min_ms`).

Response shape matches JSON ingest (without `provenance`).

### `POST /api/ingest/batch`

Batch import: **one file = one movie** (`video_id`). Shared `chunk_preset` for
the whole batch. No URL mode.

**A. Multi-file upload** — `multipart/form-data`

- `files` (or `file`): one or more video files (max **20**)
- `chunk_preset` / `window_ms`+`overlap_ms` / `auto_start` — same as single upload

**B. Local folder** — `application/json`

```json
{
  "mode": "folder",
  "path": "/abs/path/under/LOCAL_IMPORT_ROOT/movies",
  "chunk_preset": "30s",
  "auto_start": true
}
```

Lists **immediate** child video files only (non-recursive). Requires
`LOCAL_IMPORT_ROOT`.

**200 response:**

```json
{
  "batch_id": "uuid",
  "chunk_preset": "30s",
  "chunk_window_ms": 30000,
  "chunk_overlap_ms": 4000,
  "job_ids": ["…", "…"],
  "jobs": [
    {
      "job_id": "…",
      "video_id": "…",
      "title": "movie-a",
      "status": "processing",
      "mode": "upload",
      "variant_id": "…",
      "workload": { "windows": 3, "inference_calls": 6, "has_audio": true, "chunk_preset": "30s" }
    }
  ],
  "errors": [
    { "source": "bad.xyz", "code": "INGEST_UPLOAD_EXTENSION", "message": "…" }
  ]
}
```

Partial success is allowed: some files may appear in `errors` while others start
as jobs. If every file fails, HTTP **400** with `INGEST_BATCH_EMPTY`.

### `POST /api/jobs/{job_id}/confirm`

Starts a job that is in `awaiting_confirm`. Idempotent if already `processing`
or terminal: returns current snapshot without double-starting.

**200:** same snapshot fields as ingest (`job_id`, `video_id`, `status`, …).

### `POST /api/jobs/{job_id}/retry`

Idempotent manual retry (FR-20): same `video_id` + prior job `chunking` /
`variant_id`; creates a **new** `job_id`, re-runs the pipeline, upserts the
same chunk `_id`s.

**200:** new `job_id` + workload + `video_id`.

### Ingest / job error shape

```json
{
  "error": {
    "code": "INGEST_URL_SSRF_BLOCKED",
    "message": "bilingual safe message"
  }
}
```

HTTP status mapping (ingest validation): `400` validation, `403` SSRF/traversal,
`404` local not found, `413` size, `504` URL timeout. Pipeline fatal errors are
delivered on SSE `error`, not necessarily as the original POST status (POST
returns after accept).

---

## Search API (FR-15 / FR-16 / FR-21) — normative

**Endpoint:** `POST /api/search`

### Request

```json
{
  "query": "a cat on a windowsill",
  "modality": "visual",
  "variant_id": "a1b2c3d4e5f67890",
  "video_id": null,
  "size": 20,
  "sort_by": "visual"
}
```

| Field | Required | Values / rules |
| --- | --- | --- |
| `query` | yes | non-empty string (max 2000) |
| `modality` | no (default `visual`) | `visual` \| `audio` \| `both` \| `all` \| `description`. `both` is a deprecated alias for the chunk-only RRF behavior below; prefer `all`, which runs the same chunk RRF **and** additionally merges in asset-level description-semantic matches (see "All mode" below). `description` is a separate asset-level-only branch (see "Description mode" below) |
| `variant_id` | **yes** | kNN **pre-filter** on every child retriever |
| `video_id` | no | optional single-video filter (`null` / omit = all videos in variant) |
| `size` | no (default 20) | top-k; server clamps to **1..100** |
| `sort_by` | no (default depends on hybrid) | `rrf` \| `visual` \| `audio` \| `hybrid`. Default is `visual` when `hybrid.use_text` is false/omitted; default is `hybrid` when `hybrid.use_text=true`. `rrf` only when `modality=both` (otherwise coerced to the active modality). `sort_by=hybrid` requires `hybrid.use_text=true`; other sorts are rejected while text hybrid is on |
| `filters` | no | optional facets (see below). When present, a single-request ready-variant asset-ID allow-list is applied to chunk knn. Pure vector search with `filters` omitted is unchanged |
| `hybrid` | no | `{ use_text?: boolean, text_mode?: "bm25" }`. Omitted / `use_text=false` keeps today's pure-vector path. `use_text=true` enables Phase 3 BM25 + app-side fusion and always applies the ready-ID allow-list |

### Facet filters (`filters`)

AND across fields; **ANY** within each array. Cap 20 values per array. Missing metadata fails a selected facet.

| Field | Semantics |
| --- | --- |
| `year_from` / `year_to` | Inclusive integer range on `meta.year` (`year_from <= year_to`) |
| `actor_ids` | Catalog person IDs (`meta.actor_ids`) |
| `video_type` | Controlled vocab |
| `primary_language` | Pinned BCP-47 tags (case-insensitive; stored canonical) |
| `country` | ISO alpha-2 from the 20-option catalog |
| `tags` | Normalized to `meta.tags_key` |

Overflow (>10,000 matching assets): **422** `FILTER_SCOPE_TOO_LARGE`. Empty eligibility returns zero hits before embedding.

Response `meta.filters` echoes the normalized filters; `meta.filter` reports `{ eligible_assets, enumeration_ms, filters_applied }` when facets ran.

Same `filters` object is accepted on `POST /api/search/image` (JSON body or multipart field `filters` as a JSON string). Image search never accepts `hybrid.use_text`.

### Hybrid text channel (`hybrid.use_text`, Phase 3)

Opt-in. When enabled:

1. Enumerate all ready assets (intersected with facets / explicit `video_id`).
2. Run BM25 over eligible assets (`meta.actor_keys`, `meta.search_text` / `.cjk`, title/description/abstract).
3. Retrieve a global per-modality knn window plus two-stage lexical chunk expansion.
4. Fuse ranks in the app: `score = Σ w_m/(60+rank_m) + 0.4/(60+rank_text)`.

Hits may include `score_kind: "hybrid_rrf"`, `rank_text`, `asset_text_score`, and `metadata_match` (true when the parent asset ranked in BM25). Labels never claim a person/event occurs at the shown timestamp — only that **video metadata matched**.

Response `meta` adds `hybrid`, `text_channel_status` (`ok`\|`empty`\|`failed`\|`disabled`), `ranking_strategy`, optional `branch` timings/counts, and optional `query_dsl` (truncated asset BM25 body + knn filter summary; allow-lists capped with `count`/`sample`/`truncated`; never includes `query_vector` values or secrets). Live search rejects `sort_by=hybrid`.

Optional `hybrid.parse_query` (default `false`, Phase 3.5): when `true` and `QUERY_PARSER_PROVIDER=dictionary`, response `meta.parse` carries dictionary extracted fields and the hybrid path may use `vector_query` / `free_text` channel inputs. Extracted facets apply as boosts (`w_facet=0.2`) **only when** `hybrid.use_text=true`; with `parse_query=true` and `use_text=false`, `meta.parse.rejected` uses `hybrid_text_required` and `meta.query_dsl.status` is `not_applied`. Omitted/`false` keeps Phase 3 behavior. Image search never accepts `parse_query`. The search UI turns on Include text when Smart parse is enabled.

`meta.parse.applied` is the set of extracted facets that were actually scored this request: hybrid on, `QUERY_PARSER_FACET_MODE=boost`, not suppressed, not duplicated by a hand-selected facet on the same field, **and** matching at least one fusion candidate. `meta.parse.rejected[]` lists every extracted value that was not scored with a `reason`: `not in catalog` / `out of range` / `not in candidate set` (validation), `hybrid_text_required` (parse on, hybrid off), `no_effect` (matched zero fusion candidates — a hard filter on the same value may still return results, because filters re-enumerate the catalog), `snapshot_unavailable`. `meta.parse.extracted` is the pre-effect extraction and is the source the UI renders chips from. `hybrid.suppress_extracted` (optional, ≤ 20 strings of ≤ 32 chars; recognised: `actor_ids` \| `year` (also `year_from` / `year_to`) \| `country` \| `video_type`; other strings are accepted and ignored) drops those extracted boosts for this request only.

**Planned (not shipped — see `plan/05-parse-chip-state-model.md`, PR-C):** additive only. `rejected[].reason` gains `hard_filter` for boosts dropped because the same field is hand-filtered. `suppress_extracted` items may be `field:value` (e.g. `country:KR`, `actor_ids:person:audrey-hepburn`), item length limit raised to 128; bare field names remain accepted. `applied` / `rejected` shapes do not change.

`ASSET_SEMANTIC_ENABLED` (default off): on metadata save, marks `description_embedding_meta.state=stale` and may publish a 1024-d `meta.description_embedding` when revision still matches. Hybrid search queries only `state: current` vectors as an asset-level RRF term (`w_semantic=0.3`). Name-/facet-only parses down-weight vector channels (`×0.25`).

When `QUERY_PARSER_PROVIDER=eis` and `hybrid.parse_query=true`, the server may call an EIS **completion** endpoint (`QUERY_PARSER_INFERENCE_ID`, timeout `QUERY_PARSER_TIMEOUT_MS`). Failures degrade to dictionary parse. Response `meta.parse` may include `parser: "eis"`, `eis_skipped`, `inference_id` (endpoint name only — never API keys).

### RRF / knn parameters (from config)

| Env | Role |
| --- | --- |
| `SEARCH_RANK_WINDOW_SIZE` | RRF `rank_window_size` and per-branch knn `k` (default **50**). Always raised to `>= size` — ES default of 10 is too small. |
| `SEARCH_RANK_CONSTANT` | RRF `rank_constant` (default **60**) |
| `SEARCH_WEIGHT_VIDEO` | weight on the visual knn child (default **1.0**) |
| `SEARCH_WEIGHT_AUDIO` | weight on the audio knn child (default **1.0**) |

Modality mapping:

- `visual` — single knn on `embedding_video`
- `audio` — single knn on `embedding_audio`
- `both` — Elasticsearch **RRF** over two weighted knn children (`embedding_video`, `embedding_audio`)

### Query vectors (provider-aware)

| Provider | Query vector |
| --- | --- |
| `eis` | `query_vector_builder.embedding` with `inference_id` + text `input` (pushed into ES) |
| `jina` / `local` | app-side `embedText(..., 'query')` with `EMBED_TASK_QUERY` (`retrieval.query`), then `query_vector` |

`query_vector` and `query_vector_builder` are never combined on the same knn.

### Response

```json
{
  "hits": [
    {
      "chunk_id": "video_variant_0",
      "video_id": "…",
      "variant_id": "…",
      "title": "trailer.mp4",
      "start_ms": 64000,
      "end_ms": 128000,
      "start_label": "01:04",
      "end_label": "02:08",
      "score": 0.016,
      "score_visual": 0.812,
      "score_audio": 0.641,
      "rank_visual": 2,
      "rank_audio": 4,
      "modality_badge": "visual",
      "thumb_url": "/api/thumb/{video_id}/{variant_id}/{chunk_index}"
    }
  ],
  "meta": {
    "size": 20,
    "rank_window_size": 50,
    "modality": "both",
    "sort_by": "rrf",
    "variant_id": "…",
    "video_id": null,
    "badge_strategy": "rrf_plus_parallel_knn",
    "took_ms": 420
  }
}
```

Score semantics:

| Field | Meaning |
| --- | --- |
| `score` | **RRF fused rank score** when `modality=both` (typically ~0.01–0.03 with `rank_constant=60`). For single-modality requests this is the knn `_score` (backward compatible). `0` means the hit was not in the RRF window (e.g. `sort_by=visual` on a chunk that only ranks in the visual knn list). |
| `score_visual` | Visual knn `_score` (cosine-related similarity, usually ~0–1). `null` if the chunk is not in the visual knn window, or when `modality=audio` (N/A). |
| `score_audio` | Audio knn `_score` (same similarity scale). `null` if not in the audio window, or when `modality=visual` (N/A). |
| `rank_visual` / `rank_audio` | 1-based rank in that knn window, or `null`. |

Do **not** compare `score` (RRF) with `score_visual` / `score_audio` (knn similarity); they are different metrics.

### Sort (`sort_by`)

Server-side. Variant / `video_id` filters still apply.

| `sort_by` | Hit list | Order |
| --- | --- | --- |
| `rrf` | RRF retriever (`modality=both` only) | fused RRF order |
| `visual` | Visual knn window, then top-`size` | `score_visual` descending |
| `audio` | Audio knn window, then top-`size` | `score_audio` descending |
| `hybrid` | App fusion of vector ranks + BM25 asset ranks (`hybrid.use_text=true`) | `score_hybrid` descending |

When `modality=both`, all three searches still run so each hit can carry RRF + both knn scores. Single-modality requests do not run the other branch (`score_*` stays `null`; asking to sort by the missing modality leaves knn order unchanged).

`thumb_url` is a stable path for the Phase 9 media route; ingest stores
`thumb_path` on the chunk document.

### Modality badge rule (locked)

**Chosen design:** run Elasticsearch **RRF for fused ranking**, then a
**parallel second path** — two knn searches with the same filters and
`rank_window_size` — to recover per-modality membership / 1-based rank for
returned `_id`s (`badge_strategy: "rrf_plus_parallel_knn"`).

Single-modality requests skip RRF (`badge_strategy: "single_knn"`); the badge
is that modality.

| Situation | `modality_badge` |
| --- | --- |
| Only visual branch window contains the chunk | `visual` |
| Only audio branch window contains the chunk | `audio` |
| Both branch windows contain the chunk | `both` |

Do **not** silently pick the higher-scoring modality when both hit — use
`both` so the UI can show dual attribution. Smoke:
`scripts/smoke-phase8-search.ts` (needs Phase 7 chunks).

### Description mode and All mode (plan/11, Phase item 4)

`modality: "description"` is a **separate, asset-level-only** branch
(`lib/es/description-search.ts`). It does not call `searchChunks` at all —
no chunk knn, no RRF, no `hybrid`/`sort_by`. It runs a `semantic_text` query
(`meta.description_semantic` / `meta.abstract_semantic` /
`meta.work_title_semantic`) over the variant's eligible assets and returns
one hit per matching **asset** (whole video, `start_ms=0`), not per chunk.
Requires `EMBED_INFERENCE_ID` to be configured (the mapping only gets the
`semantic_text` fields when it is); on a cluster where it isn't, results are
empty rather than erroring.

`modality: "all"` runs the **same chunk-level `modality=both` RRF search**
unchanged, plus the description-semantic query above concurrently, and
merges them as a **separate, appended section** — not a blended re-ranked
score (chunk RRF hits and asset-level semantic scores are not on comparable
scales). The response adds a `description_hits` array (same shape as
`description` mode's `hits`) containing only description matches whose
`video_id` did not already appear among the chunk hits; `meta.modality`
echoes back `"all"` and `meta.description_status` is `"ok"` or
`"unavailable"` (soft-fails to empty `description_hits` rather than 500 if
the semantic query errors, e.g. mapping not upgraded yet).

`both` remains accepted as a deprecated alias: identical to today's
chunk-only RRF behavior, without the `description_hits` merge.

### Search error shape

Same `{ "error": { "code", "message" } }` envelope.

| Code | HTTP | When |
| --- | --- | --- |
| `SEARCH_INVALID_REQUEST` | 400 | zod validation failure / non-JSON body |
| `SEARCH_FAILED` | 500 | Elasticsearch or embedding failure |

---

## Image search API — normative

**Endpoint:** `POST /api/search/image`

Image-to-video retrieval: embed the query image with the active
`EMBED_PROVIDER`, then knn **only** on `embedding_video`. No RRF / audio
branch. Hit shape matches text search.

### Request (multipart)

`Content-Type: multipart/form-data`

| Field | Required | Rules |
| --- | --- | --- |
| `file` (or `image`) | yes | JPEG / PNG / WebP / GIF; raw upload ≤ **10 MB** before compress |
| `variant_id` | yes | knn pre-filter |
| `video_id` | no | optional single-video filter |
| `size` | no (default 20) | top-k; clamped **1..100** |

### Request (JSON)

`Content-Type: application/json`

```json
{
  "image_base64": "data:image/jpeg;base64,…",
  "mime": "image/jpeg",
  "variant_id": "a1b2c3d4e5f67890",
  "video_id": null,
  "size": 20
}
```

`image_base64` may be a data URL or bare base64. Server resizes long edge to
`EMBED_MAX_LONG_EDGE` (default **1280**), recompresses to JPEG, and keeps
decoded bytes under the provider budget (`EIS_MAX_BINARY_BYTES` / etc.).

### Query vector

Always app-side `embedImage(..., 'query')` → knn `query_vector` on
`embedding_video` (EIS `_inference/embedding` with `type: image`; jina/local
`{ image: dataUrl }`). Text-search EIS `query_vector_builder` path is **not**
used here so the compressed bytes stay under budget before inference.

### Response

Same `hits[]` fields as `POST /api/search`. `meta`:

| Field | Value |
| --- | --- |
| `modality` | always `visual` |
| `sort_by` | always `visual` |
| `badge_strategy` | `single_knn` |
| `image_bytes` | JPEG bytes sent to the embed provider |
| `query_mime` | `image/jpeg` after prepare |

`score` / `score_visual` are the visual knn `_score`; `score_audio` /
`rank_audio` are `null`; `modality_badge` is `visual`.

### Image search errors

| Code | HTTP | When |
| --- | --- | --- |
| `SEARCH_INVALID_REQUEST` | 400 | bad Content-Type / missing fields / zod |
| `SEARCH_IMAGE_INVALID` | 400 | unsupported type / empty / prepare failure |
| `SEARCH_IMAGE_TOO_LARGE` | 413 | over upload or post-compress budget |
| `SEARCH_FAILED` | 500 | Elasticsearch or embedding failure |

---

## Library APIs (Phase 9)

### `GET /api/library`

**200:**

```json
{
  "assets": [
    {
      "video_id": "uuid",
      "title": "…",
      "source_mode": "upload",
      "duration_ms": 157459,
      "width": 1270,
      "height": 720,
      "has_audio": true,
      "status": "ready",
      "variants": [
        {
          "variant_id": "…",
          "chunk_preset": "standard",
          "chunk_count": 3,
          "status": "ready",
          "provider": "eis",
          "model": "jina-embeddings-v5-omni-small"
        }
      ],
      "created_at": "…",
      "updated_at": "…"
    }
  ],
  "variant_ids": ["…"]
}
```

`variant_ids` is the deduped set of **ready** variant ids (for the search UI).

### `DELETE /api/library/{videoId}`

Removes the asset document and all chunk documents for that `video_id` from
Elasticsearch. **Does not delete** files under `data/` (NFR-5).

| Code | HTTP | When |
| --- | --- | --- |
| `LIBRARY_INVALID` | 400 | Bad id |
| `LIBRARY_NOT_FOUND` | 404 | Unknown video |
| `LIBRARY_FAILED` | 500 | ES failure |

**200:** `{ "video_id", …deletion summary }`.

### `POST /api/library/batch-delete`

Remove many videos from Elasticsearch in one request. **Does not delete** files
under `data/` (NFR-5).

**Body:** `{ "video_ids": ["uuid", …] }` (1–200 ids).

| Code | HTTP | When |
| --- | --- | --- |
| `LIBRARY_INVALID` | 400 | Missing/invalid body or id |
| `LIBRARY_FAILED` | 500 | Unexpected ES failure |

**200:**

```json
{
  "requested": 3,
  "removed": 2,
  "failed": 1,
  "results": [
    { "video_id": "…", "ok": true, "deleted_asset": true, "deleted_chunks": 12 },
    { "video_id": "…", "ok": false, "deleted_asset": false, "deleted_chunks": 0, "error": "not_found" }
  ]
}
```

Per-id failures do not abort the rest of the batch.

### `GET /api/library/{videoId}`

Safe editor DTO — **no** internal media paths.

**200:**

```json
{
  "video_id": "uuid",
  "title": "…",
  "meta_revision": 0,
  "meta": {
    "description": "…",
    "abstract": "…",
    "year": 1961,
    "actors": ["Audrey Hepburn"],
    "actor_ids": ["person:audrey-hepburn"],
    "video_type": "trailer",
    "primary_language": "en",
    "country": "US",
    "tags": ["fashion"],
    "review": { "actors": { "source": "manual", "confirmed": true } }
  }
}
```

| Code | HTTP | When |
| --- | --- | --- |
| `LIBRARY_INVALID` | 400 | Bad id |
| `LIBRARY_NOT_FOUND` | 404 | Unknown video |
| `LIBRARY_FAILED` | 500 | ES failure |

### `PATCH /api/library/{videoId}/meta`

Atomic editorial update. Client sends **`actor_ids` only** (catalog IDs);
server derives `actors` / `actor_aliases` / `actor_keys` / `search_text`.
Omitted field = unchanged; `null` or empty array clears. Requires
`expected_revision` (`0` bootstraps assets with no `meta`).

**Body (example):**

```json
{
  "expected_revision": 0,
  "description": "…",
  "year": 1961,
  "actor_ids": ["person:audrey-hepburn"],
  "country": "US",
  "video_type": "trailer",
  "primary_language": "en",
  "tags": ["fashion"]
}
```

| Code | HTTP | When |
| --- | --- | --- |
| `LIBRARY_INVALID` | 400 | Bad id |
| `META_INVALID` / `META_UNKNOWN_ACTOR_ID` / `META_INVALID_*` | 400 | Validation |
| `LIBRARY_NOT_FOUND` | 404 | Unknown video |
| `META_CONFLICT` | 409 | Stale `expected_revision` (`current_revision` returned) |
| `META_TRANSPORT_CONFLICT` | 409 | Update-version retries exhausted while `meta.revision` unchanged (`retryable: true`) |
| `META_FAILED` | 500 | ES failure |

**200:** `{ "video_id", "meta_revision", "meta" }` (same shape as GET `meta`).

Ingest progress uses partial `_update` of ingest-owned fields with
`retry_on_conflict` and **never** replaces `meta`.

Optional `field_sources` on PATCH (`manual` | `suggestion` per field) records
provenance when the editor accepts a Suggest draft; omitted fields default to
`manual`. Optional `field_provenance` may retain bounded `confidence`,
`evidence`, `provider`, HTTPS `source_url`, `retrieved_at`, and `request_id` for
an accepted suggestion.

### `POST /api/library/{videoId}/meta/suggest`

Phase 4a/4b asynchronous draft suggestions. **Never writes** the asset. POST
creates a bounded background job and returns immediately; the editor polls GET
for `queued`, `preparing`, `researching`, `validating`, and terminal status.
DELETE cancels queued/running work. Save remains available while research runs.
Jobs are held in the single app process for ten minutes, with two active jobs,
six starts per client/video per minute, and a 64-job bound. A restart expires
their request IDs; a multi-replica deployment requires a shared job store.

The job always runs local title clues. Default enrichment:
`SUGGEST_WEB_PROVIDER=agent_builder` calls Kibana Agent Builder `converse`
(agent `SUGGEST_AGENT_ID`, tools `jina.search_web` / `jina.read_url`; Jina key
stays in the Kibana connector). The converse request sets `connector_id` from
`SUGGEST_AGENT_CONNECTOR_ID` (default `.google-gemini-3.5-flash-lite-chat_completion`
→ EIS `google-gemini-3.5-flash-lite`). Empty connector id uses the Kibana
project default model. Optional `jina` uses app REST Search+Reader.
Failures safely fall back to local drafts.

**Body (optional):**

```json
{
  "draft": {
    "year": null,
    "video_type": null,
    "primary_language": null,
    "country": null,
    "description": null,
    "abstract": null,
    "tags": null
  },
  "media_language": "en"
}
```

**202** (or **200** on a cache hit):

```json
{
  "request_id": "uuid",
  "video_id": "uuid",
  "meta_revision": 3,
  "status": "pending",
  "stage": "queued",
  "created_at": "2026-09-23T00:00:00.000Z",
  "updated_at": "2026-09-23T00:00:00.000Z"
}
```

### `GET /api/library/{videoId}/meta/suggest?request_id={uuid}`

Returns the same job envelope. While running, `status` is `pending`. On
completion, `status` is `complete` and `result` contains:

```json
{
  "request_id": "uuid",
  "video_id": "uuid",
  "meta_revision": 3,
  "retrieved_at": "2026-09-23T00:00:42.000Z",
  "title": "Official Trailer Unique Work 2020.mp4",
  "status": "ok",
  "provider": "local",
  "title_clues": {
    "normalized": "Official Trailer Unique Work 2020",
    "work_title": "Official Unique Work",
    "abstained": false,
    "abstain_reason": null
  },
  "suggestions": {
    "year": {
      "value": 2020,
      "confidence": 0.55,
      "source": "local_title",
      "evidence": "Unambiguous year 2020 in title"
    },
    "video_type": {
      "value": "trailer",
      "confidence": 0.5,
      "source": "local_title",
      "evidence": "Title token matched video_type=trailer"
    },
    "description": {
      "value": "Title indicates: “Official Unique Work”. This draft restates…",
      "confidence": 0.35,
      "source": "local_title",
      "evidence": "Title-clue prose from work_title=\"Official Unique Work\""
    },
    "tags": {
      "value": ["trailer", "2020"],
      "confidence": 0.45,
      "source": "local_title",
      "evidence": "Explicit title tokens → tags [trailer, 2020]"
    }
  }
}
```

Result `provider` is `local`, `local+agent`, or `local+jina`. The optional
`web` object includes status, allowlisted candidates/reads, elapsed time,
`agent_id`, and actor candidates. Each actor candidate has a required English
name, optional `zh`/`ko`/`ja` names, HTTPS evidence URL, and optional exact
`matched_person_id`. Only resolved IDs can be added to the controlled actor
field. External drafts use `source: external_web` plus structured `source_url`
and `retrieved_at`.

### `DELETE /api/library/{videoId}/meta/suggest?request_id={uuid}`

Cancels queued/running work and returns the terminal job envelope.

`status: empty` when nothing can be suggested. Generic titles (`untitled`,
`video`, …) abstain from description/abstract. Language is returned only when
an explicit `media_language` maps onto the pinned catalog.

| Code | HTTP | When |
| --- | --- | --- |
| `LIBRARY_INVALID` | 400 | Bad id |
| `META_INVALID` | 400 | Bad JSON / body |
| `META_SUGGEST_RATE_LIMITED` | 429 | More than six starts per video/client per minute |
| `LIBRARY_NOT_FOUND` | 404 | Unknown video |
| `META_SUGGEST_NOT_FOUND` | 404 | Unknown/expired request ID |
| `META_SUGGEST_BUSY` | 503 | Bounded in-memory queue is full |
| `META_SUGGEST_FAILED` | 500 | Unexpected failure |

### `GET /api/metadata/catalogs`

Pinned catalogs for the Library editor (and later search facets).

Query: `?locale=en|zh&q=` (optional people autocomplete).

**200:** `{ "video_types", "primary_languages", "countries":[{code,label}], "people":[{id,display,aliases}] }`.

---

## Media APIs (Phase 9)

### `GET /api/media/{videoId}`

Streams playback file with **HTTP Range** (FR-18). Prefers `playback_path`,
falls back to `media_path`. Supports `HEAD`. Typical mid-seek response: **206**
Partial Content + `Content-Range`.

### `GET /api/thumb/{videoId}/{variantId}/{chunkIndex}`

Serves the chunk JPEG (from chunk `thumb_path` or conventional path under
`MEDIA_ROOT/thumbs/…`). Supports Range via the shared file server helper.

---

## Revision history

| Date | Change |
| --- | --- |
| 2026-08-26 | Initial contract for Phase 7 (job/SSE/ingest) + Phase 8 search sketch |
| 2026-08-26 | Phase 8: finalize search contract — RRF weights/window, badge rule, provider query vectors |
| 2026-08-26 | Phase 11: library + media/thumb routes; status marked verified vs code |
| 2026-09-03 | Search hits: `score_visual` / `score_audio` (knn similarity) + `rank_*`; `sort_by` `rrf`\|`visual`\|`audio`. `score` remains RRF when modality=both. |
| 2026-09-22 | Library batch delete: `POST /api/library/batch-delete` + multi-select UI |
| 2026-09-22 | Hybrid Phase 1: `GET /api/library/{id}`, `PATCH …/meta`, catalogs; ingest partial updates preserve `meta` |
| 2026-09-22 | Hybrid Phase 2: optional `filters` on text/image search; ready-ID allow-list; `FILTER_SCOPE_TOO_LARGE` |
| 2026-09-22 | Hybrid Phase 3.6: EIS completion parser (`QUERY_PARSER_*`), parse cache, speculative embed |
| 2026-09-22 | Hybrid Phase 3: opt-in `hybrid.use_text`, `sort_by=hybrid`, app-side BM25+RRF fusion; live rejects hybrid sort |
