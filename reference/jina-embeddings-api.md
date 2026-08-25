---
title: "Jina Embedding API (FAQ includes file size limits)"
source: https://jina.ai/embeddings/
downloaded: 2026-08-25
note: Offline snapshot for local planning. Prefer the live URL for the latest version.
---

Embedding API - Jina AI

# Embeddings

Top-performing multimodal multilingual long-context embeddings for search, RAG, agents applications.

API

---

Pricing

## Embedding API

Try our embedding models to improve your search and RAG systems. Start with a free trial!

API Key & Billing

Usage

More

---

On CSP

Docs

---

Select embeddings

L2 normalization

normalized

Scale embeddings to unit length (L2 norm = 1). Required for cosine similarity via dot product.

Output data type

embedding_type

encoding_format

output_dtype

embedding_types

Choose output format: float (default), binary (compact storage), or base64 (efficient transmission).

Default (as float)

---

Request

POST

Copy

Bash

```
curl "https://api.jina.ai/v1/embeddings" \  -H "Content-Type: application/json" \  -H "Authorization: Bearer $JINA_API_KEY" \  -d @- <<EOFEOF{
  "model": null,
  "normalized": true,
  "embedding_type": "float",
  "input": [
    text_fieldsclose"Organic skincare for sensitive skin with aloe vera and chamomile: Imagine the soothing embrace of na…ing, healthy complexion.",
    text_fieldsclose"Bio-Hautpflege für empfindliche Haut mit Aloe Vera und Kamille: Erleben Sie die wohltuende Wirkung u…einen strahlenden Teint.",
    text_fieldsclose"Cuidado de la piel orgánico para piel sensible con aloe vera y manzanilla: Descubre el poder de la n…el radiante y saludable.",
    text_fieldsclose"针对敏感肌专门设计的天然有机护肤产品：体验由芦荟和洋甘菊提取物带来的自然呵护。我们的护肤产品特别为敏感肌设计，温和滋润，保护您的肌肤不受刺激。让您的肌肤告别不适，迎来健康光彩。",
    text_fieldsclose"新しいメイクのトレンドは鮮やかな色と革新的な技術に焦点を当てています: 今シーズンのメイクアップトレンドは、大胆な色彩と革新的な技術に注目しています。ネオンアイライナーからホログラフィックハイライターまで、クリエイティビティを解き放ち、毎回ユニークなルックを演出しましょう。"
    + add input
  ]
}EOFEOF
```

---

GET RESPONSE

---

API key

---

Available tokens

0

This is your unique key. Store it securely!

## v5-omni: One Embedding for All

Text, image, audio, video — one shared embedding space, two sizes. v5-omni-small (1.6B) is the best-performing open-weight omni model under 2B parameters. v5-omni-nano (0.9B) delivers competitive retrieval at under 1B. Both are byte-for-byte compatible with v5-text — no reindexing needed.

## v5-text: New SOTA Small Multilingual Embeddings

jina-embeddings-v5-text delivers fifth-generation embedding quality in two efficient sizes — a 677M small and 239M nano model — with task-specific LoRA adapters, Matryoshka dimensions, 32K context, and GGUF/MLX quantization for edge deployment, setting new benchmarks across MMTEB, MTEB English, and retrieval tasks.

## Two Ways to Purchase

Subscribe to our API or purchase through cloud providers.

With 3 cloud service providers

Using AWS or Azure? You can deploy our models directly on your company's cloud platform and handle billing through the CSP account.

AWS SageMaker

Embeddings

Reranker

Microsoft Azure

Embeddings

Reranker

Google Cloud

Embeddings

With Jina Search Foundation API

The easiest way to access all of our products. Top-up tokens as you go.

Enter the API key you wish to recharge

Top up this API key with more tokens

Depending on your location, you may be charged in USD, EUR, or other currencies. Taxes may apply.

Please input the right API key to top up

Understand the rate limit

Rate limits are the maximum number of requests that can be made to an API within a minute per IP address/API key (RPM). Find out more about the rate limits for each product and tier below.

Rate Limit

Rate limits are tracked in three ways: RPM (requests per minute), and TPM (tokens per minute). Limits are enforced per IP/API key and will be triggered when either the RPM or TPM threshold is reached first. When you provide an API key in the request header, we track rate limits by key rather than IP address.

Columns

| | Product | API Endpoint | Description arrow_upward | w/o API Key key_off | w/ Free API Key key | w/ Paid API Key key | w/ Premium API Key key | Average Latency | Token Usage Counting | Allowed Request |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| | Reader API | `https://r.jina.ai` | Convert URL to LLM-friendly text | 20 RPM | 500 RPM | 500 RPM | trending_up 5000 RPM | 7.9s | Count the number of tokens in the output response. | GET/POST |
| | Reader API | `https://s.jina.ai` | Search the web and convert results to LLM-friendly text | block | 100 RPM | 100 RPM | trending_up 1000 RPM | 2.5s | Every request costs a fixed number of tokens, starting from 10000 tokens | GET/POST |
| | Embedding API | `https://api.jina.ai/v1/embeddings` | Convert text/images to fixed-length vectors | block | 100 RPM & 100,000 TPM | 500 RPM & 2,000,000 TPM | trending_up 5,000 RPM & 50,000,000 TPM | ssid_chart depends on the input size help | Count the number of tokens in the input request. | POST |
| | Reranker API | `https://api.jina.ai/v1/rerank` | Rank documents by query | block | 100 RPM & 100,000 TPM | 500 RPM & 2,000,000 TPM | trending_up 5,000 RPM & 50,000,000 TPM | ssid_chart depends on the input size help | Count the number of tokens in the input request. | POST |

Auto top-up on low token balance

Recommended for uninterrupted service in production. When your token balance drops below the set threshold, we will automatically recharge your saved payment method for the last purchased package, until the threshold is met.

We introduced a new pricing model on May 6th, 2025. If you enabled auto-recharge before this date, you'll continue to pay the old price (the one when you purchased). The new pricing only applies if you modify your auto-recharge settings or purchase a new API key.

< 1M Tokens

Top up when

## On-premises deployment

Deploy Jina Embeddings models in AWS Sagemaker and Microsoft Azure, and soon in Google Cloud Services, or contact our sales team to get customized Kubernetes deployments for your Virtual Private Cloud and on-premises servers.

AWS SageMaker

Embeddings

Reranker

Microsoft Azure

Embeddings

Reranker

Google Cloud

Embeddings

API Integrations

Our Embedding API is natively integrated with various renowned databases, vector stores, RAG, and LLMOps frameworks. To begin, just copy and paste your API key into any of the listed integrations for a quick and seamless start.

Vector Store

LLMOps

RAG

Observability

MongoDB

DataStax

Qdrant

Pinecone

Chroma

Weaviate

Milvus

Epsilla

MyScale

LlamaIndex

Haystack

Langchain

Dify

SuperDuperDB

DashVector

Portkey

Baseten

TiDB

LanceDB

Carbon

## Our Publications

Understand how our frontier search models were trained from scratch, check out our latest publications. Meet our team at EMNLP, SIGIR, ICLR, NeurIPS, and ICML!

arXiv July 20, 2026jina-reranker-v3.5: An Efficient Listwise Reranker with Hybrid Attention and Self-Distillation

SIGIR 2026May 11, 2026jina-embeddings-v5-omni: Geometry-preserving Embeddings via Locked Aligned Towers

SIGIR 2026February 17, 2026jina-embeddings-v5-text: Task-Targeted Embedding Distillation

ICLR 2026January 22, 2026Embedding Compression via Spherical Coordinates

arXiv December 29, 2025Vision Encoders in Vision-Language Models: A Survey

ICLR 2026December 04, 2025Jina-VLM: Small Multilingual Vision Language Model

AAAI 2026October 01, 2025jina-reranker-v3: Last but Not Late Interaction for Document Reranking

NeurIPS 2025August 31, 2025Efficient Code Embeddings from Code Generation Models

EMNLP 2025June 24, 2025jina-embeddings-v4: Universal Embeddings for Multimodal Multilingual Retrieval

ICLR 2025March 04, 2025ReaderLM-v2: Small Language Model for HTML to Markdown and JSON

ACL 2025December 17, 2024AIR-Bench: Automated Heterogeneous Information Retrieval Benchmark

ICLR 2025December 12, 2024jina-clip-v2: Multilingual Multimodal Embeddings for Text and Images

ECIR 2025September 18, 2024jina-embeddings-v3: Multilingual Embeddings With Task LoRA

SIGIR 2025September 07, 2024Late Chunking: Contextual Chunk Embeddings Using Long-Context Embedding Models

EMNLP 2024August 30, 2024Jina-ColBERT-v2: A General-Purpose Multilingual Late Interaction Retriever

WWW 2025June 21, 2024Leveraging Passage Embeddings for Efficient Listwise Reranking with Large Language Models

ICML 2024May 30, 2024Jina CLIP: Your CLIP Model Is Also Your Text Retriever

arXiv February 26, 2024Multi-Task Contrastive Learning for 8192-Token Bilingual Text Embeddings

arXiv October 30, 2023Jina Embeddings 2: 8192-Token General-Purpose Text Embeddings for Long Documents

EMNLP 2023July 20, 2023Jina Embeddings: A Novel Set of High-Performance Sentence Embedding Models

20 publications in total.

## Learning about Embeddings

Where to start with embeddings? We've got you covered. Learn about embeddings from the ground up with our comprehensive guide.

May 12, 2026 • 7 minutes readjina-embeddings-v5-omni: Embeddings for Text, Image, Audio and VideoOne model, four modalities: text, image, audio, video. Best-in-class omni embeddings in 1.6B and 0.9B.

May 11, 2026jina-embeddings-v5-omni: Geometry-preserving Embeddings via Locked Aligned TowersWe introduce GELATO (Geometry-preserving Embeddings via Locked Aligned TOwers), a novel approach to multimodal embedding models. We build on the VLM-style architecture, in which non-text encoders are adapted to produce input for a language model, which in turn generates embeddings for all varieties of input. GELATO extends the two Jina Embeddings v5 Text models to support additional modality by adding encoders for images and audio. The backbone text embedding models and the added non-text modality encoders remain frozen. We only trained the connecting components, representing 0.35% of the total weights of the joint model. Additionally, the language model remains effectively unaltered, producing exactly the same embeddings for text inputs as the Jina Embeddings v5 Text models. The resulting jina-embeddings-v5-omni suite encodes text, image, audio, and video into a single semantic embedding space, yielding nearly equal performance to larger multimodal embedding models.

March 11, 2026 • 7 minutes readBootstrapping Audio Embeddings from Multimodal LLMsTurn any multimodal LLM into a small audio embedding model that beats CLAP with 25x less data.

March 06, 2026 • 6 minutes readIdentifying Embedding Models from Raw Numerical ValuesA tiny transformer that fingerprints embedding models by reading raw numerical digits. No feature engineering.

## Comparison of Reranker, Vector Search, and BM25

The table below provides a comprehensive comparison of the Reranker, Vector/Embeddings Search, and BM25, highlighting their strengths and weaknesses across various categories.

| | Reranker | Vector Search | BM25 |
| --- | --- | --- | --- |
| Best For | Enhanced search precision and relevance | Initial, rapid filtering | General text retrieval across wide-ranging queries |
| Granularity | Detailed: Sub-document and query segment | Broad: Entire documents | Intermediate: Various text segments |
| Query Time Complexity | High | Medium | Low |
| Indexing Time Complexity | Not required | High | Low, utilizes pre-built index |
| Training Time Complexity | High | High | Not required |
| Search Quality | Superior for nuanced queries | Balanced between efficiency and accuracy | Consistent and reliable for a broad set of queries |
| Strengths | Highly accurate with deep contextual understanding | Quick and efficient, with moderate accuracy | Highly scalable, with established efficacy |
| | Try reranker API for free | Try embedding API for free | |

## The Evolution of Embeddings Poster

Discover the ideal poster for your space, featuring captivating infographics or breathtaking visuals tracing the evolution of text embedding models since 1950.

Learn how we made it

---

shopping_cartBuy a hard copy

## FAQ

How were the Jina embedding models trained?

For detailed information on our training processes, data sources, and evaluations, refer to the technical reports on arXiv. The`jina-embeddings-v5` text models are trained in two stages: embedding distillation from a larger teacher model, followed by task-specific LoRA adapter training on frozen backbone weights. The`v5-omni` multimodal variants add a third stage that trains only cross-modal projectors, leaving the text backbone and adapters frozen.

What are your multimodal embedding models?

`jina-embeddings-v5-omni-small`(~1.74B parameters, 1024 dimensions, 32K context) and`jina-embeddings-v5-omni-nano`(~1.04B parameters, 768 dimensions, 8K context) are our current multimodal models. They accept text, images, audio, video, and PDFs in one shared vector space, so you can index in one modality and query in another without reindexing. Their text-only output is identical to`jina-embeddings-v5-text-small` and`jina-embeddings-v5-text-nano` respectively, which means you can add multimodal input to an existing text index without re-embedding it.`jina-clip-v2`(865M parameters) remains available as a lighter text-and-image option.

Which languages do your models support?

All models released since 2024 are multilingual.`jina-embeddings-v5-text-small` and the`v5-omni` models are built on a Qwen3 backbone with broad multilingual coverage;`jina-embeddings-v5-text-nano` is built on EuroBERT-210M, covering 15 major European and global languages including English, French, German, Spanish, Chinese, Japanese, Arabic, and Hindi.`jina-embeddings-v3` and`jina-clip-v2` support 89 languages. For per-language benchmark numbers, see the MMTEB results in each model's technical report.

What is the maximum context length for a single input?

Context length varies by model:`jina-embeddings-v5-text-small` and`jina-embeddings-v5-omni-small` support up to 32,768 tokens, while`jina-embeddings-v5-text-nano` and`jina-embeddings-v5-omni-nano` support 8,192 tokens.`jina-embeddings-v4` and the`jina-code-embeddings` models support 32,768 tokens;`jina-embeddings-v3`,`jina-clip-v2`, and`jina-colbert-v2` support 8,192 tokens. Inputs above the limit return an error unless you set`truncate: true`.

What is the maximum number of inputs I can include in a single request?

There is no hard limit on the number of items per request. The API batches inputs internally by token count for optimal GPU utilization, so you can send as many texts or images as needed in a single request. PDFs are the exception: send one PDF per request.

How do I send images, audio, video, or PDFs to the multimodal models?

Pass a typed object in the`input` array using an`image`,`audio`,`video`, or`pdf` key, whose value is either a public URL or base64-encoded bytes. The model routes each modality to the appropriate encoder, and you can mix modalities freely within a single batch. Supported audio formats include WAV, MP3, FLAC, OGG, M4A, and Opus; video is processed as 32 uniformly sampled frames. PDFs must be sent one per request.

How do Jina embeddings compare to the latest OpenAI, Cohere, and Voyage models?

`jina-embeddings-v5-text-small`(677M parameters) is the strongest model under 1B parameters on MMTEB, scoring 67.0 average at task level, and reaches 71.7 average on English MTEB.`jina-embeddings-v5-text-nano`(239M parameters) scores 65.5 on MMTEB, ahead of every model we evaluated under 500M parameters. Our design target is capability per parameter rather than raw size, so these models are cheaper to serve than most alternatives at comparable or better retrieval quality. All v5 models support Matryoshka Representation Learning, so you can truncate dimensions down to 32 without retraining.

How seamless is the transition from OpenAI's text-embedding-3-large to your solution?

The transition is straightforward: our API endpoint matches the input and output JSON schemas of OpenAI's`text-embedding-3-large`, so in most codebases you change the base URL, the API key, and the model name. The same holds for the Jina On-Prem containers, which additionally expose Elastic Inference Service (EIS), Cohere, Voyage AI, and Gemini schemas, so Jina models are a drop-in replacement in existing code paths. Note that embeddings from different model families are not comparable, so you have to re-embed your corpus rather than mix vectors from two providers in one index. For the On-Prem containers themselves, contact Elastic Sales.

How are tokens calculated for images and other non-text inputs?

Text is counted in the standard way. Non-text inputs are converted to tokens by the relevant encoder, and the cost depends heavily on which model you use, so measure with your own inputs rather than assuming. As a reference point, a 600x600 pixel image costs approximately: •`jina-embeddings-v5-omni-small`: ~363 tokens •`jina-embeddings-v5-omni-nano`: ~362 tokens •`jina-embeddings-v4`: ~4,840 tokens •`jina-clip-v2`: ~16,000 tokens The v5-omni models are one to two orders of magnitude cheaper per image than the older models. Every response includes a`usage` object with the exact token count for that request, including an`image_tokens` breakdown for multimodal inputs, so you can verify cost per call.

Do you provide models for embedding images, audio, or video?

Yes.`jina-embeddings-v5-omni-small` and`jina-embeddings-v5-omni-nano` embed text, images, audio, video, and PDFs into a single shared vector space.`jina-embeddings-v4` and`jina-clip-v2` handle text and images.

Can Jina embedding models be fine-tuned on private or company data?

There are two paths. The self-serve one is the Fine-tuning API, which generates synthetic training data from a description of your domain and returns a fine-tuned model, without your having to assemble a labelled dataset. For fine-tuning on proprietary data under a commercial agreement, on dedicated infrastructure, or on a model that is not in the base model selector, Contact Elastic Sales; that work is scoped and contracted through Elastic.

Can the models be hosted privately, on my own infrastructure or in my own cloud account?

Yes, in two ways. Jina models are available on the AWS, Azure, and GCP marketplaces, so you can deploy them inside your own cloud account. For self-managed, on-premises, or air-gapped infrastructure, Elastic sells a commercial license called Jina On-Prem, available since August 10, 2026, which ships the models as fully offline Docker containers with no external calls and no license server. To get a quote for either path, contact Elastic Sales.

What is the 'task' parameter and when should I use it?

The`task` parameter selects a task-specific LoRA adapter for optimal performance. Use`retrieval.query` for search queries,`retrieval.passage` for documents being searched,`text-matching` for symmetric similarity such as duplicate or paraphrase detection,`classification` for categorization, and`separation` for clustering. Retrieval is asymmetric, so using the wrong side of the query/passage pair measurably degrades results. The parameter is supported by`jina-embeddings-v5`,`jina-embeddings-v4`, and`jina-embeddings-v3`.

What is late-interaction retrieval and which models support it?

Late interaction keeps token-level vectors instead of collapsing a document into one vector, which preserves fine-grained detail at the cost of a larger index.`jina-embeddings-v4` supports both dense (single-vector) and late-interaction (multi-vector) output via the`output_type` parameter, and`jina-colbert-v2` is a dedicated late-interaction model. For most retrieval pipelines, a dense`v5` model followed by a reranker is the better accuracy-per-cost tradeoff.

What is late chunking and when should I use it?

Late chunking embeds the whole document first with a long-context model, then derives chunk embeddings from the token-level representations. Unlike naive chunking, which embeds each chunk in isolation, late chunking preserves cross-chunk context, which improves retrieval quality in RAG pipelines where a chunk refers to something defined earlier in the document. Enable it with the`late_chunking` parameter.

Why does the API enforce a different context length than the model supports?

Some models are architecturally capable of longer context than the hosted API accepts. Very long sequences consume substantial GPU memory, and we tune the serving configuration to balance throughput, latency, and cost for the majority of use cases. If you need the full architectural context length, run the model yourself: contact Elastic Sales about a self-managed deployment.

Why is jina-embeddings-v4 free, and why is it slow?

`jina-embeddings-v4` is built on the Qwen2-VL base model, released under the Qwen Research License, which permits research and non-commercial use only. We therefore cannot license it commercially and provide it free of charge via the API instead. It is also a 3.8B parameter model, so it is inherently slower per request, and we throttle its throughput to manage infrastructure costs. It is not suitable for production workloads, and for the same reason it is not offered through the Elastic Inference Service or as part of Jina On-Prem. For production use, take the`jina-embeddings-v5` family: it is faster, stronger on retrieval benchmarks, and can be licensed for commercial use through Elastic Sales.

What are the rate limits for the Embeddings API?

Rate limits depend on your API key type:Free: 100 RPM, 100K TPMPaid: 500 RPM, 2M TPMPremium: 5,000 RPM, 50M TPMThere is an additional IP-based limit of 10,000 requests per 60 seconds to prevent abuse. Limits are applied per key and counted over a 60-second window, so bursts are smoothed rather than queued; a request over the limit returns HTTP 429 and should be retried with exponential backoff. If you need limits beyond the Premium tier, or dedicated capacity with no shared-tenant limit at all, contact Elastic Sales.

Which embedding model should I choose?

Start with`jina-embeddings-v5-text-small` for text retrieval: it is the strongest sub-1B model we ship and handles 32K context. Drop to`jina-embeddings-v5-text-nano` when latency, cost, or edge hardware matters more than the last point of accuracy. Use`jina-embeddings-v5-omni-small` or`v5-omni-nano` when images, audio, video, or PDFs are involved; their text output is identical to the corresponding text model, so you can add modalities to an existing index without re-embedding. Use`jina-code-embeddings-0.5b` or`1.5b` for source code. Within a family, newer is better.

What are the file size limits for images and PDFs?

Maximum file sizes are 5 MB for images and 8 MB for PDFs. Larger files are rejected with an error.

### How to get my API key?

video_not_supported

### What's the rate limit?

Rate Limit

Rate limits are tracked in three ways: RPM (requests per minute), and TPM (tokens per minute). Limits are enforced per IP/API key and will be triggered when either the RPM or TPM threshold is reached first. When you provide an API key in the request header, we track rate limits by key rather than IP address.

Columns

| | Product | API Endpoint | Description arrow_upward | w/o API Key key_off | w/ Free API Key key | w/ Paid API Key key | w/ Premium API Key key | Average Latency | Token Usage Counting | Allowed Request |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| | Reader API | `https://r.jina.ai` | Convert URL to LLM-friendly text | 20 RPM | 500 RPM | 500 RPM | trending_up 5000 RPM | 7.9s | Count the number of tokens in the output response. | GET/POST |
| | Reader API | `https://s.jina.ai` | Search the web and convert results to LLM-friendly text | block | 100 RPM | 100 RPM | trending_up 1000 RPM | 2.5s | Every request costs a fixed number of tokens, starting from 10000 tokens | GET/POST |
| | Embedding API | `https://api.jina.ai/v1/embeddings` | Convert text/images to fixed-length vectors | block | 100 RPM & 100,000 TPM | 500 RPM & 2,000,000 TPM | trending_up 5,000 RPM & 50,000,000 TPM | ssid_chart depends on the input size help | Count the number of tokens in the input request. | POST |
| | Reranker API | `https://api.jina.ai/v1/rerank` | Rank documents by query | block | 100 RPM & 100,000 TPM | 500 RPM & 2,000,000 TPM | trending_up 5,000 RPM & 50,000,000 TPM | ssid_chart depends on the input size help | Count the number of tokens in the input request. | POST |

### Do I need a commercial license?

CC BY-NC License Self-Check

---

Are you using our hosted API, or our official images on Azure, AWS, or GCP?

Yes

No separate license needed. Commercial use is covered by the service terms: sign up and pay through this site or the cloud marketplace.

No

Are you running the model weights yourself, in a commercial product or service?

No

Nothing to buy. Downloading, evaluating, benchmarking and research use are permitted under every license we publish under, with attribution.

Yes

Which license does the model carry? It is stated on the model's page on Hugging Face.

Apache-2.0

Apache-2.0 permits commercial use. Nothing to buy. This covers our legacy v1 and v2 generation models.

CC BY-NC 4.0

You need a commercial license. Since August 10, 2026, Elastic sells one for Jina models as its own SKU, called Jina On-Prem. It covers self-managed, on-premises, and air-gapped deployments, and it does not require an Elasticsearch subscription.

If you are already an Elastic customer, your account team can add it to your existing agreement.

Qwen Research License

A research license does not permit commercial use, and a commercial license for our other models does not extend to it. There is no commercial option for this one, self-hosted or through the API. Pick a model under one of the other two licenses instead.

API-related common questions

Can I use the same API key across all Jina APIs?

Yes. One API key is valid for all Jina AI search foundation products, including the Reader, Embeddings, Reranker, Classifier, and Segmenter APIs, with tokens shared across all of them.

Can I monitor the token usage of my API key?

Yes, token usage can be monitored in the 'API Key & Billing' tab by entering your API key, allowing you to view the recent usage history and remaining tokens. If you have logged in to the API dashboard, these details can also be viewed in the 'Manage API Key' tab.

What should I do if I forget my API key?

If you have misplaced a topped-up key and wish to retrieve it, please contact support AT jina.ai with your registered email for assistance. It's recommended to log in to keep your API key securely stored and easily accessible.

Do API keys expire?

No, our API keys do not have an expiration date. If a key is compromised, revoke it yourself in the API Key Management dashboard, which takes effect immediately; issue a replacement key first if you want to avoid downtime. Any remaining token balance stays on your account rather than on the revoked key. If you cannot access the dashboard, or believe the account itself is compromised, raise it with https://support.elastic.co/ Elastic Support.

Can I transfer tokens between API keys?

Yes, you can transfer tokens from a premium key to another. After logging into your account on the API Key Management dashboard, use the settings of the key you want to transfer out to move all remaining paid tokens.

Can I revoke my API key?

Yes, you can revoke your API key if you believe it has been compromised. Revoking a key will immediately disable it for all users who have stored it, and all remaining balance and associated properties will be permanently unusable. If the key is a premium key, you have the option to transfer the remaining paid balance to another key before revocation. Notice that this action cannot be undone. To revoke a key, go to the key settings in the API Key Management dashboard.

Why is the first request for some models slow?

This is because our serverless architecture offloads certain models during periods of low usage. The initial request activates or 'warms up' the model, which may take a few seconds. After this initial activation, subsequent requests process much more quickly.

Is my API data used to train your models?

No. We never use your API requests, inputs, or outputs to train our embedding, reranker, or any other models. Your data remains yours.

What are the rate limits for Jina APIs?

Rate limits apply per API key:Free: 100 RPM, 100K TPMPaid: 500 RPM, 2M TPMPremium: 5,000 RPM, 50M TPMThere is also an IP-based limit of 10,000 requests per 60 seconds. Limits vary by endpoint; see the rate limit table above for per-endpoint figures.

Are there batch size limits for the APIs?

There is no batch size limit for either the Embeddings or Reranker APIs. You can send as many items or documents as needed per request. Both APIs batch inputs internally by token count for optimal GPU utilization.

Are the Jina APIs the same thing as Jina models inside Elastic?

No, they are three separate paths. The Jina APIs on this site are self-serve and pay-as-you-go with a Jina API key. The Elastic Inference Service (EIS) runs Jina models inside Elastic Cloud, billed through your Elastic subscription, with no infrastructure for you to manage. Jina On-Prem is a commercial license, sold by Elastic as its own SKU since August 10, 2026, for running the models in your own self-managed, on-premises, or air-gapped infrastructure. For the EIS and On-Prem paths, contact Elastic Sales.

Billing-related common questions

Is billing based on the number of sentences or requests?

Our pricing model is based on the total number of tokens processed, allowing users the flexibility to allocate these tokens across any number of sentences, offering a cost-effective solution for diverse text analysis requirements.

Is there a free trial available for new users?

Yes. New users get an auto-generated API key with free tokens usable across any of our models. Once the free tokens are consumed, you can purchase additional tokens for the key in the 'Buy tokens' tab.

Are tokens charged for failed requests?

No, tokens are not deducted for failed requests.

What payment methods are accepted?

Payments are processed through Stripe, supporting a variety of payment methods including credit cards, Google Pay, and PayPal for your convenience.

Is invoicing available for token purchases?

For self-serve token purchases, Stripe issues an invoice to the email address associated with your Stripe account at the time of purchase. If you need a formal purchase order, a negotiated contract, procurement paperwork, or consolidated billing, that runs through Elastic rather than Stripe: contact Elastic Sales.

How do I buy a commercial license rather than API tokens?

Token purchases on this site cover use of the hosted Jina APIs. They do not license you to run the model weights in your own infrastructure. For that, Elastic has sold a commercial license as its own SKU since August 10, 2026, priced annually rather than per token. Contact Elastic Sales for a quote.

Can I pay by invoice or purchase order instead of card?

Self-serve token purchases are processed through Stripe and invoiced automatically to your Stripe account email. For purchase orders, procurement processes, or volumes above what self-serve top-up supports, contact Elastic Sales.

I paid, but my balance or rate limit has not changed. What should I check?

Balance and rate limits belong to an API key, not to the account, so the first thing to check is the key itself rather than the account page: enter it in the API Key & Billing tab and confirm the balance and tier there. If the account holds more than one key, the tokens are on the key that was topped up, which may not be the key your application is sending. A new tier can also take a short time to propagate after payment. If the key shows the balance but is still limited at the previous tier after that, contact support.

How do I cancel, stop auto top-up, or remove a saved payment method?

Self-serve billing is managed from the customer portal reachable via the API Key & Billing tab, where auto top-up can be switched off and saved payment methods removed. Turning off auto top-up stops future charges but leaves any balance already purchased usable. If you also want the account and its data removed, or a refund considered, send that request to support; account deletion is handled manually and takes a few business days, and you will get written confirmation once it is done.