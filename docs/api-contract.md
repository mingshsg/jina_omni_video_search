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
| `chunk_preset` | `standard` \| `60s` \| `30s` \| `20s` \| `fine` \| `custom` |

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
| `chunk_preset` | env `CHUNK_PRESET` | Named window: `standard` (64s/4s), `60s` (60s/4s), `30s` (30s/4s), `20s` (20s/2s), `fine` (10s/2s). Hashes into `variant_id` so presets coexist. |
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
  "modality": "both",
  "variant_id": "a1b2c3d4e5f67890",
  "video_id": null,
  "size": 20,
  "sort_by": "rrf"
}
```

| Field | Required | Values / rules |
| --- | --- | --- |
| `query` | yes | non-empty string (max 2000) |
| `modality` | no (default `both`) | `visual` \| `audio` \| `both` |
| `variant_id` | yes | kNN **pre-filter** on every child retriever |
| `video_id` | no | optional single-video filter (`null` / omit = all videos in variant) |
| `size` | no (default 20) | top-k; server clamps to **1..100** |
| `sort_by` | no (default `rrf`) | `rrf` \| `visual` \| `audio` — see sort below |

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
| `rrf` (default) | RRF retriever (`modality=both`) or the single knn list | fused RRF / knn order |
| `visual` | Visual knn window, then top-`size` | `score_visual` descending |
| `audio` | Audio knn window, then top-`size` | `score_audio` descending |

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

### Search error shape

Same `{ "error": { "code", "message" } }` envelope.

| Code | HTTP | When |
| --- | --- | --- |
| `SEARCH_INVALID_REQUEST` | 400 | zod validation failure / non-JSON body |
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
