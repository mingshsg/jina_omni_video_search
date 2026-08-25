# Reference documents

Downloaded: 2026-08-25. Offline snapshots used while planning this demo.
Prefer the live `source` URL in each file's frontmatter when you need the latest text.

## How these map to the plan

| Concern in our design | Primary references |
| --- | --- |
| Model behaviour (32 frames, shared vector space, dimensions) | [jina-embeddings-v5-omni-small-model.md](jina-embeddings-v5-omni-small-model.md), [elastic-labs-jina-embeddings-v5-omni.md](elastic-labs-jina-embeddings-v5-omni.md), [arxiv-jina-embeddings-v5-omni.md](arxiv-jina-embeddings-v5-omni.md) |
| EIS endpoint and multimodal inference | [elastic-inference-service.md](elastic-inference-service.md), [elastic-eis-supported-models.md](elastic-eis-supported-models.md), [elastic-jina-models-nlp.md](elastic-jina-models-nlp.md) |
| **1 MB binary input limit on Serverless** | [elastic-semantic-field-reference.md](elastic-semantic-field-reference.md), [elastic-labs-semantic-field-multimodal.md](elastic-labs-semantic-field-multimodal.md) |
| Index / search patterns | [elastic-multimodal-search-tutorial.md](elastic-multimodal-search-tutorial.md), [elastic-semantic-field.md](elastic-semantic-field.md), [elastic-knn-query.md](elastic-knn-query.md) |
| **Dual-modality RRF fusion and per-modality weights** | [elastic-rrf-retriever.md](elastic-rrf-retriever.md), [elastic-knn-retriever.md](elastic-knn-retriever.md) |
| Jina API shapes and size FAQ | [jina-embeddings-api.md](jina-embeddings-api.md) |
| **UI framework choice and its version constraints** | [elastic-eui-constraints.md](elastic-eui-constraints.md) |
| Constraint cheat sheet (our summary) | [constraints-cheat-sheet.md](constraints-cheat-sheet.md) |

## File list

### Elastic official docs

- [elastic-multimodal-search-tutorial.md](elastic-multimodal-search-tutorial.md) — hands-on image index with `.jina-embeddings-v5-omni-small`
- [elastic-semantic-field.md](elastic-semantic-field.md) — `semantic` vs `semantic_text`
- [elastic-semantic-field-reference.md](elastic-semantic-field-reference.md) — input shapes, **1 MB / Serverless fixed**, query builders
- [elastic-inference-service.md](elastic-inference-service.md) — EIS overview; omni endpoint creation
- [elastic-eis-supported-models.md](elastic-eis-supported-models.md) — model catalogue including omni-small / omni-nano
- [elastic-jina-models-nlp.md](elastic-jina-models-nlp.md) — Jina on Elastic, multimodal getting started
- [elastic-knn-query.md](elastic-knn-query.md) — `query_vector_builder.embedding` for multimodal queries; **`filter` is a pre-filter applied during the approximate search**
- [elastic-rrf-retriever.md](elastic-rrf-retriever.md) — RRF fusion; per-retriever `weight` (`ga 9.2`), `rank_constant` 60, **`rank_window_size` defaults to only 10**
- [elastic-knn-retriever.md](elastic-knn-retriever.md) — `query_vector_builder` vs `query_vector` (mutually exclusive), `rescore_vector.oversample`, `num_candidates` optional from 9.5

### Elasticsearch Labs blogs

- [elastic-labs-jina-embeddings-v5-omni.md](elastic-labs-jina-embeddings-v5-omni.md) — model announcement; video search / Breakfast at Tiffany's demo
- [elastic-labs-semantic-field-multimodal.md](elastic-labs-semantic-field-multimodal.md) — semantic field + binary size guardrail explanation

### UI framework

- [elastic-eui-constraints.md](elastic-eui-constraints.md) — verified EUI adoption
  constraints: **no React 19 in peer deps**, **no SSR support / Next.js
  officially "a challenge"**, **yarn required (npm unsupported)**, EUI owns the
  styling layer so Tailwind is dropped

### Jina

- [jina-embeddings-v5-omni-small-model.md](jina-embeddings-v5-omni-small-model.md) — model card (1024-d, 32 frames, CC-BY-NC-4.0)
- [jina-embeddings-api.md](jina-embeddings-api.md) — API page + FAQ (image 5 MB, PDF 8 MB; video via 32-frame sampling)

### Paper

- [arxiv-jina-embeddings-v5-omni.md](arxiv-jina-embeddings-v5-omni.md) — technical report HTML snapshot (truncated)

## Licence note

These are third-party documents retained for offline planning convenience.
Redistribution of the originals is governed by Elastic / Jina / arXiv terms.
Do not treat this folder as a substitute for the live documentation.
