# Constraints cheat sheet

Summary of limits that shaped this project's design. Every claim links to a
snapshot in this folder or names the live source it was verified against.

Last verified: 2026-08-25.

## Model: `jina-embeddings-v5-omni-small`

| Property | Value | Source |
| --- | --- | --- |
| Dimensions | 1024. Matryoshka truncation to 32 is supported but **must not be used for video** — see below | [model card](jina-embeddings-v5-omni-small-model.md) |
| Context | 32K tokens | same |
| Video sampling | up to **32 uniformly spaced frames** | model card; [Labs blog](elastic-labs-jina-embeddings-v5-omni.md) |
| Video resolution normalisation | upscaled below 262,144 px, downscaled above 3,072,000 px, tiled into 28x28 patches, one token set per two frames | [Labs blog](elastic-labs-jina-embeddings-v5-omni.md) |
| Audio | 30 s segments, resampled to 16 kHz, one token per 40 ms | Labs blog |
| Text identity | bit-identical to `jina-embeddings-v5-text-small` | model card |
| Licence (weights) | CC-BY-NC-4.0 | model card |
| EIS model id | `jina-embeddings-v5-omni-small`, task type `embedding` | [EIS](elastic-inference-service.md) |
| EIS availability | **GA from 9.4**, regions US, SG, EU, APJ | [supported models](elastic-eis-supported-models.md) lines 77-78 |

### Video vectors must not be truncated

The technical report shows video is the most truncation-sensitive modality: the
video curve "diverges from the others well before 64 dimensions and crosses
below half its full-dimension score around 32"
([arxiv snapshot](arxiv-jina-embeddings-v5-omni.md), line 1032). Keep
`dimensions` at 1024. Do not shrink vectors to save index space.

## Binary input size limits, per provider

There is no single global limit. Carrying one value was an earlier mistake.

| Gate | Limit | Adjustable? | Source |
| --- | --- | --- | --- |
| Elasticsearch `indices.inference.max_binary_input_size` | **1 MB** decoded default | Self-managed / ECH: up to **20 MB**. **Serverless: fixed at 1 MB** | [semantic field reference](elastic-semantic-field-reference.md) line 123 |
| Jina hosted API, image | **5 MB** | No (service) | [jina-embeddings-api.md](jina-embeddings-api.md) FAQ |
| Jina hosted API, PDF | **8 MB** | No (service) | same |
| Jina hosted API, **video and audio** | **Unknown / unmeasured** | — | Live `api.jina.ai/openapi.json` fetched 2026-08-25: `VideoDoc` and `AudioDoc` declare one string property each and **no** size or duration constraint |
| Jina on-prem / airgap reference server | **10 MB** per media input (`MAX_MEDIA_BYTES`) | Yes (source constant, not a service contract) | Sibling `jina-airgap` server code (not mirrored here) |
| Claim of **75 MB** | Not found anywhere | — | Searched Elastic docs, Jina FAQ, live OpenAPI |
| Claim of **20 MB / 120 s** for Jina video | Not found in the live OpenAPI | — | Most likely a conflation with the Elastic cluster setting in row 1 |

**Open question for the Phase 2 probe (OQ1):** the 1 MB wording lives on the
`semantic` field page, while this project calls `POST _inference/embedding/...`
directly. Confirm empirically whether the same gate applies. **OQ2:** measure
the hosted Jina video ceiling, since no documented value exists.

## Task adapters: pin them, and do not mix providers

| Provider | `task` control | Default |
| --- | --- | --- |
| Jina hosted API | `task` enum: `retrieval.query`, `retrieval.passage`, `text-matching`, `clustering`, `classification` | **`text-matching`** — the wrong adapter for retrieval, applied silently |
| EIS `embedding` (omni) | No `task` or `input_type` in any captured Elastic reference | Opaque |
| EIS `text_embedding` | `input_type: ingest` documented | — | 

Sources: live `api.jina.ai/openapi.json`;
[elastic-jina-models-nlp.md](elastic-jina-models-nlp.md) lines 202, 232-244.

Consequences: always set `retrieval.passage` for documents and
`retrieval.query` for queries on the Jina path; record provider, model, task,
and dimensions on every embedding variant; and **prohibit mixing providers
within one variant by default**. L2 normalisation makes magnitudes comparable,
not embedding functions identical.

`normalized` defaults to `true` on the hosted Jina API.

## Elastic version matrix

From [elastic-inference-service.md](elastic-inference-service.md) lines 99-104:

| Version | Capability |
| --- | --- |
| 9.3+ | Create endpoints and run multimodal `embedding` inference. Cannot use these models with `semantic_text` |
| 9.4+ | `semantic_text` works, **text-only** embeddings |
| 9.5+ | The `semantic` field type supports **all** modalities |

Target is 9.5. Explicit `dense_vector` is still chosen over `semantic`: it also
runs on 9.4, it keeps base64 out of `_source`, and it preserves control over
quantisation, modality labelling, and RRF weighting.

## Input shape for non-text (Elastic)

```json
{
  "type": "video",
  "format": "base64",
  "value": "data:video/mp4;base64,...."
}
```

Valid `type` values: `image`, `audio`, `video`, `pdf`. See
[semantic field reference](elastic-semantic-field-reference.md).

**No fusion on Elastic.** "Each non-text value is processed as a single unit and
produces one embedding"; an array yields one embedding per array position; at
query time Elasticsearch "uses the best matching embedding to score the
top-level document". N values, N vectors, max-pooled, never fused. Jina's
`MergedContentGroup` (one fused vector per group, single forward pass, order
significant) has no EIS equivalent.

## Query side

- Text against a `semantic` field: `match` query.
- Multimodal against `dense_vector`: `knn` with
  `query_vector_builder.embedding`, passing `inference_id` explicitly. See
  [knn query](elastic-knn-query.md) and [knn retriever](elastic-knn-retriever.md).
- `query_vector` and `query_vector_builder` **cannot be combined**, so EIS uses
  the builder while the Jina and local providers supply a computed vector.
- `filter` on a `knn` query or retriever is a **pre-filter**, "applied during
  the approximate kNN search to ensure that `num_candidates` matching documents
  are returned" ([knn query](elastic-knn-query.md) line 147). This is what makes
  it safe to keep several embedding variants in one index.

### RRF defaults worth overriding

| Parameter | Default | Note |
| --- | --- | --- |
| `rank_constant` | 60 | fine as-is |
| `rank_window_size` | **10** | far too small; must be `>= size`, set explicitly |
| per-retriever `weight` | 1.0 | supported from `ga 9.2`, enables asymmetric visual/audio weighting |

RRF returns a **fused rank score only** — nothing identifies which child
retriever produced a hit, so the per-result modality badge needs its own
mechanism. See [rrf retriever](elastic-rrf-retriever.md).

## UI framework (EUI)

See [elastic-eui-constraints.md](elastic-eui-constraints.md) for evidence.

| Constraint | Value |
| --- | --- |
| Latest `@elastic/eui` | 119.1.0 |
| React peer range | `^17.0 \|\| ^18.0` — **no React 19** |
| Next 14.2.35 | peers `react: ^18.2.0` only |
| Next 15 App Router | upgrade guide: React **19** minimum |
| Next 16 App Router | upgrade guide: React **19.2 Canary** |
| SSR / Next.js | Officially "a challenge"; starter archived; #7630 open |
| Package manager | **yarn pinned for this project** (EUI docs prefer yarn; not treated as a hard consumer law) |
| Styling | Emotion 11.x + Borealis 8.0.0; no Tailwind |

Resulting stack: **Next.js 14.2.35 + React 18.3.1 + EUI 119.1.0**, client-side
rendering only, yarn, no Tailwind. Per-provider budgets:
`EIS_MAX_BINARY_BYTES` / `JINA_MAX_BINARY_BYTES` / `LOCAL_MAX_BINARY_BYTES`
with an explicit `EMBED_BUDGET_BYTE_LAYER`.

## Design implications for this demo

1. Do **not** send 64-second high-bitrate clips as-is into EIS on Serverless.
2. Prefer a **32-frame visual proxy** sized to the measured per-provider budget.
3. Prefer a **separate low-bitrate audio proxy** for dialogue search (dual
   track), and fuse with RRF rather than with `MergedContentGroup`.
4. Keep **`dense_vector` plus metadata** rather than indexing base64 into a
   `semantic` field's `_source`.
5. Treat `jina` and `local` as escapes from the Serverless 1 MB ceiling, but
   measure their real limits rather than quoting one.
6. Pin task adapters and never mix providers within a variant.
7. Keep vectors at 1024 dimensions.
8. Sanitize stored URL provenance (FR-22).
