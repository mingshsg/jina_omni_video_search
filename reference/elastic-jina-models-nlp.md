---
title: "Jina models in Elasticsearch (omni getting-started)"
source: https://www.elastic.co/docs/explore-analyze/machine-learning/nlp/ml-nlp-jina
source_markdown: https://www.elastic.co/docs/explore-analyze/machine-learning/nlp/ml-nlp-jina.md
downloaded: 2026-08-25
note: Offline snapshot for local planning. Prefer the live URL for the latest version.
---

---
title: Jina models
description: Use Elastic Jina embedding, reranker, and reader models on Elastic Hosted and Serverless, the Jina platform, cloud marketplaces, or on-prem.
url: https://www.elastic.co/docs/explore-analyze/machine-learning/nlp/ml-nlp-jina
products:
  - Machine Learning
applies_to:
  - Elastic Cloud Serverless: Generally available
  - Elastic Stack: Generally available
---

# Jina models
Jina models are designed and trained for search and retrieval workflows. You can use them to create embeddings for text and multimodal semantic similarity search, rerank candidate results to improve the precision of hybrid search and retrieval-augmented generation (RAG) systems, and extract structured content from HTML and complex documents before indexing.

## Model overview

The following tables list the available Jina models and show where each model can be deployed and how you can access it.
- **Deployment** describes where the model can run: Elastic Hosted, Elastic Serverless, the hosted Jina platform, cloud marketplaces, or on-prem.
- **Access** describes how you call the model: through [Elastic Inference Service (EIS)](#jina-eis-getting-started), the [Jina API](#jina-external), or a [cloud marketplace endpoint](#jina-cloud-marketplaces-access). For setup details, refer to [Access models](#jina-access).

Select a deployment or access option to view the corresponding setup and usage instructions.
<note>
  For models accessed through [Elastic Inference Service (EIS)](https://www.elastic.co/docs/explore-analyze/elastic-inference/eis), availability may vary by Stack version. For supported models and version requirements, refer to [Elastic Inference Service supported models](https://www.elastic.co/docs/explore-analyze/elastic-inference/eis-supported-models).
</note>


### Text embedding models

Text embedding models convert text into vector embeddings for semantic similarity search.

| Model                                                                                    | Description                                                                                                                                                            | Deployment                                                                                                                                                                         | Access                                                                                                                      |
|------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------|
| [`jina-embeddings-v5-text-small`](https://jina.ai/models/jina-embeddings-v5-text-small/) | Multilingual text embeddings with task-specific adapters. Accepts text input and produces 1024-dimensional vector embeddings. Supports input lengths up to 32K tokens. | [Elastic Hosted](#jina-elastic-hosted), [Elastic Serverless](#jina-elastic-hosted), [Jina](#jina-hosted), [Cloud Marketplaces](#jina-cloud-marketplaces), [On-prem](#jina-on-prem) | [EIS](#jina-eis-text-embedding), [Jina API](#jina-external), [Cloud marketplace endpoints](#jina-cloud-marketplaces-access) |
| [`jina-embeddings-v5-text-nano`](https://jina.ai/models/jina-embeddings-v5-text-nano/)   | Multilingual embeddings for edge deployment. Accepts text input and produces 768-dimensional vector embeddings. Supports input lengths up to 8K tokens.                | [Elastic Hosted](#jina-elastic-hosted), [Elastic Serverless](#jina-elastic-hosted), [Jina](#jina-hosted), [Cloud Marketplaces](#jina-cloud-marketplaces), [On-prem](#jina-on-prem) | [EIS](#jina-eis-text-embedding), [Jina API](#jina-external), [Cloud marketplace endpoints](#jina-cloud-marketplaces-access) |


#### Performance considerations

<tab-set>
  <tab-item title="jina-embeddings-v5-text-small">
    - `jina-embeddings-v5-text-small` works best on small, medium or large sized fields that contain natural language. For connector or web crawler use cases, this aligns best with fields like title, description, summary, or abstract.
    - Although the model supports an input token length of 32K, consider chunking very large fields to control latency and cost.
    - Larger documents take longer at ingestion time, and inference time per document also increases the more fields in a document that need to be processed.
    - The more fields your pipeline has to perform inference on, the longer it takes per document to ingest.
  </tab-item>

  <tab-item title="jina-embeddings-v5-text-nano">
    - `jina-embeddings-v5-text-nano` works best on small, medium or large sized fields that contain natural language. For connector or web crawler use cases, this aligns best with fields like title, description, summary, or abstract.
    - Although the model supports an input token length of 8K, consider chunking very large fields to control latency and cost.
    - Larger documents take longer at ingestion time, and inference time per document also increases the more fields in a document that need to be processed.
    - The more fields your pipeline has to perform inference on, the longer it takes per document to ingest.
  </tab-item>
</tab-set>


### Multimodal embedding models

Multimodal embedding models convert text, images, video, audio, and documents such as PDF into vector embeddings in a shared vector space.

| Model                                                                                    | Description                                                                                                                                                                                      | Deployment                                                                                                                                                                         | Access                                                                                                                        |
|------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------|
| [`jina-embeddings-v5-omni-small`](https://jina.ai/models/jina-embeddings-v5-omni-small/) | Multimodal embeddings for text, image, audio, video, and PDF. Accepts multimodal input and produces 1024-dimensional vector embeddings. Supports input lengths up to 32K tokens.                 | [Elastic Hosted](#jina-elastic-hosted), [Elastic Serverless](#jina-elastic-hosted), [Jina](#jina-hosted), [Cloud Marketplaces](#jina-cloud-marketplaces), [On-prem](#jina-on-prem) | [EIS](#jina-omni-getting-started), [Jina API](#jina-external), [Cloud marketplace endpoints](#jina-cloud-marketplaces-access) |
| [`jina-embeddings-v5-omni-nano`](https://jina.ai/models/jina-embeddings-v5-omni-nano/)   | Compact multimodal embeddings for edge deployment. Accepts multimodal input and produces 768-dimensional vector embeddings. Supports input lengths up to 8K tokens.                              | [Elastic Hosted](#jina-elastic-hosted), [Elastic Serverless](#jina-elastic-hosted), [Jina](#jina-hosted), [Cloud Marketplaces](#jina-cloud-marketplaces), [On-prem](#jina-on-prem) | [EIS](#jina-omni-getting-started), [Jina API](#jina-external), [Cloud marketplace endpoints](#jina-cloud-marketplaces-access) |
| [`jina-clip-v2`](https://jina.ai/models/jina-clip-v2/)                                   | Multilingual multimodal embeddings for text and image retrieval. Accepts text and image input and produces 1024-dimensional vector embeddings. Supports input lengths up to 8K tokens.           | [Elastic Hosted](#jina-elastic-hosted), [Elastic Serverless](#jina-elastic-hosted), [Jina](#jina-hosted), [Cloud Marketplaces](#jina-cloud-marketplaces), [On-prem](#jina-on-prem) | [EIS](#jina-omni-getting-started), [Jina API](#jina-external), [Cloud marketplace endpoints](#jina-cloud-marketplaces-access) |
| [`jina-embeddings-v4`](https://jina.ai/models/jina-embeddings-v4/)                       | Universal multimodal embeddings for text, image, and PDF retrieval. Accepts text, image, and PDF input and produces 2048-dimensional vector embeddings. Supports input lengths up to 32K tokens. | [Jina](#jina-hosted), [Cloud Marketplaces](#jina-cloud-marketplaces), [On-prem](#jina-on-prem)                                                                                     | [Jina API](#jina-external), [Cloud marketplace endpoints](#jina-cloud-marketplaces-access)                                    |

Jina also provides a vision-language model for visual question answering:

| Model                                          | Description                                                                                                                                           | Deployment                                                                                     | Access                                                                                     |
|------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------|
| [`jina-vlm`](https://jina.ai/models/jina-vlm/) | Vision-language model for visual question answering. Accepts image and text input and generates text output. Supports input lengths up to 32K tokens. | [Jina](#jina-hosted), [Cloud Marketplaces](#jina-cloud-marketplaces), [On-prem](#jina-on-prem) | [Jina API](#jina-external), [Cloud marketplace endpoints](#jina-cloud-marketplaces-access) |


#### Performance considerations

<tab-set>
  <tab-item title="jina-embeddings-v5-omni-small">
    - Use short video clips instead of long videos. Embeddings created from long videos are often less accurate for search because they try to represent too much content at once. Splitting videos into short clips or scenes improves retrieval quality.
    - Image, video, and audio inference is typically more expensive than text alone. Batch and chunk content to control latency and cost.
    - For long text fields: the model supports an input token length of 32K, but splitting very large passages into chunks often improves latency and per-chunk quality.
  </tab-item>

  <tab-item title="jina-embeddings-v5-omni-nano">
    - Use short video clips instead of long videos. Embeddings created from long videos are often less accurate for search because they try to represent too much content at once. Splitting videos into short clips or scenes improves retrieval quality.
    - Image, video, and audio inference is typically more expensive than text alone. Batch and chunk content to control latency and cost.
    - `jina-embeddings-v5-omni-nano` works best on small, medium or large sized fields that contain natural language. For connector or web crawler use cases, this aligns best with fields like title, description, summary, or abstract.
    - Although the model supports an input token length of 8K, consider chunking very large fields to control latency and cost.
    - Larger documents take longer at ingestion time, and inference time per document also increases the more fields in a document that need to be processed.
    - The more fields your pipeline has to perform inference on, the longer it takes per document to ingest.
  </tab-item>
</tab-set>


### Code embedding models

Code embedding models convert source code and technical text into dense vectors for code search, technical Q&A, and repository retrieval.

| Model                                                                            | Description                                                                                                                                                                       | Deployment                                                                                     | Access                                                                                     |
|----------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------|
| [`jina-code-embeddings-1.5b`](https://jina.ai/models/jina-code-embeddings-1.5b/) | Code embeddings built on code generation models. Accepts source code and technical text and produces 1536-dimensional vector embeddings. Supports input lengths up to 32K tokens. | [Jina](#jina-hosted), [Cloud Marketplaces](#jina-cloud-marketplaces), [On-prem](#jina-on-prem) | [Jina API](#jina-external), [Cloud marketplace endpoints](#jina-cloud-marketplaces-access) |
| [`jina-code-embeddings-0.5b`](https://jina.ai/models/jina-code-embeddings-0.5b/) | Compact code embeddings for edge deployment. Accepts source code and technical text and produces 896-dimensional vector embeddings. Supports input lengths up to 32K tokens.      | [Jina](#jina-hosted), [Cloud Marketplaces](#jina-cloud-marketplaces), [On-prem](#jina-on-prem) | [Jina API](#jina-external), [Cloud marketplace endpoints](#jina-cloud-marketplaces-access) |


### Reader models

Reader models extract clean, structured content from HTML and complex documents for indexing and RAG pipelines.

| Model                                                | Description                                                                                                                                  | Deployment                                                                                     | Access                                                                                     |
|------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------|
| [`ReaderLM-v2`](https://jina.ai/models/ReaderLM-v2/) | Converts raw HTML into Markdown or JSON. Accepts HTML input and generates Markdown or JSON output. Supports input lengths up to 512K tokens. | [Jina](#jina-hosted), [Cloud Marketplaces](#jina-cloud-marketplaces), [On-prem](#jina-on-prem) | [Jina API](#jina-external), [Cloud marketplace endpoints](#jina-cloud-marketplaces-access) |


### Rerankers

Reranker models reorder candidate documents by predicted relevance to improve top query results.

| Model                                                                                              | Description                                                                                                                                                                      | Deployment                                                                                                                                                                         | Access                                                                                                              |
|----------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------|
| [`jina-reranker-v3.5`](https://jina.ai/models/jina-reranker-v3.5/)                                 | Domain-ready listwise reranker for multilingual document retrieval. Accepts text queries and documents and returns relevance rankings. Supports input lengths up to 131K tokens. | [Elastic Hosted](#jina-elastic-hosted), [Elastic Serverless](#jina-elastic-hosted), [Jina](#jina-hosted), [Cloud Marketplaces](#jina-cloud-marketplaces), [On-prem](#jina-on-prem) | [EIS](#jina-eis-rerank), [Jina API](#jina-external), [Cloud marketplace endpoints](#jina-cloud-marketplaces-access) |
| [`jina-reranker-m0`](https://jina.ai/models/jina-reranker-m0/)                                     | Multimodal reranker for visual documents. Accepts text or image queries and documents and returns relevance rankings. Supports input lengths up to 10K tokens.                   | [Jina](#jina-hosted), [Cloud Marketplaces](#jina-cloud-marketplaces), [On-prem](#jina-on-prem)                                                                                     | [Jina API](#jina-external), [Cloud marketplace endpoints](#jina-cloud-marketplaces-access)                          |
| [`jina-reranker-v2-base-multilingual`](https://jina.ai/models/jina-reranker-v2-base-multilingual/) | Cross-encoder reranker for multilingual search. Accepts text queries and documents and returns relevance rankings. Supports input lengths up to 1K tokens.                       | [Elastic Hosted](#jina-elastic-hosted), [Elastic Serverless](#jina-elastic-hosted), [Jina](#jina-hosted), [Cloud Marketplaces](#jina-cloud-marketplaces), [On-prem](#jina-on-prem) | [EIS](#jina-eis-rerank), [Jina API](#jina-external), [Cloud marketplace endpoints](#jina-cloud-marketplaces-access) |
| [`jina-colbert-v2`](https://jina.ai/models/jina-colbert-v2/)                                       | Multilingual ColBERT model for embedding and reranking. Accepts text input and produces 128-dimensional multi-vector embeddings. Supports input lengths up to 8K tokens.         | [Jina](#jina-hosted), [Cloud Marketplaces](#jina-cloud-marketplaces), [On-prem](#jina-on-prem)                                                                                     | [Jina API](#jina-external), [Cloud marketplace endpoints](#jina-cloud-marketplaces-access)                          |


#### Performance considerations

<tab-set>
  <tab-item title="jina-reranker-v3.5">
    - `jina-reranker-v3.5` is designed for top-k reranking in hybrid search and RAG workflows.
    - For larger candidate sets, rerank the most relevant results returned by your first-stage retrieval.
  </tab-item>

  <tab-item title="jina-reranker-v2-base-multilingual">
    - `jina-reranker-v2-base-multilingual` works best on small, medium or large sized fields that contain natural language. This aligns best with fields like title, description, summary, or abstract.
    - The model supports an input token length of 1K and automatically chunks larger content.
    - Larger documents take longer to process, and inference time also increases the more documents are present in the reranking request.
  </tab-item>
</tab-set>


## Deploy models

You can deploy Jina models in the following environments.

### Elastic Hosted and Elastic Serverless

Models run on Elastic infrastructure. Access them through [Elastic Inference Service (EIS)](#jina-eis-getting-started).

### Jina

Models run on the hosted [Jina AI](https://jina.ai/) platform. Access them through the [Jina API](#jina-external): with a [direct API call](#jina-direct-api), through [External inference](#jina-external-infer) in Elasticsearch, or [on-prem](#jina-on-prem).

### Cloud Marketplaces

Selected models are available on providers such as AWS, Azure, and Google Cloud. After you deploy a model in your cloud account, you call the provider endpoint. For details, refer to [Cloud marketplace endpoints](#jina-cloud-marketplaces-access).

### On-prem

Models run in Docker containers on your own infrastructure. Access them through the [Jina API](#jina-on-prem), including from Elasticsearch inference endpoints where supported.

## Access models

You can access Jina models in these ways:
- **[Elastic Inference Service (EIS)](#jina-eis-getting-started)**: Elastic hosts the model. Use this when you want managed inference without provisioning ML nodes.
- **[Jina API](#jina-external)**: The model runs on the hosted Jina platform. Use this when you want Jina-hosted inference outside EIS.
- **[On-prem](#jina-on-prem)**: You run the model in Docker on your own infrastructure. Use this for air-gapped, offline, or compliance scenarios.
- **[Cloud marketplace endpoints](#jina-cloud-marketplaces-access)**: Call models you deployed in your cloud provider account. Use this when the model runs in your AWS, Azure, or Google Cloud account.


### Elastic Inference Service

With [Elastic Inference Service (EIS)](https://www.elastic.co/docs/explore-analyze/elastic-inference/eis), Elastic hosts Jina models on Elastic Hosted and Elastic Serverless and serves them through managed inference endpoints in your cluster. Use this option when you want GPU-accelerated inference without deploying or managing model infrastructure.
To use a model through EIS, create an inference endpoint with `"service": "elastic"` and set `model_id` to the name of the model you want to use.

#### Text embedding models

The following examples use the `text_embedding` task type. Create an inference endpoint and reference the `inference_id` in `text_embedding` inference tasks or search queries:
<tab-set>
  <tab-item title="jina-embeddings-v5-text-small">
    ```json

    {
      "service": "elastic",
      "service_settings": {
        "model_id": "jina-embeddings-v5-text-small"
      }
    }
    ```

    ```json

    {
      "input": "The sky above the port was the color of television tuned to a dead channel.",
      "input_type": "ingest"
    }
    ```
  </tab-item>

  <tab-item title="jina-embeddings-v5-text-nano">
    ```json

    {
      "service": "elastic",
      "service_settings": {
        "model_id": "jina-embeddings-v5-text-nano"
      }
    }
    ```

    ```json

    {
      "input": "The sky above the port was the color of television tuned to a dead channel.",
      "input_type": "ingest"
    }
    ```
  </tab-item>
</tab-set>


#### Multimodal embedding models

<applies-to>Elastic Stack: Generally available since 9.3</applies-to> <applies-to>Elastic Cloud Serverless: Generally available</applies-to>
The following examples use the `embedding` task type.
Create an inference endpoint. The URL path uses the `embedding` task type and ends with the `inference_id` you want to use:
<tab-set>
  <tab-item title="jina-embeddings-v5-omni-small">
    ```json

    {
      "service": "elastic",
      "service_settings": {
        "model_id": "jina-embeddings-v5-omni-small"
      }
    }
    ```
  </tab-item>

  <tab-item title="jina-embeddings-v5-omni-nano">
    ```json

    {
      "service": "elastic",
      "service_settings": {
        "model_id": "jina-embeddings-v5-omni-nano"
      }
    }
    ```
  </tab-item>

  <tab-item title="jina-clip-v2">
    ```json

    {
      "service": "elastic",
      "service_settings": {
        "model_id": "jina-clip-v2"
      }
    }
    ```
  </tab-item>
</tab-set>

Reference the `inference_id` in `embedding` inference requests or search queries.
Below are examples of ingesting different types of content and generating vector embeddings using the `inference_id` created in the earlier request. The omni models support text, images, audio, video, and PDF documents. `jina-clip-v2` supports text and image input only.

##### Text as a JSON array

Pass one or more plain text strings in the `input` array.
<tab-set>
  <tab-item title="jina-embeddings-v5-omni-small">
    ```json

    {
      "input": [
        "A small blue square"
      ]
    }
    ```
  </tab-item>

  <tab-item title="jina-embeddings-v5-omni-nano">
    ```json

    {
      "input": [
        "A small blue square"
      ]
    }
    ```
  </tab-item>

  <tab-item title="jina-clip-v2">
    ```json

    {
      "input": [
        "A small blue square"
      ]
    }
    ```
  </tab-item>
</tab-set>


##### Text and image fused into one embedding

List both a `text` entry and a base64 `image` entry inside `content` so the model produces one embedding that represents the combined multimodal input.
<tab-set>
  <tab-item title="jina-embeddings-v5-omni-small">
    ```json

    {
      "input": [
        {
          "content": [
            {
              "type": "text",
              "value": "A small blue square"
            },
            {
              "type": "image",
              "format": "base64",
              "value": "data:image/png;base64,<BASE64_IMAGE_DATA>"
            }
          ]
        }
      ]
    }
    ```
  </tab-item>

  <tab-item title="jina-embeddings-v5-omni-nano">
    ```json

    {
      "input": [
        {
          "content": [
            {
              "type": "text",
              "value": "A small blue square"
            },
            {
              "type": "image",
              "format": "base64",
              "value": "data:image/png;base64,<BASE64_IMAGE_DATA>"
            }
          ]
        }
      ]
    }
    ```
  </tab-item>
</tab-set>


##### Image only (base64-encoded image bytes)

Use a single `image` block when the input contains only image data.
<tab-set>
  <tab-item title="jina-embeddings-v5-omni-small">
    ```json

    {
      "input": [
        {
          "content": [
            {
              "type": "image",
              "format": "base64",
              "value": "data:image/png;base64,<BASE64_IMAGE_DATA>"
            }
          ]
        }
      ]
    }
    ```
  </tab-item>

  <tab-item title="jina-embeddings-v5-omni-nano">
    ```json

    {
      "input": [
        {
          "content": [
            {
              "type": "image",
              "format": "base64",
              "value": "data:image/png;base64,<BASE64_IMAGE_DATA>"
            }
          ]
        }
      ]
    }
    ```
  </tab-item>

  <tab-item title="jina-clip-v2">
    ```json

    {
      "input": [
        {
          "content": [
            {
              "type": "image",
              "format": "base64",
              "value": "data:image/png;base64,<BASE64_IMAGE_DATA>"
            }
          ]
        }
      ]
    }
    ```
  </tab-item>
</tab-set>


##### Video only (base64-encoded video bytes)

Encode a short video clip as base64. Short video clips usually produce more accurate embeddings for search than creating a single embedding from a longer video.
<tab-set>
  <tab-item title="jina-embeddings-v5-omni-small">
    ```json

    {
      "input": [
        {
          "content": [
            {
              "type": "video",
              "format": "base64",
              "value": "data:video/mp4;base64,<BASE64_VIDEO_DATA>"
            }
          ]
        }
      ]
    }
    ```
  </tab-item>

  <tab-item title="jina-embeddings-v5-omni-nano">
    ```json

    {
      "input": [
        {
          "content": [
            {
              "type": "video",
              "format": "base64",
              "value": "data:video/mp4;base64,<BASE64_VIDEO_DATA>"
            }
          ]
        }
      ]
    }
    ```
  </tab-item>
</tab-set>


##### Audio only (base64-encoded audio bytes)

Use this pattern for speech, music, or other audio you have already read and base64-encoded.
<tab-set>
  <tab-item title="jina-embeddings-v5-omni-small">
    ```json

    {
      "input": [
        {
          "content": [
            {
              "type": "audio",
              "format": "base64",
              "value": "data:audio/wav;base64,<BASE64_AUDIO_DATA>"
            }
          ]
        }
      ]
    }
    ```
  </tab-item>

  <tab-item title="jina-embeddings-v5-omni-nano">
    ```json

    {
      "input": [
        {
          "content": [
            {
              "type": "audio",
              "format": "base64",
              "value": "data:audio/wav;base64,<BASE64_AUDIO_DATA>"
            }
          ]
        }
      ]
    }
    ```
  </tab-item>
</tab-set>


##### PDF or other supported documents (base64-encoded file bytes)

Use the document block with base64-encoded files, such as PDFs, to create document embeddings.
<tab-set>
  <tab-item title="jina-embeddings-v5-omni-small">
    ```json

    {
      "input": [
        {
          "content": [
            {
              "type": "pdf",
              "format": "base64",
              "value": "data:application/pdf;base64,<BASE64_PDF_DATA>"
            }
          ]
        }
      ]
    }
    ```
  </tab-item>

  <tab-item title="jina-embeddings-v5-omni-nano">
    ```json

    {
      "input": [
        {
          "content": [
            {
              "type": "pdf",
              "format": "base64",
              "value": "data:application/pdf;base64,<BASE64_PDF_DATA>"
            }
          ]
        }
      ]
    }
    ```
  </tab-item>
</tab-set>


##### Custom endpoint with truncated embedding dimensions (Matryoshka-style output size)

You can create another endpoint with a smaller `dimensions` value if you want shorter vectors from the same model. Smaller vectors, such as 32 dimensions, can reduce storage usage and improve search speed.
<tab-set>
  <tab-item title="jina-embeddings-v5-omni-small">
    ```json

    {
      "service": "elastic",
      "service_settings": {
        "model_id": "jina-embeddings-v5-omni-small",
        "dimensions": 32
      }
    }
    ```
  </tab-item>

  <tab-item title="jina-embeddings-v5-omni-nano">
    ```json

    {
      "service": "elastic",
      "service_settings": {
        "model_id": "jina-embeddings-v5-omni-nano",
        "dimensions": 32
      }
    }
    ```
  </tab-item>
</tab-set>

<note>
  The Jina v5 omni models availability and the support for the [`semantic_text`](https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/semantic-text) field type depend on your Elastic Stack version:
  - <applies-to>Elastic Stack: Generally available since 9.3</applies-to> In Elastic Stack 9.3 and later, you can create endpoints and run multimodal `embedding` inference requests. You cannot use these models with the [`semantic_text`](https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/semantic-text) field type.
  - <applies-to>Elastic Stack: Generally available since 9.4</applies-to> In Elastic Stack 9.4 and later, you can use [`semantic_text`](https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/semantic-text) mappings for text-only embeddings at ingest and search time.
  - <applies-to>Elastic Stack: Generally available since 9.5</applies-to> In Elastic Stack 9.5 and later, the `semantic` field type supports all modalities, such as text, images, video, audio, and documents.
</note>


#### Reranker models

The following examples use the `rerank` task type. Create an inference endpoint and reference the `inference_id` in `rerank` inference tasks:
<tab-set>
  <tab-item title="jina-reranker-v3.5">
    ```json

    {
      "service": "elastic",
      "service_settings": {
        "model_id": "jina-reranker-v3.5"
      }
    }
    ```

    ```json

    {
      "input": ["The Swiss Alps", "a steep hill", "a pebble", "a glacier"],
      "query": "mountain range"
    }
    ```
  </tab-item>

  <tab-item title="jina-reranker-v2-base-multilingual">
    ```json

    {
      "service": "elastic",
      "service_settings": {
        "model_id": "jina-reranker-v2-base-multilingual"
      }
    }
    ```

    ```json

    {
      "input": ["luke", "like", "leia", "chewy", "r2d2", "star", "wars"],
      "query": "star wars main character"
    }
    ```
  </tab-item>
</tab-set>


### Jina API

You can use the Jina API in the following ways:
- [Jina API (hosted)](#jina-api-hosted): Call models hosted on the Jina AI platform
  - [Direct API call](#jina-direct-api): Send HTTP requests to the hosted Jina API
- [External inference](#jina-external-infer): Call the hosted Jina API through Elasticsearch inference endpoints
- [On-prem](#jina-on-prem): Run models on your own infrastructure, then call the Jina API schemas exposed locally.


#### Jina API (hosted)

When models run on the [Jina AI](https://jina.ai/) platform, you call them through the hosted Jina API. To create a Jina AI API key, refer to [Get your Jina API key](https://jina.ai/api-dashboard/key-manager).

##### Direct API call

Call the hosted Jina API with an HTTP request. The following example uses `curl` to send a `rerank` request for `jina-colbert-v2`:
```bash
curl https://api.jina.ai/v1/rerank \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <api_key>" \
  -d '{
    "model": "jina-colbert-v2",
    "query": "star wars main character",
    "documents": ["luke", "like", "leia", "chewy", "r2d2", "star", "wars"]
  }'
```


##### External inference

Connect Elasticsearch to the hosted Jina API through inference endpoints. Refer to [External inference](https://www.elastic.co/docs/explore-analyze/elastic-inference/external).
To use a hosted model from Elasticsearch, create an inference endpoint with `"service": "jinaai"` and set `model_id` to the name of the model you want to use.
The following example creates a `rerank` endpoint for `jina-colbert-v2`:
```json

{
  "service": "jinaai",
  "service_settings": {
    "api_key": "<api_key>", <1>
    "model_id": "jina-colbert-v2" <2>
  }
}
```

You can reference the `inference_id` of this endpoint in search queries.
For more information about creating Jina AI inference endpoints, including `text_embedding`, `embedding` and `rerank` task types, refer to the [create a JinaAI inference endpoint](https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-inference-put-jinaai) API documentation.

#### On-prem

With [Jina on-prem](https://github.com/jina-ai/jina-on-prem), you run Jina models in Docker containers on your own infrastructure and access them through the Jina API schemas exposed by the container. Use this option for air-gapped or network-restricted environments, offline inference, or compliance and data residency scenarios that require self-hosted model deployment.
To pull, transfer, and run a prebuilt Docker image, refer to the [Jina on-prem Quick Start](https://github.com/jina-ai/jina-on-prem/wiki/Quick-Start).
For supported text embedding and reranking models, you can connect Elasticsearch to the local server through inference endpoints that call the APIs exposed by the container. For the models that support this Elasticsearch integration, refer to the [model overview](#jina-model-overview) tables.

##### Text embedding

Create a `text_embedding` endpoint with the `openai` service type so Elasticsearch sends OpenAI-compatible embedding requests to the Jina on-prem `/v1/embeddings` API:
```json

{
  "service": "openai", <1>
  "service_settings": {
    "url": "http://embed-host:8080/v1/embeddings", <2>
    "model_id": "jina-embeddings-v5-text-small", <3>
    "api_key": "not-needed" <4>
  }
}
```

You can reference the `inference_id` of this endpoint in index mappings for the [`semantic_text`](https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/semantic-text) field type, inference processors, or search queries.

##### Rerank

Create a `rerank` endpoint with the [`custom`](https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-inference-put-custom) service so Elasticsearch can call the Jina on-prem `/v1/rerank` API:
```json

{
  "service": "custom", 
  "service_settings": {
    "url": "http://rerank-host:8084/v1/rerank", <1>
    "headers": {
      "Content-Type": "application/json"
    },
    "request": """
    {
      "model": "jina-reranker-v2-base-multilingual",
      "query": ${query},
      "documents": ${input}
    }
    """, <2>
    "response": { <3>
      "json_parser": {
        "relevance_score": "$.results[*].relevance_score",
        "reranked_index": "$.results[*].index"
      }
    }
  }
}
```

You can reference the `inference_id` of this endpoint in `rerank` inference tasks or in a [`text_similarity_reranker`](https://www.elastic.co/docs/solutions/search/ranking/semantic-reranking) retriever.
You can also call any model running in a Jina on-prem container directly from your application or preprocessing pipeline through the Jina API, without creating an Elasticsearch inference endpoint. For request formats and supported API schemas, refer to the [Jina on-prem API reference](https://github.com/jina-ai/jina-on-prem/wiki/API-Reference).
<note>
  For models other than text embedding and reranking, call the Jina API exposed by the on-prem container, then send the results to Elasticsearch for indexing or search.
</note>


### Cloud marketplace endpoints

When you deploy a model from a cloud marketplace, the model runs in your cloud provider account. You access it by sending HTTP requests to the endpoint created in that environment, for example an Amazon SageMaker, Azure, or Google Cloud endpoint.
The request URL and payload format depend on the provider and listing. For current marketplace listings and provider-specific setup guidance, refer to the [Jina model catalog](https://jina.ai/models#catalog).

## Pricing and licensing

Jina models are Elastic models available under a commercial license. How you are charged depends on where you deploy models and how you access them.
- Models accessed through EIS on Elastic Hosted or Elastic Serverless are billed per million tokens, or as otherwise included in EIS. For details, refer to [Pricing](/docs/explore-analyze/elastic-inference/eis#pricing) and the [Elasticsearch Serverless pricing page](https://www.elastic.co/pricing/serverless-search). To use Jina models on EIS, you must have the [appropriate subscription](https://www.elastic.co/subscriptions) level or the trial period activated.
- Models accessed through the hosted Jina API are billed according to your Jina AI account and API usage. Refer to [Get your Jina API key](https://jina.ai/api-dashboard/key-manager).
- For Jina on-prem and other commercial licensing, contact [Elastic sales](https://www.elastic.co/contact) for pricing and licensing.


## Further reading

For more background and related resources:
- [jina-embeddings-v5-text](https://www.elastic.co/search-labs/blog/jina-embeddings-v5-text): Introduces the compact multilingual text embedding models (`small` and `nano`) and how to use them on EIS.
- [jina-embeddings-v5-omni](https://www.elastic.co/search-labs/blog/jina-embeddings-v5-omni-all-media-one-index): Explains how to embed text, images, video, and audio into a single Elasticsearch index.
- [Jina rerankers on EIS](https://www.elastic.co/search-labs/blog/jina-rerankers-elastic-inference-service): Covers `jina-reranker-v2-base-multilingual` and `jina-reranker-v3` for multilingual reranking in retrieval and RAG workflows.
- [Jina model catalog](https://jina.ai/models#catalog): Browse the full set of Jina Search Foundation models and their capabilities.
