# Data model — Elasticsearch indices

**Status:** Hybrid Phase 1 (2026-09-22) — `meta.*` on `video-assets`; mappings
match `lib/es/indices.ts` + `lib/es/asset-meta-mapping.ts`.
**Target cluster:** Elastic Cloud Serverless (observed ES **9.6.0** in Phase 2 probe).  
**Index names:** from `.env` — defaults `video-assets`, `video-chunks`.

This document is the contract for `yarn setup-indices`. The script creates both
indices idempotently and upgrades an existing `video-assets` mapping with new
`meta` properties when missing; a second run must report no changes.

---

## Document ID convention

Chunk documents use a composite `_id` so re-ingesting the same variant upserts
instead of duplicating, and different variants of the same video coexist:

```
{video_id}_{variant_id}_{chunk_index}
```

- `video_id` — stable UUID or slug assigned at import time (keyword).
- `variant_id` — 16-char hex SHA-256 prefix; derived by
  `lib/ingest/variant.ts` from chunking config, provider, model, task, proxy
  settings, and `SCHEMA_VERSION`.
- `chunk_index` — zero-based window index within the variant.

Asset documents use `_id = video_id` (one document per source video).

---

## Variant identity

`variant_id` hashes a canonical JSON payload containing:

| Field | Source |
| --- | --- |
| `chunk_preset`, `window_ms`, `overlap_ms`, `min_ms` | chunking config |
| `provider`, `model`, `task`, `dims`, `normalized_by` | embedding config |
| `video_frames`, `max_long_edge`, resolution/CRF ladders | proxy settings |
| `schema_version` | `SCHEMA_VERSION` env |

Cross-provider mixing inside one variant is prohibited. Search filters on
`variant_id` (kNN pre-filter).

---

## Index `video-assets`

One document per imported video. Holds media facts, sanitized provenance, a
**nested** list of variants, and top-level job state.

### Provenance (FR-22)

- `source_origin_path` — sanitized origin + path only (no userinfo, no secret
  query/fragment). Stored, **not indexed** (`index: false`).
- `source_fingerprint` — one-way hash (SHA-256 hex) of the raw submitted ref.
- The raw URL/path is **never** persisted unless explicitly allowlisted.

### Mapping (executable)

Apply via `PUT video-assets` (index name from `ES_INDEX_ASSETS`).

> **Serverless note:** omit `settings.number_of_shards` / `number_of_replicas` —
> Elastic Cloud Serverless manages these automatically.

```json
{
  "mappings": {
    "dynamic": "strict",
    "properties": {
      "video_id": { "type": "keyword" },
      "title": {
        "type": "text",
        "fields": {
          "keyword": { "type": "keyword", "ignore_above": 256 }
        }
      },
      "source_mode": { "type": "keyword" },
      "source_origin_path": { "type": "keyword", "index": false },
      "source_fingerprint": { "type": "keyword" },
      "media_path": { "type": "keyword", "index": false },
      "duration_ms": { "type": "long" },
      "width": { "type": "integer" },
      "height": { "type": "integer" },
      "fps": { "type": "float" },
      "has_audio": { "type": "boolean" },
      "size_bytes": { "type": "long" },
      "container": { "type": "keyword" },
      "video_codec": { "type": "keyword" },
      "playback_path": { "type": "keyword", "index": false },
      "variants": {
        "type": "nested",
        "properties": {
          "variant_id": { "type": "keyword" },
          "chunk_preset": { "type": "keyword" },
          "chunk_window_ms": { "type": "integer" },
          "chunk_overlap_ms": { "type": "integer" },
          "chunk_min_ms": { "type": "integer" },
          "provider": { "type": "keyword" },
          "model": { "type": "keyword" },
          "task": { "type": "keyword" },
          "dims": { "type": "integer" },
          "normalized_by": { "type": "keyword" },
          "schema_version": { "type": "keyword" },
          "proxy_settings": {
            "type": "object",
            "properties": {
              "video_frames": { "type": "integer" },
              "max_long_edge": { "type": "integer" },
              "resolution_ladder": { "type": "integer" },
              "crf_ladder": { "type": "integer" }
            }
          },
          "chunk_count": { "type": "integer" },
          "status": { "type": "keyword" },
          "error": { "type": "text", "index": false }
        }
      },
      "status": { "type": "keyword" },
      "job": {
        "type": "object",
        "properties": {
          "job_id": { "type": "keyword" },
          "stage": { "type": "keyword" },
          "progress_pct": { "type": "float" },
          "windows_total": { "type": "integer" },
          "windows_done": { "type": "integer" },
          "started_at": { "type": "date" },
          "updated_at": { "type": "date" },
          "completed_at": { "type": "date" }
        }
      },
      "error": { "type": "text", "index": false },
      "created_at": { "type": "date" },
      "updated_at": { "type": "date" },
      "meta": {
        "type": "object",
        "properties": {
          "description": { "type": "text" },
          "abstract": { "type": "text" },
          "year": { "type": "integer" },
          "actors": { "type": "keyword" },
          "actor_ids": { "type": "keyword" },
          "actor_aliases": {
            "type": "keyword",
            "copy_to": "meta.search_text"
          },
          "actor_keys": { "type": "keyword" },
          "video_type": { "type": "keyword" },
          "primary_language": { "type": "keyword" },
          "country": { "type": "keyword" },
          "tags": { "type": "keyword" },
          "tags_key": { "type": "keyword" },
          "review": {
            "type": "object",
            "properties": {
              "description": {
                "type": "object",
                "properties": {
                  "source": { "type": "keyword" },
                  "confirmed": { "type": "boolean" },
                  "confidence": { "type": "float" }
                }
              },
              "abstract": {
                "type": "object",
                "properties": {
                  "source": { "type": "keyword" },
                  "confirmed": { "type": "boolean" },
                  "confidence": { "type": "float" }
                }
              },
              "year": {
                "type": "object",
                "properties": {
                  "source": { "type": "keyword" },
                  "confirmed": { "type": "boolean" },
                  "confidence": { "type": "float" }
                }
              },
              "actors": {
                "type": "object",
                "properties": {
                  "source": { "type": "keyword" },
                  "confirmed": { "type": "boolean" },
                  "confidence": { "type": "float" }
                }
              },
              "video_type": {
                "type": "object",
                "properties": {
                  "source": { "type": "keyword" },
                  "confirmed": { "type": "boolean" },
                  "confidence": { "type": "float" }
                }
              },
              "primary_language": {
                "type": "object",
                "properties": {
                  "source": { "type": "keyword" },
                  "confirmed": { "type": "boolean" },
                  "confidence": { "type": "float" }
                }
              },
              "country": {
                "type": "object",
                "properties": {
                  "source": { "type": "keyword" },
                  "confirmed": { "type": "boolean" },
                  "confidence": { "type": "float" }
                }
              },
              "tags": {
                "type": "object",
                "properties": {
                  "source": { "type": "keyword" },
                  "confirmed": { "type": "boolean" },
                  "confidence": { "type": "float" }
                }
              }
            }
          },
          "revision": { "type": "long" },
          "updated_at": { "type": "date" },
          "search_text": {
            "type": "text",
            "fields": {
              "cjk": { "type": "text", "analyzer": "cjk" }
            }
          }
        }
      }
    }
  }
}
```

### Editorial metadata (`meta`)

Optional video-level fields owned by `PATCH /api/library/{videoId}/meta`.
Ingest writes never replace `meta` (partial `_update` of ingest-owned fields
only). Person IDs come from `config/people.json`; the client sends `actor_ids`
only — display names, aliases, and keys are server-derived. See
[plan/03-hybrid-metadata-search-plan.md](../plan/03-hybrid-metadata-search-plan.md).

`yarn setup-indices` creates missing indices **and** idempotently adds new
`meta` properties to an existing strict mapping.

Every `meta.review.<field>` object has the same bounded properties:
`source`, `confirmed`, `confidence`, `evidence`, `provider`, `source_url`,
`retrieved_at`, and `request_id`. The abbreviated mapping above shows the first
three; `lib/es/asset-meta-mapping.ts` is the executable source of truth.

### Status values (asset)

| `status` | Meaning |
| --- | --- |
| `pending` | Accepted, not yet processing |
| `awaiting_confirm` | Workload estimate ready; waiting for confirm (NFR-10) |
| `processing` | Pipeline running |
| `ready` | At least one variant indexed successfully |
| `failed` | Job failed (see `error`) |

Per-variant `variants.status`: `pending`, `processing`, `ready`, `failed`.

Job stages and SSE payloads: see [api-contract.md](./api-contract.md).

---

## Index `video-chunks`

One document per time window per variant. Carries dual `dense_vector` fields
(FR-11), locating metadata (FR-12), and proxy provenance.

### Vector fields (FR-11)

Both `embedding_video` and `embedding_audio`:

- `dims`: **1024** (never truncated — Matryoshka forbidden for video)
- `similarity`: `cosine` (vectors are L2-normalised before index)
- `index_options.type`: `bbq_hnsw` (quantised HNSW; query with
  `rescore_vector.oversample` at search time)

When `has_audio` is false, `embedding_audio` is omitted on the document.

### Mapping (executable)

Apply via `PUT video-chunks` (index name from `ES_INDEX_CHUNKS`).

> **Serverless note:** omit shard/replica settings (same as assets index).

```json
{
  "mappings": {
    "dynamic": "strict",
    "properties": {
      "video_id": { "type": "keyword" },
      "variant_id": { "type": "keyword" },
      "chunk_index": { "type": "integer" },
      "start_ms": { "type": "long" },
      "end_ms": { "type": "long" },
      "duration_ms": { "type": "long" },
      "start_label": { "type": "keyword" },
      "end_label": { "type": "keyword" },
      "embedding_video": {
        "type": "dense_vector",
        "dims": 1024,
        "index": true,
        "similarity": "cosine",
        "index_options": {
          "type": "bbq_hnsw",
          "m": 16,
          "ef_construction": 100
        }
      },
      "embedding_audio": {
        "type": "dense_vector",
        "dims": 1024,
        "index": true,
        "similarity": "cosine",
        "index_options": {
          "type": "bbq_hnsw",
          "m": 16,
          "ef_construction": 100
        }
      },
      "provider": { "type": "keyword" },
      "model": { "type": "keyword" },
      "task": { "type": "keyword" },
      "normalized_by": { "type": "keyword" },
      "video_proxy": {
        "type": "object",
        "properties": {
          "bytes": { "type": "integer" },
          "width": { "type": "integer" },
          "height": { "type": "integer" },
          "frames": { "type": "integer" },
          "crf": { "type": "integer" },
          "strategy": { "type": "keyword" },
          "ladder_exhausted": { "type": "boolean" }
        }
      },
      "audio_proxy": {
        "type": "object",
        "properties": {
          "bytes": { "type": "integer" },
          "bitrate": { "type": "keyword" },
          "codec": { "type": "keyword" }
        }
      },
      "thumb_path": { "type": "keyword", "index": false },
      "has_audio": { "type": "boolean" },
      "video_title": {
        "type": "text",
        "fields": {
          "keyword": { "type": "keyword", "ignore_above": 256 }
        }
      },
      "source_mode": { "type": "keyword" },
      "created_at": { "type": "date" }
    }
  }
}
```

---

## What `yarn setup-indices` applies

When run against a cluster with valid credentials in `.env`, the script:

1. Connects to `ELASTICSEARCH_URL` with `ELASTICSEARCH_API_KEY`.
2. For each index (`ES_INDEX_ASSETS`, `ES_INDEX_CHUNKS`):
   - If the index **does not exist** → `indices.create` with the mapping JSON
     above (via `lib/es/indices.ts`).
   - If the index **already exists** → no-op (idempotent; logs `skipped`).
3. Prints a JSON summary: `{ assets: "created"|"skipped", chunks: "created"|"skipped" }`.

No data is indexed. No existing mappings are modified (additive updates are a
future concern if `SCHEMA_VERSION` bumps).

---

## Bulk upsert contract

`lib/es/index-chunks.ts` bulk-indexes chunk documents:

- Action: `index` (upsert by `_id`)
- `_id`: `{video_id}_{variant_id}_{chunk_index}`
- `refresh`: `wait_for` (demo-scale corpus)

Re-running ingestion for the same variant replaces chunk documents in place;
chunk count for that variant must not grow on retry (Phase 7 acceptance).

---

## Revision history

| Date | Change |
| --- | --- |
| 2026-08-26 | Initial data model for Phase 3; mappings mirror plan FR-11/12/19 |
| 2026-08-26 | Status `awaiting_confirm` + pointer to api-contract (Phase 7) |
| 2026-08-26 | Phase 11: re-verified against `lib/es/indices.ts` (no mapping drift) |
