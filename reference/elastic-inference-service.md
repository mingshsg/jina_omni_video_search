---
title: "Elastic Inference Service"
source: https://www.elastic.co/docs/explore-analyze/elastic-inference/eis
source_markdown: https://www.elastic.co/docs/explore-analyze/elastic-inference/eis.md
downloaded: 2026-08-25
note: Offline snapshot for local planning. Prefer the live URL for the latest version.
---

---
title: Elastic Inference Service
description: Use Elastic Inference Service (EIS) to run inference for search, embeddings, and chat without deploying models in your environment.
url: https://www.elastic.co/docs/explore-analyze/elastic-inference/eis
products:
  - Elastic Cloud Enterprise
  - Elastic Cloud on Kubernetes
  - Elastic Stack
applies_to:
  - Elastic Cloud Serverless: Generally available
  - Elastic Stack: Generally available
---

# Elastic Inference Service
Elastic Inference Service (EIS) enables you to leverage AI-powered search as a service without deploying a model in your environment.
With EIS, you don't need to manage the infrastructure and resources required for machine learning inference by adding, configuring, and scaling machine learning nodes.
Instead, you can use machine learning models for ingest, search, and chat independently of your Elasticsearch infrastructure.
<applies-to>Elastic Stack: Generally available since 9.3</applies-to> You can use EIS with your [self-managed](https://www.elastic.co/docs/deploy-manage/deploy/self-managed) cluster through Cloud Connect. For details, refer to [EIS for self-managed clusters](https://www.elastic.co/docs/explore-analyze/elastic-inference/connect-self-managed-cluster-to-eis).

## AI features powered by EIS

- Your Elastic deployment or project comes with [Elastic Managed LLMs](https://www.elastic.co/docs/reference/kibana/connectors-kibana/elastic-managed-llm) by default. These can be used in Agent Builder, the AI Assistant, Attack Discovery, Automatic Import and Search Playground. For the list of available models, refer to [Supported models](https://www.elastic.co/docs/explore-analyze/elastic-inference/eis-supported-models).
- You can use [ELSER](https://www.elastic.co/docs/explore-analyze/machine-learning/nlp/ml-nlp-elser) to perform semantic search as a service (ELSER on EIS). <applies-to>Elastic Stack: Generally available since 9.2, Elastic Stack: Preview in 9.1</applies-to> <applies-to>Elastic Cloud Serverless: Generally available</applies-to>
- You can use the [`jina-embeddings-v3`](/docs/explore-analyze/machine-learning/nlp/ml-nlp-jina#jina-text-embeddings) multilingual dense vector embedding model to perform semantic search through the Elastic Inference Service. <applies-to>Elastic Stack: Preview since 9.3</applies-to> <applies-to>Elastic Cloud Serverless: Preview</applies-to>


## Manage your models

Kibana provides interfaces for managing EIS models and endpoints.
<applies-switch>
  <applies-item title="{ stack: ga 9.4+, serverless: ga }" applies-to="Elastic Cloud Serverless: Generally available, Elastic Stack: Generally available since 9.4">
    Go to the **Elastic inference** page by using the navigation menu or the [global search field](https://www.elastic.co/docs/explore-analyze/find-and-organize/find-apps-and-objects).
    ![Elastic Inference UI](https://www.elastic.co/docs/explore-analyze/images/eis-ui.png)

    <tip>
      To access **Elastic inference**, you need the `Inference Endpoints: all` and `Advanced Settings: read` Kibana privileges.
    </tip>
  </applies-item>

  <applies-item title="stack: ga 9.0-9.3" applies-to="Elastic Stack: Generally available from 9.0 to 9.3">
    Go to the **Inference endpoints** page by using the navigation menu or the [global search field](https://www.elastic.co/docs/explore-analyze/find-and-organize/find-apps-and-objects).
    ![Inference endpoints UI](https://www.elastic.co/docs/explore-analyze/images/kibana-inference-endpoints-ui.png)
  </applies-item>
</applies-switch>

Available actions include:
- Add endpoints
- View endpoint details
- Copy the inference endpoint ID
- Delete endpoints
- <applies-to>Elastic Stack: Generally available since 9.5</applies-to> <applies-to>Elastic Cloud Serverless: Generally available</applies-to> [Region preferences](/docs/explore-analyze/elastic-inference/eis-region-and-hosting#inference-region-preferences) for where EIS processes inference requests


## Add endpoints

Your deployment includes default inference endpoints which are preconfigured and ready to use.
In most cases, you should use these default endpoints.
However, you can choose to create custom EIS endpoints if you need to instantiate a specific model version or configuration that is not covered by the defaults.
<applies-switch>
  <applies-item title="{ stack: ga 9.4+, serverless: ga }" applies-to="Elastic Cloud Serverless: Generally available, Elastic Stack: Generally available since 9.4">
    1. Go to the **Elastic inference** page by using the navigation menu or the [global search field](https://www.elastic.co/docs/explore-analyze/find-and-organize/find-apps-and-objects).
    2. Select the model you want the new endpoint to use.
    3. Click **Add endpoint**.
    4. Enter a unique **Model ID**. For a complete list of valid Model IDs and their corresponding task types, refer to the [Supported models](https://www.elastic.co/docs/explore-analyze/elastic-inference/eis-supported-models).
    5. Select **Save**.
  </applies-item>

  <applies-item title="stack: ga 9.0-9.3" applies-to="Elastic Stack: Generally available from 9.0 to 9.3">
    1. Go to the **Inference endpoints** page by using the navigation menu or the [global search field](https://www.elastic.co/docs/explore-analyze/find-and-organize/find-apps-and-objects).
    2. In the **Service** dropdown, select **Elastic Inference Service**.
    3. In the **Settings** section, enter the specific **Model ID**. For a complete list of valid Model IDs and their corresponding task types, refer to the [Elastic Inference Service supported models](https://www.elastic.co/docs/explore-analyze/elastic-inference/eis-supported-models).
    4. (Optional) Under **More options**, set the **Maximum Input Tokens**. This limits the number of tokens processed per request. If left blank, the model's default limit is used.
    5. Expand **Additional settings** and select the **Task type** that corresponds to your model.
    6. Select **Save**.
  </applies-item>
</applies-switch>

Alternatively, you can use [inference APIs](https://www.elastic.co/docs/api/doc/elasticsearch/group/endpoint-inference), as described in the following section.

## Get started with models on EIS

The following sections describe how to get started with specific models available through Elastic Inference Service, including creating inference endpoints and using them for search and ingest.

### Jina v5 omni embedding models

<applies-to>
  - Elastic Cloud Serverless: Generally available
  - Elastic Stack: Generally available since 9.3
</applies-to>

<important>
  The Jina v5 omni models availability and the support for the [`semantic_text`](https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/semantic-text) field type depend on your Elastic Stack version:
  - <applies-to>Elastic Stack: Generally available since 9.3</applies-to> In Elastic Stack 9.3 and later, you can create endpoints and run multimodal `embedding` inference requests. You cannot use these models with the [`semantic_text`](https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/semantic-text) field type.
  - <applies-to>Elastic Stack: Generally available since 9.4</applies-to> In Elastic Stack 9.4 and later, you can use [`semantic_text`](https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/semantic-text) mappings for text-only embeddings at ingest and search time.
  - <applies-to>Elastic Stack: Generally available since 9.5</applies-to> In Elastic Stack 9.5 and later, the `semantic` field type supports all modalities, such as text, images, video, audio, and documents.
</important>

There are two Jina v5 omni embedding models available through Elastic Inference Service, [`jina-embeddings-v5-omni-small`](#jina-embeddings-v5-omni-small-on-eis) and [`jina-embeddings-v5-omni-nano`](#jina-embeddings-v5-omni-nano-on-eis). Both models support multimodal embeddings for text, images, video, audio, and documents such as PDF in one shared vector space.
- Use [`jina-embeddings-v5-omni-small`](#jina-embeddings-v5-omni-small-on-eis) for larger context windows and higher-capacity retrieval workloads.
- Use [`jina-embeddings-v5-omni-nano`](#jina-embeddings-v5-omni-nano-on-eis) for lower cost and lower resource usage.


#### `jina-embeddings-v5-omni-small` on EIS

Create an inference endpoint that references the `jina-embeddings-v5-omni-small` model in the `model_id` field. Use the `embedding` task type so the endpoint can accept multimodal input.
```json

{
  "service": "elastic",
  "service_settings": {
    "model_id": "jina-embeddings-v5-omni-small"
  }
}
```

You can reference the `inference_id` in `embedding` inference tasks and search queries on any supported version.
For examples of ingesting different media types and generating embeddings for text, images, audio, and video, refer to [Getting started with Jina v5 omni embedding models through Elastic Inference Service](/docs/explore-analyze/machine-learning/nlp/ml-nlp-jina#jina-omni-getting-started). Select the jina-embeddings-v5-omni-small tab in each example.

#### `jina-embeddings-v5-omni-nano` on EIS

Create an inference endpoint that references the `jina-embeddings-v5-omni-nano` model in the `model_id` field. Use the `embedding` task type so the endpoint can accept multimodal input.
```json

{
  "service": "elastic",
  "service_settings": {
    "model_id": "jina-embeddings-v5-omni-nano"
  }
}
```

You can reference the `inference_id` in `embedding` inference tasks and search queries on any supported version.
For examples of ingesting different media types and generating embeddings for text, images, audio, and video, refer to [Getting started with Jina v5 omni embedding models through Elastic Inference Service](/docs/explore-analyze/machine-learning/nlp/ml-nlp-jina#jina-omni-getting-started). Select the jina-embeddings-v5-omni-nano tab in each example.

### `jina-embeddings-v5-text-small` on EIS

<applies-to>
  - Elastic Cloud Serverless: Preview
  - Elastic Stack: Preview since 9.4
</applies-to>

You can use the `jina-embeddings-v5-text-small` model through Elastic Inference Service. Running the model on EIS means that you use the model on GPUs, without the need of managing infrastructure and model resources.

#### Get started with `jina-embeddings-v5-text-small` on EIS

Create an inference endpoint that references the `jina-embeddings-v5-text-small` model in the `model_id` field.
```json

{
  "service": "elastic",
  "service_settings": {
    "model_id": "jina-embeddings-v5-text-small"
  }
}
```

The created inference endpoint uses the model for inference operations on the Elastic Inference Service. You can reference the `inference_id` of the endpoint in index mappings for the [`semantic_text`](https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/semantic-text) field type, `text_embedding` inference tasks, or search queries.

### `jina-embeddings-v3` on EIS

<applies-to>
  - Elastic Cloud Serverless: Preview
  - Elastic Stack: Preview since 9.3
</applies-to>

You can use the `jina-embeddings-v3` model through Elastic Inference Service. Running the model on EIS means that you use the model on GPUs, without the need of managing infrastructure and model resources.

#### Get started with `jina-embeddings-v3` on EIS

Create an inference endpoint that references the `jina-embeddings-v3` model in the `model_id` field.
```json

{
  "service": "elastic",
  "service_settings": {
    "model_id": "jina-embeddings-v3"
  }
}
```

The created inference endpoint uses the model for inference operations on the Elastic Inference Service. You can reference the `inference_id` of the endpoint in index mappings for the [`semantic_text`](https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/semantic-text) field type, text_embedding inference tasks, or search queries.

### ELSER through Elastic Inference Service (ELSER on EIS)

<applies-to>
  - Elastic Cloud Serverless: Generally available
  - Elastic Stack: Generally available since 9.2
  - Elastic Stack: Preview in 9.1
</applies-to>

ELSER on EIS enables you to use the ELSER model on GPUs, without having to manage your own ML nodes. We expect better performance for ingest throughput than ML nodes and equivalent performance for search latency. We will continue to benchmark, remove limitations and address concerns.

#### Using the ELSER on EIS endpoint

You can now use `semantic_text` with the new ELSER endpoint on EIS. To learn how to use the `.elser-2-elastic` inference endpoint, refer to [Using ELSER on EIS](https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/semantic-text-setup-configuration#using-elser-on-eis).

##### Get started with semantic search with ELSER on EIS

[Semantic Search with `semantic_text`](https://www.elastic.co/docs/solutions/search/semantic-search/semantic-search-semantic-text) has a detailed tutorial on using the `semantic_text` field and using the ELSER endpoint on EIS instead of the default endpoint. This is a great way to get started and try the new endpoint.

## Pricing

All models on EIS incur a charge per million tokens. Certain LLM providers charge different prices depending on the prompt size. The pricing details are available on our [Pricing page](https://cloud.elastic.co/cloud-pricing-table?productType=serverless).
This pricing model differs from the existing [Machine Learning Nodes](https://www.elastic.co/docs/explore-analyze/machine-learning/data-frame-analytics/ml-trained-models), which is billed through VCUs consumed.

### Token-based billing

EIS is billed per million tokens used:
- For **chat** models, input and output tokens are billed. Longer conversations with extensive context or detailed responses will consume more tokens.
- For **embeddings** models, only input tokens are billed.

Tokens are the fundamental units that language models process for both input and output. Tokenizers convert text into numerical data by segmenting it into subword units. A token can be a complete word, part of a word, or a punctuation mark, depending on the model's trained tokenizer and the frequency patterns in its training data.
For example, the sentence `It was the best of times, it was the worst of times.` contains 52 characters but would tokenize into approximately 14 tokens with a typical word-based approach, though the exact count varies by tokenizer.

### Monitor your token usage

To track your token consumption:
1. Navigate to [**Billing > Usage**](https://cloud.elastic.co/billing/usage) in the Elastic Cloud Console.
2. Look for line items where the **Billing dimension** is set to "Inference".


## Service status

Elastic Inference Service (EIS) is a global service on Elastic Cloud. Like any service, it might undergo availability changes from time to time. When availability changes, Elastic posts updates on the [Cloud Status](https://status.elastic.co/) page.
EIS incidents and maintenance affect features that rely on EIS, such as semantic search, embeddings, reranking, and AI-powered assistants.
To check current and past EIS availability, go to the [Cloud Status](https://status.elastic.co/) page. EIS is listed under **Global services** as **Elastic Inference Service**.
![Elastic Inference Service status on the Cloud Status page](https://www.elastic.co/docs/explore-analyze/images/eis-status.png)

Learn how to [subscribe to updates](/docs/deploy-manage/cloud-organization/service-status#ec_subscribe_to_updates) on the Service status page.
