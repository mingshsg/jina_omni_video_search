---
title: "RRF retriever (reciprocal rank fusion, weights, rank_window_size)"
url: https://www.elastic.co/docs/reference/elasticsearch/rest-apis/retrievers/rrf-retriever
source_raw: https://raw.githubusercontent.com/elastic/elasticsearch/main/docs/reference/elasticsearch/rest-apis/retrievers/rrf-retriever.md
applies_to:
  stack: all
  serverless: ga
downloaded: 2026-08-25
---

# RRF retriever

> Offline snapshot taken from the Elasticsearch docs source on 2026-08-25.
> Prefer the live URL above when precision matters.

An RRF retriever returns top documents based on the Reciprocal Rank Fusion
formula, combining two or more child retrievers. RRF is a method for combining
multiple result sets with different relevance indicators into a single result
set.

**Availability: `stack: all`, `serverless: ga`.** This matters for our project
because the Serverless target makes RRF generally available rather than a
preview feature.

## Why this document is in the reference set

Our design fuses two `knn` retrievers, one per modality (`embedding_video` and
`embedding_audio`). The three facts below drive the search API contract:

1. Per-retriever **`weight`** is supported (`stack: ga 9.2`), so the visual and
   audio branches can be weighted rather than treated as equals.
2. **`rank_window_size` defaults to only 10**, which is far too small for our
   result list. It must be raised explicitly and must be `>= size`.
3. RRF returns a **fused rank score**, not per-modality similarity. Nothing in
   this API surfaces which child retriever contributed a hit, which is exactly
   why the "which modality matched" badge needs its own solution rather than
   falling out of the RRF response.

## Parameters

Either `query` or `retrievers` must be specified. Combining `query` and
`retrievers` is not supported.

- **`query`** (Optional, string) `stack: ga 9.1` — the query to use with the
  multi-field query format.
- **`fields`** (Optional, array of strings) `stack: ga 9.1` — fields to query
  when using the multi-field query format. Defaults to the index's
  `index.query.default_field`, which is `*`.
- **`retrievers`** (Optional, array of retriever objects) — child retrievers
  whose returned top documents have the RRF formula applied. Each retriever can
  optionally include a weight (`stack: ga 9.2`). When weights are specified:

  ```
  rrf_score = weight_1 × rrf_score_1 + weight_2 × rrf_score_2 + ... + weight_n × rrf_score_n
  ```

  where `rrf_score_i` is the RRF score for the document from retriever `i`.
- **`rank_constant`** (Optional, integer) — determines how much influence
  documents in individual result sets have over the final ranked set. A higher
  value gives lower-ranked documents more influence. Must be `>= 1`.
  **Defaults to `60`.**
- **`rank_window_size`** (Optional, integer) — the size of the individual result
  sets per query. A higher value improves relevance at the cost of performance.
  The final ranked set is pruned to the search request's `size`. Must be
  `>= size` and `>= 1`. **Defaults to `10`.**
- **`filter`** (Optional, query object or list) — applies the given boolean
  query filter to all specified sub-retrievers, according to each retriever's
  specifications.

### Direct format (default weight of 1.0)

```json
{
  "rrf": {
    "retrievers": [
      {
        "standard": {
          "query": {
            "multi_match": { "query": "search text", "fields": ["field1", "field2"] }
          }
        }
      },
      {
        "knn": {
          "field": "vector",
          "query_vector": [1, 2, 3],
          "k": 10,
          "num_candidates": 50
        }
      }
    ]
  }
}
```

### Wrapped format with custom weights (`stack: ga 9.2`)

```json
{
  "rrf": {
    "retrievers": [
      {
        "retriever": {
          "standard": {
            "query": {
              "multi_match": { "query": "search text", "fields": ["field1", "field2"] }
            }
          }
        },
        "weight": 2.0
      },
      {
        "retriever": {
          "knn": {
            "field": "vector",
            "query_vector": [1, 2, 3],
            "k": 10,
            "num_candidates": 50
          }
        },
        "weight": 1.0
      }
    ]
  }
}
```

In the wrapped format:

- **`retriever`** (Required, retriever object) — a child retriever. Any valid
  retriever type can be used (`standard`, `knn`, `text_similarity_reranker`,
  and so on).
- **`weight`** (Optional, float) `stack: ga 9.2` — the weight by which each
  score of this retriever's top docs is multiplied in the RRF formula. Higher
  values increase this retriever's influence. Must be non-negative. Defaults
  to `1.0`.

Weighted and non-weighted formats can be mixed in the same query. The direct
format (without the explicit `retriever` wrapper) uses the default weight
of `1.0`:

```json
{
  "rrf": {
    "retrievers": [
      { "standard": { "query": {} } },
      { "retriever": { "knn": {} }, "weight": 2.0 }
    ]
  }
}
```

## Example: hybrid search

```json
GET /restaurants/_search
{
  "retriever": {
    "rrf": {
      "retrievers": [
        {
          "standard": {
            "query": {
              "multi_match": { "query": "Austria", "fields": ["city", "region"] }
            }
          }
        },
        {
          "knn": {
            "field": "vector",
            "query_vector": [10, 22, 77],
            "k": 10,
            "num_candidates": 10
          }
        }
      ],
      "rank_constant": 1,
      "rank_window_size": 50
    }
  }
}
```

## Example: weighted hybrid search (`stack: ga 9.2`)

Giving the `standard` retriever twice the influence of the `knn` retriever:

```json
GET /restaurants/_search
{
  "retriever": {
    "rrf": {
      "retrievers": [
        {
          "retriever": {
            "standard": {
              "query": {
                "multi_match": { "query": "Austria", "fields": ["city", "region"] }
              }
            }
          },
          "weight": 2.0
        },
        {
          "retriever": {
            "knn": {
              "field": "vector",
              "query_vector": [10, 22, 77],
              "k": 10,
              "num_candidates": 10
            }
          },
          "weight": 1.0
        }
      ],
      "rank_constant": 60,
      "rank_window_size": 50
    }
  }
}
```

## Implications for this project

- The **modality toggle** in the UI maps cleanly onto this API: "visual only"
  and "audio only" drop one child retriever; "both" keeps two, optionally with
  asymmetric `weight` values.
- `rank_window_size` must be set explicitly (the default of 10 would silently
  cap fusion quality). Set it to at least the requested `size`, and treat it as
  a tunable in the search API contract.
- Because the response carries a fused rank score only, the per-result
  "which modality matched" badge (FR-16) cannot be read off an RRF response.
  Two workable approaches, to be decided in `docs/api-contract.md`:
  1. issue the two `knn` retrievers as separate searches and fuse in the
     application, which yields per-modality rank and score at the cost of an
     extra round trip; or
  2. run RRF for ranking and issue a second, cheap lookup to recover
     per-modality similarity for the returned chunk IDs only.
- A chunk retrieved by **both** branches needs a defined label. The RRF
  response will not distinguish it, so the contract must state the rule
  (for example, badge "both", or badge the higher-scoring modality).
