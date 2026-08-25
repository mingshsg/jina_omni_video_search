---
title: "Semantic field type reference (documents 1MB binary limit)"
source: https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/semantic-field-reference
source_markdown: https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/semantic-field-reference.md
downloaded: 2026-08-25
note: Offline snapshot for local planning. Prefer the live URL for the latest version.
---

---
title: Semantic field type reference
description: This page provides technical reference information for the semantic field type, including mapping parameters, inference endpoint requirements, accepted...
url: https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/semantic-field-reference
products:
  - Elasticsearch
applies_to:
  - Elastic Cloud Serverless: Preview
  - Elastic Stack: Preview since 9.5
---

# Semantic field type reference
This page provides technical reference information for the `semantic` field type, including mapping parameters, inference endpoint requirements, accepted input, chunking, querying, retrieval, highlighting, and limitations.

## Parameters for `semantic` fields

<definitions>
  <definition term="inference_id">
    (Required, string) ID of the `embedding` inference endpoint used to generate embeddings at index time. If you don't specify `search_inference_id`, the same endpoint is also used at query time.
    You can update `inference_id` with the [Update mapping API](https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-indices-put-mapping) if the field contains no indexed values or if the new endpoint produces embeddings compatible with the existing endpoint. Compatible endpoints use the same dimensions, similarity measure, and element type, and should use the same underlying model.
  </definition>
  <definition term="search_inference_id">
    (Optional, string) ID of the `embedding` inference endpoint used to generate embeddings at query time. If omitted, `inference_id` is used at both index and query time.
    You can update `search_inference_id` with the [Update mapping API](https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-indices-put-mapping). The search endpoint must produce embeddings that are compatible with those produced by `inference_id`.
  </definition>
  <definition term="chunking_settings">
    (Optional, object) Settings that control how text input is divided into chunks before inference. These settings override the chunking settings configured on `inference_id`. Chunking does not apply to non-text input; each non-text value produces one embedding.
    If you update `chunking_settings`, the new settings apply only to newly indexed or reindexed documents. To disable automatic text chunking, use the `none` strategy.
    Refer to [Configure chunking](https://www.elastic.co/docs/explore-analyze/elastic-inference/inference-api#infer-chunking-config) for the available strategies and settings.
  </definition>
  <definition term="index_options">
    (Optional, object) Settings that control how the dense vectors generated for the field are indexed. The `semantic` field supports `dense_vector` index options.
    <note>
      This parameter configures vector indexing structures. It is distinct from the [`index_options`](https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/index-options) parameter used by term-based fields.
    </note>
    Specify dense-vector options inside the `dense_vector` object:
    ```json
    {
      "index_options": {
        "dense_vector": {
          "type": "int8_hnsw",
          "m": 16,
          "ef_construction": 100
        }
      }
    }
    ```
    Refer to [Dense vector index options](/docs/reference/elasticsearch/mapping-reference/dense-vector#dense-vector-index-options) for the available algorithms and parameters.
    For endpoints that produce `float` embeddings, `semantic` fields use the [`bfloat16`](/docs/reference/elasticsearch/mapping-reference/dense-vector#dense-vector-element-type) element type by default. You can set `index_options.dense_vector.element_type` to `float` to retain full float precision. For endpoints that produce `byte` or `bit` embeddings, an explicit element type must match the endpoint's element type.
  </definition>
  <definition term="meta">
    (Optional, object) Metadata about the field. Refer to [`meta`](https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/mapping-field-meta).
  </definition>
</definitions>


## Inference endpoint requirements

A `semantic` field requires an inference endpoint with the `embedding` task type. The endpoint determines:
- The input modalities supported by the field.
- The vector dimensions, similarity measure, and element type.
- The default text chunking settings.

For multimodal search, Elastic recommends [Jina multimodal embeddings](https://www.elastic.co/docs/explore-analyze/machine-learning/nlp/ml-nlp-jina#jina-multimodal-embeddings).
Elastic provides `.jina-embeddings-v5-omni-small` as the preconfigured inference endpoint for the Jina Embeddings v5 Omni Small model.
The following example creates a separate Jina endpoint through the [Elastic Inference Service (EIS)](https://www.elastic.co/docs/explore-analyze/elastic-inference/eis). This configuration does not require a separate Jina API key:
```json

{
  "service": "elastic",
  "service_settings": {
    "model_id": "jina-embeddings-v5-omni-small"
  }
}
```

The `embedding` task type does not guarantee that every endpoint supports every modality. Check the model and service documentation to determine the modalities supported.
If a referenced endpoint is unavailable, indexing and searches against the field fail. By default, Elasticsearch prevents you from deleting an endpoint that is referenced by an inference field.

## Supported input types

A `semantic` field accepts one or more values. Values can be text, images, audio, video, or PDFs, and an array can mix input types.

### Text input

Provide text directly as a JSON string:
```json

{
  "content": "It was the best of times, it was the worst of times."
}
```

Long text is chunked according to the field's `chunking_settings`. To provide text that is already chunked, set the chunking strategy to `none` and index an array of strings.
<tip>
  If you're working exclusively with text, consider using [`semantic_text`](https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/semantic-text).
</tip>


### Non-text input

Provide non-text input as an object with the following properties:
<definitions>
  <definition term="type">
    (Required, string) Type of non-text input. Valid values are `image`, `audio`, `video`, and `pdf`. [Text input](#semantic-text-input) is provided directly as a JSON string.
  </definition>
  <definition term="value">
    (Required, string) Input encoded as a [data URL](https://developer.mozilla.org/en-US/docs/Web/URI/Reference/Schemes/data). The value must include its media type and Base64 encoding, for example `data:image/jpeg;base64,...`.
  </definition>
  <definition term="format">
    (Optional, string) Input format. The only supported format for non-text input is `base64`, which is also the default.
  </definition>
</definitions>

Each non-text value has a default maximum decoded size of 1 MB. Elasticsearch rejects larger values with an HTTP `400` response. On self-managed deployments and Elastic Cloud Hosted, you can change the limit with the dynamic [`indices.inference.max_binary_input_size`](https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-cluster-put-settings) cluster setting, up to 20 MB. In Elasticsearch Serverless, the limit is fixed at 1 MB.
The following example indexes an image:
```json

{
  "content": {
    "type": "image",
    "value": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABA..."
  }
}
```

Each non-text value is processed as a single unit and produces one embedding. Elasticsearch does not split non-text input into chunks.

### Mixed input

The following example indexes text and images in the same field:
```json

{
  "content": [
    "A cat sitting on a windowsill",
    {
      "type": "image",
      "value": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABA..."
    },
    "A dog running through a park"
  ]
}
```


## Chunking behavior

Elasticsearch stores each embedding in a hidden nested document:
- Text chunks are associated with start and end character offsets in the original text.
- Non-text embeddings are associated with the position of the value in the input array.

At query time, Elasticsearch searches the individual embeddings and uses the best matching embedding to score the top-level document.
Because chunks are stored as nested documents, the `docs.count` value from the [`_cat/indices`](https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-cat-indices) API can be higher than the number of documents you indexed. Use the Count API or `_cat/count` to count only top-level documents.

## Query a `semantic` field

A compatible multimodal endpoint enables cross-modal search. For example, you can use a text query to find images, or an image query to find related text and images.
You can query `semantic` fields with Query DSL or the retriever API. ES|QL does not currently support `semantic` fields.

### Query DSL

Query DSL supports the following queries:
- Use a [`match` query](https://www.elastic.co/docs/reference/query-languages/query-dsl/query-dsl-match-query) for text query input. Elasticsearch uses the field's search inference endpoint to generate the query embedding.
- Use a [`knn` query](https://www.elastic.co/docs/reference/query-languages/query-dsl/query-dsl-knn-query) with the `embedding` query vector builder for text or non-text input.
- Use a `knn` query with `query_vector` if you already have a vector compatible with the field's endpoint.

The following example searches using image input:
```json

{
  "query": {
    "knn": {
      "field": "content",
      "query_vector_builder": {
        "embedding": {
          "input": {
            "type": "image",
            "value": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABA..."
          }
        }
      },
      "k": 10,
      "num_candidates": 100
    }
  }
}
```

When all targeted fields are inference fields, Elasticsearch obtains the `inference_id`s from the field mappings. Specify `inference_id` in the query vector builder when querying inference fields together with a `dense_vector` field.

### Retrievers

Use a [`standard` retriever](https://www.elastic.co/docs/reference/elasticsearch/rest-apis/retrievers/standard-retriever) to run a supported Query DSL query against a `semantic` field. The following example uses a `match` query with text input:
```json

{
  "retriever": {
    "standard": {
      "query": {
        "match": {
          "content": "lunar exploration"
        }
      }
    }
  }
}
```

For kNN search through the retriever API, place a `knn` query inside a `standard` retriever. The dedicated [`knn` retriever](https://www.elastic.co/docs/reference/elasticsearch/rest-apis/retrievers/knn-retriever) targets `dense_vector` fields and cannot target a `semantic` field directly.
You can use the `standard` retriever as a child of a compound retriever, such as [RRF](https://www.elastic.co/docs/reference/elasticsearch/rest-apis/retrievers/rrf-retriever) or the [`linear` retriever](https://www.elastic.co/docs/reference/elasticsearch/rest-apis/retrievers/linear-retriever), to combine semantic search with other retrieval strategies.
The `linear` and RRF retrievers also support the [multi-field query format](/docs/reference/elasticsearch/rest-apis/retrievers#multi-field-query-format). This format automatically creates the inner retrievers needed to search lexical and inference fields together. The following example searches a lexical `title` field and a `semantic` field named `content`:
```json

{
  "retriever": {
    "linear": {
      "query": "lunar exploration",
      "fields": [
        "title",
        "content"
      ],
      "normalizer": "minmax"
    }
  }
}
```


### ES|QL

ES|QL does not currently support querying `semantic` fields. Use Query DSL or a retriever instead.

## Automatic pre-filtering

When a `match` query searches a `semantic` field inside a Query DSL `bool` query, Elasticsearch automatically applies the other `must`, `filter`, and `must_not` clauses as [pre-filters](/docs/reference/query-languages/query-dsl/query-dsl-knn-query#knn-query-filtering) to the vector search. The vector search finds the most semantically relevant results within the filtered set of documents.
The following example searches for semantically relevant content while limiting the results to published documents:
```json

{
  "query": {
    "bool": {
      "must": {
        "match": {
          "content": "lunar exploration"
        }
      },
      "filter": {
        "term": {
          "status": "published"
        }
      }
    }
  }
}
```

Automatic pre-filtering does not apply when you use a `knn` query directly. Use the `knn` query's `filter` parameter to define pre-filters explicitly.

## Retrieve values, chunks, and embeddings

The original text and non-text values are returned in `_source`. The generated embeddings are excluded by default.
Non-text values can make `_source` responses large because they include complete data URLs. Use [source filtering](/docs/reference/elasticsearch/rest-apis/retrieve-selected-fields#source-filtering) to exclude `semantic` fields or return only the fields your application needs.
To retrieve the values as they were processed for inference, use the `fields` parameter with the `chunks` format:
```json

{
  "fields": [
    {
      "field": "content",
      "format": "chunks"
    }
  ],
  "_source": false
}
```

For text, the response contains the text of each indexed chunk. For non-text input, the response contains the corresponding input object.
For a detailed text-only example, refer to [Retrieve indexed `semantic_text` chunks](/docs/reference/elasticsearch/mapping-reference/semantic-text-search-retrieval#retrieving-indexed-chunks).
To include generated embeddings and their chunk metadata in `_source`, set `_source.exclude_vectors` to `false`:
```json

{
  "_source": {
    "exclude_vectors": false
  },
  "query": {
    "match_all": {}
  }
}
```

The response returns the embeddings under `_inference_fields`.

## Highlight a `semantic` field

The [`semantic` highlighter](https://www.elastic.co/docs/reference/elasticsearch/rest-apis/highlighting) is the default highlighter for `semantic` fields. It returns the field values or text passages whose embeddings best match the query:
- For text, it returns the most relevant text chunks.
- For non-text input, it returns the complete [data URL](https://developer.mozilla.org/en-US/docs/Web/URI/Reference/Schemes/data) of each matching value.

Use `number_of_fragments` to limit the number of matches and `order: score` to return the most relevant matches first.
The following example returns the two field values or text chunks that best match the query:
```json

{
  "query": {
    "match": {
      "content": "lunar exploration"
    }
  },
  "highlight": {
    "fields": {
      "content": {
        "number_of_fragments": 2,
        "order": "score"
      }
    }
  }
}
```

For text-specific options and examples, refer to [Highlight the most relevant `semantic_text` fragments](/docs/reference/elasticsearch/mapping-reference/semantic-text-search-retrieval#highlighting-fragments).

## Limitations

The `semantic` field has the following limitations:
- It can be used only in indices created in Elasticsearch 9.5 or later. You cannot add it to an index created in an earlier version.
- It cannot be used inside a [`nested`](https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/nested) field.
- It cannot be created by a [dynamic template](https://www.elastic.co/docs/manage-data/data-store/mapping/dynamic-templates).
- It cannot be placed in an object that has `subobjects` disabled.
- It does not support term-level queries, sorting, scripting, or aggregations.
- ES|QL does not support querying `semantic` fields.
- It supports only endpoints with the `embedding` task type and dense-vector embeddings. For `text_embedding` and `sparse_embedding` endpoints, use [`semantic_text`](https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/semantic-text).
