---
title: "Semantic field type"
source: https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/semantic-field
source_markdown: https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/semantic-field.md
downloaded: 2026-08-25
note: Offline snapshot for local planning. Prefer the live URL for the latest version.
---

---
title: Semantic field type
description: The semantic field type simplifies semantic and multimodal search across text, images, audio, video, and PDF files. With a compatible multimodal embedding...
url: https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/semantic-field
products:
  - Elasticsearch
applies_to:
  - Elastic Cloud Serverless: Preview
  - Elastic Stack: Preview since 9.5
---

# Semantic field type
<warning>
  The `semantic` field mapping can be added regardless of license state. However, it calls the [Inference API](https://www.elastic.co/docs/api/doc/elasticsearch/group/endpoint-inference), which requires an [appropriate license](https://www.elastic.co/subscriptions). Using a `semantic` field without the appropriate license causes operations such as indexing and reindexing to fail.
</warning>

The `semantic` field type simplifies semantic and multimodal search across text, images, audio, video, and PDF files. With a compatible multimodal embedding model, you can search from any supported input type to any other supported input type. The field automatically:
- Generates embeddings when you index field values, without an ingest pipeline or inference processor.
- Splits long text into smaller passages, called chunks.
- Indexes the generated embeddings using default index options that optimize for common use cases.
- Searches the embeddings generated for each value or text chunk.

For multimodal search, Elastic recommends [Jina multimodal embeddings](https://www.elastic.co/docs/explore-analyze/machine-learning/nlp/ml-nlp-jina#jina-multimodal-embeddings).
Elasticsearch refers to `semantic` and `semantic_text` as *inference fields*: mapped fields that use inference endpoints and store generated embeddings in internal subfields.
Multiple `semantic` fields can use the same inference endpoint. For example, an index can use one field for image embeddings and another for description embeddings, then search either field or both.
<tip>
  The `semantic` field type shares many capabilities with `semantic_text`, but `semantic_text` accepts text only. If you're working exclusively with text, consider using [`semantic_text`](https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/semantic-text).For a comparison table, refer to [Should I use `semantic_text` or `semantic`?](#should-i-use-semantictext-or-semantic).
</tip>


## Should I use [`semantic_text`](https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/semantic-text) or [`semantic`](https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/semantic-field)?

Elasticsearch provides two field types that generate and store embeddings automatically. Choose the field type based on the content and embedding model you want to use.
`semantic_text` accepts text only. To index or search images, audio, video, or PDF files, use `semantic` with a compatible multimodal embedding endpoint.

| Aspect                         | [`semantic`](https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/semantic-field)                   | [`semantic_text`](https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/semantic-text)                                       |
|--------------------------------|----------------------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------|
| Input                          | Text, images, audio, video, and PDF files                                                                            | **Text only**                                                                                                                                |
| Supported inference task types | `embedding`                                                                                                          | `embedding`, `text_embedding`, and `sparse_embedding`                                                                                        |
| Vector storage                 | Dense vectors only                                                                                                   | Dense or sparse vectors                                                                                                                      |
| `inference_id`                 | Required. No default endpoint is provided.                                                                           | Optional. A default endpoint is used when you don't specify one.                                                                             |
| `search_inference_id`          | Optional. If omitted, `inference_id` is used for search.                                                             | Optional. If omitted, `inference_id` is used for search.                                                                                     |
| `chunking_settings`            | Supported for text input. Chunking does not apply to non-text input.                                                 | Supported for text input.                                                                                                                    |
| `index_options`                | Supports `dense_vector` options.                                                                                     | Supports `dense_vector` and `sparse_vector` options.                                                                                         |
| `meta`                         | Supported.                                                                                                           | Supported.                                                                                                                                   |
| Availability                   | <applies-to>Elastic Stack: Preview since 9.5</applies-to> <applies-to>Elastic Cloud Serverless: Preview</applies-to> | <applies-to>Elastic Stack: Generally available since 9.0</applies-to> <applies-to>Elastic Cloud Serverless: Generally available</applies-to> |


## Basic `semantic` mapping example

The following example creates an index mapping with a `semantic` field using `.jina-embeddings-v5-omni-small`, the preconfigured inference endpoint for the Jina Embeddings v5 Omni Small model:
```json

{
  "mappings": {
    "properties": {
      "content": {
        "type": "semantic",
        "inference_id": ".jina-embeddings-v5-omni-small"
      }
    }
  }
}
```

Unlike [`semantic_text`](https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/semantic-text), a `semantic` field has no default inference endpoint. You must use an endpoint that uses the `embedding` task type and specify its ID in the field mapping. The endpoint determines which input modalities the field supports.

## Extended `semantic` mapping example

The following example customizes the search endpoint, text chunking, and dense-vector index options:
```json

{
  "mappings": {
    "properties": {
      "content": {
        "type": "semantic",
        "inference_id": "my-index-embedding-endpoint", <1>
        "search_inference_id": "my-search-embedding-endpoint", <2>
        "chunking_settings": { <3>
          "strategy": "word",
          "max_chunk_size": 250,
          "overlap": 50
        },
        "index_options": { <4>
          "dense_vector": {
            "type": "int8_hnsw"
          }
        }
      }
    }
  }
}
```


## Quickstart

Follow the [multimodal search tutorial](https://www.elastic.co/docs/solutions/search/multimodal-search/multimodal-search-tutorial) to index a small collection of images into Elasticsearch and search those images using text, other images, and PDFs.

## Reference documentation

Refer to the [`semantic` field reference](https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/semantic-field-reference) for the complete technical details, including:
- [Parameters for `semantic` fields](/docs/reference/elasticsearch/mapping-reference/semantic-field-reference#semantic-params)
- [Inference endpoint requirements](/docs/reference/elasticsearch/mapping-reference/semantic-field-reference#semantic-inference-endpoint)
- [Supported input types](/docs/reference/elasticsearch/mapping-reference/semantic-field-reference#semantic-input)
- [Limitations](/docs/reference/elasticsearch/mapping-reference/semantic-field-reference#semantic-limitations)
