---
title: "kNN retriever (query_vector_builder, filter, rescore_vector)"
url: https://www.elastic.co/docs/reference/elasticsearch/rest-apis/retrievers/knn-retriever
source_raw: https://raw.githubusercontent.com/elastic/elasticsearch/main/docs/reference/elasticsearch/rest-apis/retrievers/knn-retriever.md
applies_to:
  stack: all
  serverless: ga
downloaded: 2026-08-25
---

# kNN retriever

> Offline snapshot taken from the Elasticsearch docs source on 2026-08-25.
> Prefer the live URL above when precision matters.

A kNN retriever returns top documents from a k-nearest neighbor search. It is
the child retriever our RRF fusion uses, once per modality.

## Why this document is in the reference set

Four facts here shape the search implementation:

1. **`query_vector_builder` is supported on the retriever**, not just on the
   standalone `knn` query. This is what lets the EIS provider push query-vector
   generation into Elasticsearch instead of computing it in the application.
2. `query_vector` and `query_vector_builder` **cannot be used together**, which
   makes the provider split explicit: EIS uses the builder, the direct Jina and
   local providers supply `query_vector`.
3. **`num_candidates` became optional in `stack: ga 9.5`** (it was required
   earlier) and defaults to `Math.min(1.5 * k, 10_000)`. Our target is 9.5, so
   the code may omit it, but setting it explicitly keeps behaviour identical if
   the project is ever run against 9.4.
4. `filter` is available here, which is how variant isolation is applied
   (see the pre-filter note at the end).

## Parameters

- **`field`** (Required, string) — the vector field to search. Must be a
  `dense_vector` field with indexing enabled. To run kNN against a
  `semantic_text` field, use the `knn` query instead.
- **`query_vector`** (Required if `query_vector_builder` is not defined; array
  of float or string) — must have the same number of dimensions as the target
  field. Must be one of:
  - an array of floats;
  - a hex-encoded byte vector, one byte per dimension, or one byte per 8
    dimensions for `bit` (`stack: ga 9.0-9.3`);
  - a **base64-encoded vector string**, supporting `float` and `bfloat16`
    (big-endian), `byte`, and `bit` encodings depending on the target field type
    (`stack: ga 9.4`, `serverless: ga`).
- **`query_vector_builder`** (Required if `query_vector` is not defined; object)
  — defines a model used to build the query vector.
- **`k`** (Required, integer) — number of nearest neighbors returned as top
  hits. Must be `<= num_candidates`.
- **`num_candidates`** (Optional, integer `stack: ga 9.5`; required in earlier
  versions) — nearest-neighbor candidates considered per shard. Must be greater
  than `k`, or than `size` if `k` is omitted, and cannot exceed 10,000.
  Elasticsearch collects `num_candidates` per shard then merges to find the top
  `k`. Increasing it tends to improve accuracy. Defaults to
  `Math.min(1.5 * k, 10_000)`.
- **`visit_percentage`** (Optional, float) `stack: ga 9.2` — percentage of
  vectors to explore per shard when using `bbq_disk`. Between 0 and 100; 0
  falls back to using `num_candidates`. If set for `bbq_disk`,
  `num_candidates` is ignored. Defaults to roughly 1% per shard per million
  vectors.
- **`filter`** (Optional, query object or list) — query to filter the documents
  that can match. The search returns the top `k` documents that also match the
  filter. If not provided, all documents may match.
- **`similarity`** (Optional, float) — the minimum similarity required for a
  document to be considered a match. Relates to the raw `similarity` of the
  field, not the document score. Matched documents are then scored according to
  `similarity` and any `boost` is applied.
  - `l2_norm`: includes documents whose vector is within the `dims`-dimensional
    hypersphere of radius `similarity` centred on `query_vector`.
  - `cosine`, `dot_product`, `max_inner_product`: only returns vectors whose
    cosine similarity or dot product is at least `similarity`.
- **`rescore_vector`** (Optional, object) `stack: preview =9.0, ga 9.1+` —
  applies oversampling and rescoring to quantized vectors. Rescoring only makes
  sense for quantized vectors; the option is ignored for non-quantized
  `dense_vector` fields.
  - **`oversample`** (Required, float) — applies the oversample factor to `k`.
    The search retrieves `num_candidates` candidates per shard, rescores the top
    `k * oversample` per shard using the original vectors, and returns the top
    `k` rescored candidates.

## Restrictions

`query_vector` and `query_vector_builder` cannot be used together.

## Example

```json
GET /restaurants/_search
{
  "retriever": {
    "knn": {
      "field": "vector",
      "query_vector": [10, 22, 77],
      "k": 10,
      "num_candidates": 10
    }
  }
}
```

## Implications for this project

- Our chunk vectors use `bbq_hnsw`, which is quantized, so `rescore_vector`
  with an `oversample` factor is meaningful and should be set. It would be
  silently ignored on a non-quantized field, so the mapping and the query have
  to stay in sync.
- **Variant isolation uses `filter`.** The companion `knn` *query* reference
  states that the filter is a pre-filter, "applied during the approximate kNN
  search to ensure that `num_candidates` matching documents are returned"
  (see [elastic-knn-query.md](elastic-knn-query.md)). That is what makes it
  safe to keep several embedding variants in one index and select one at query
  time, instead of provisioning an index per variant.
- The base64 query-vector encoding (`serverless: ga`) is a possible payload
  optimisation for the Jina and local providers, which send an
  application-computed vector. Not needed for correctness; worth noting only if
  request size becomes a concern.
- `similarity` offers a cheap way to suppress weak matches in the demo UI,
  but note it is a raw-similarity threshold rather than a score threshold, so
  any value chosen must be calibrated against measured similarities rather
  than guessed.
