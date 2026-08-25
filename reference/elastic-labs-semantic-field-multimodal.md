---
title: "Semantic field multimodal search (Elasticsearch Labs)"
source: https://www.elastic.co/search-labs/blog/semantic-field-multimodal-search-elasticsearch
downloaded: 2026-08-25
note: Offline snapshot for local planning. Prefer the live URL for the latest version.
---

Semantic field: one field for multimodal search in Elasticsearch | Elasticsearch Labs- - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - Skip to main content

The Forrester Wave™: XDR Platforms, Q2 2026

Access reportAbout usPartnersSupport|LoginElastic logoSearchStart free trialContact salesBlog
# One field, every modality: how Elasticsearch's semantic field indexes and searches images, audio, video and PDFs automatically

The semantic field turns images, audio, video, PDFs and text into multimodal embeddings at ingest time. Describe a scene and find the matching image or use a video frame to surface related clips, all from one Elasticsearch field.

August 03, 2026

Mike PellegriniVector DatabaseIndex DataJina AIMappingsJump toShareTry out vector search for yourself using this self-paced hands-on learning for Search AI. You can start a free cloud trial or try Elastic on your local machine now.

Multimodal search in Elasticsearch now works the same way text search does: define a field, index your content, and query. The semantic field generates embeddings automatically at ingest time for images, audio, video, and PDFs. Every modality lands in one shared vector space, so you can retrieve an image with a text description, match audio to a phrase, or find a video with a still frame, all from a single field. Available in Elasticsearch 9.5 and serverless as a tech preview.

Tech preview features are subject to change and are not covered by the support SLA of general availability features.

## The palette takes shape: how multimodal search in Elasticsearch evolved from semantic_text

The semantic field is a convergence of several complementary features we&#x27;ve introduced over the past couple of years, bringing them together to create a cohesive multimodal search experience. Each solved an important piece of the semantic search puzzle on its own; together they enable native multimodal search.

The first brushstroke was semantic_text. Before it, running semantic search meant manually configuring mappings, wiring up ingest pipelines with an ML model, manually chunking content, and generating query-time embeddings yourself. The semantic_text field folds all of that away: it performs inference automatically at ingest time, chunks long documents for you, and simplifies the queries you write against it. Introduced in Elasticsearch 8.15 and released as GA in Elasticsearch 8.18, it has become the foundation for semantic search on the platform.

Next came the model to power multimodal search. jina-embeddings-v5-omni is our family of multimodal embedding models, capable of embedding text, images, video, audio, and PDFs into a shared vector space. Because those embeddings are semantically compatible across modalities, you can store diverse media in a single index and query across all of it at once, such as retrieving an image via a text description or matching audio against a written phrase, all without maintaining a separate pipeline for each content type. For more detailed information about how these embeddings are generated, see the model documentation.

We added the embedding query vector builder in Elasticsearch 9.4 to handle multimodal inputs at query time. Query vector builders are general-purpose tools you can use to convert input to a vector at query time as part of your request. For example, we have the text_embedding query vector builder for text-only models and input, and the lookup query vector builder for getting a vector from an existing document. The embedding query vector builder is a new type that works with multimodal models and accepts multimodal input, including text or base64-encoded binaries. This allows you to pose a query in whatever modality fits, and Elasticsearch generates the matching vector on the fly.

The final piece was multimodal ingest. The semantic_text field brought automatic embedding to text; the semantic field extends that same automatic experience to images, audio, video, and PDFs from ingest through query.

## Painting the picture: creating an index with the semantic field

Let’s create an index with a semantic field. This is as simple as setting the field type to semantic and defining the inference endpoint you want to use:

```
PUT example-index
{
  "mappings": {
    "properties": {
      "my_semantic_field": {
        "type": "semantic",
        "inference_id": ".jina-embeddings-v5-omni-small"
      }
    }
  }
}
```
In this example, we use the .jina-embeddings-v5-omni-small inference endpoint. This is our built-in jina-embeddings-v5-omni inference service, and it is available in all environments with access to the Elastic Inference Service (EIS). This includes:

- Serverless.

- Elastic Cloud Hosted (ECH).

- Self-managed with Cloud Connected Mode (CCM).

semantic fields require an inference endpoint that uses the embedding task type, which is used for multimodal models. The semantic field does not replace semantic_text. Semantic_text should continue to be used:

- For text-only values.

- When using text_embedding or sparse_embedding task type.

See the documentation for more information about when you should use semantic over semantic_text.

### Indexing images, audio, video and PDFs

To index an image, provide an object with a type of image and a value containing the image as a base64-encoded data URL:

```
PUT example-index/_doc/example_doc_1
{
  "my_semantic_field": {
    "type": "image",
    "value": "data:image/jpeg;base64,<base64-encoded-image-bytes>"
  }
}
```
Arrays of objects are also accepted, allowing you to index multiple images in a single field value:

```
PUT example-index/_doc/example_doc_2
{
  "my_semantic_field": [
    {
      "type": "image",
      "value": "data:image/jpeg;base64,<base64-encoded-image-bytes>"
    },
    {
      "type": "image",
      "value": "data:image/jpeg;base64,<base64-encoded-image-bytes>"
    }
  ]
}
```
The semantic field also supports text values, just like semantic_text. You can provide such values standalone or intermix them with image values:

```
PUT example-index/_doc/example_doc_3
{
  "my_semantic_field": "a cat on a windowsill"                                                                                                                                                                                                                }

PUT example-index/_doc/example_doc_4
{
  "my_semantic_field": [
    "a cat on a windowsill",
    {
      "type": "image",
      "value": "data:image/jpeg;base64,<base64-encoded-image-bytes>"
    },
    "a dog running in a park"
  ]
}
```
Text values are handled just like they are with semantic_text: long passages are chunked according to the chunking settings configured on either the inference service or field mapping. Multimodal values, such as images, are not chunked. Each multimodal value is represented as one chunk.

Other modalities are supported as well. Change the type value to match your content’s modality. Currently we support:

- image

- audio

- video

- pdf

For example, to index a video, the request would look like:

```
PUT example-index/_doc/example_doc_5
{
  "my_semantic_field": {
    "type": "video",
    "value": "data:video/mp4;base64,<base64-encoded-video-bytes>"
  }
}
```
The modalities supported vary by model. The jina-embeddings-v5-omni model supports all modalities listed above. Consult the documentation for your model to determine which modalities it supports.

### Image search and cross-modal retrieval with a text query

To find multimodal content using a text description, run a match query on the semantic field:

```
GET example-index/_search
{
  "query": {
    "match": {
      "my_semantic_field": "a cat on a windowsill"
    }
  }
}
```
Just like with semantic_text, Elasticsearch automatically generates an embedding for the query text using the inference endpoint associated with the field. That query embedding is used to return semantically similar matches.

This query pattern enables easy text-to-image search. Just index an image and use a match query to retrieve it via text description! It also works for any other modality: index the multimodal input and search by description to retrieve it.

### Querying with images, video, and other multimodal inputs

We can also search using a multimodal input by using the knn query with an embedding query vector builder. For example, we can search using an image:

```
GET example-index/_search
{
  "query": {
    "knn": {
      "field": "my_semantic_field",
      "query_vector_builder": {
        "embedding": {
          "input": {
            "type": "image",
            "value": "data:image/jpeg;base64,<base64-encoded-image-bytes>"
          }
        }
      }
    }
  }
}
```
The input object format is the same as when providing an image to index: set the type to image and value to a base64-encoded data URL.

Similar to when querying by text description, Elasticsearch automatically generates an embedding for the query image using the inference endpoint associated with the field. That query embedding is used to return semantically similar matches.

Just like with indexing, other modalities are supported, but are limited to those supported by your inference endpoint. For example, a search using a video clip would look like:

```
GET example-index/_search
{
  "query": {
    "knn": {
      "field": "my_semantic_field",
      "query_vector_builder": {
        "embedding": {
          "input": {
            "type": "video",
            "value": "data:video/mp4;base64,<base64-encoded-video-bytes>"
          }
        }
      }
    }
  }
}
```

## Extending the composition: highlighting, retrievers, and other semantic field features

The semantic field didn&#x27;t start from a blank canvas. It&#x27;s built on the same foundation as semantic_text, inheriting its behavior and its ergonomics, and extending them to multimodal content. In practice, that means nearly everything you already know about working with semantic_text carries over unchanged. If you&#x27;ve built with semantic_text before, the semantic field will feel immediately familiar.

Here’s a selection of the features that come along for the ride. See the documentation for a complete list.

### Highlighting the best-matching chunks

If you index multiple values in a semantic field, you may want to know which value best matches the query. The semantic highlighter can be used to return the most relevant chunks as highlight fragments:

```
GET example-index/_search
{
  "query": {
    "match": {
      "my_semantic_field": "a cat on a windowsill"
    }
  },
  "highlight": {
    "fields": {
      "my_semantic_field": {
        "number_of_fragments": 2,
        "order": "score"
      }
    }
  }
}
```
Setting order to score returns the fragments ranked by relevance, while number_of_fragments caps how many chunks come back. The response looks like:

```
{
  "hits": {
    "hits": [
      {
        "_index": "example-index",
        "_id": "example_doc_4",
        "_source": {...},
        "highlight": {
          "my_semantic_field": [
            "a cat on a windowsill",
            "data:image/jpeg;base64,<base64-encoded-image-bytes>"
          ]
        }
      }
    ]
  }
}
```
Note how highlighted multimodal values are represented using their data URLs.

### Controlling vector quantisation with index options

The semantic field stores its embeddings in an underlying vector field, and index_options lets you control how that vector field is indexed. For example, choosing a non-default quantization strategy:

```
PUT example-index
{
  "mappings": {
    "properties": {
      "my_semantic_field": {
        "type": "semantic",
        "inference_id": ".jina-embeddings-v5-omni-small",
        "index_options": {
          "dense_vector": {
            "type": "int8_hnsw"
          }
        }
      }
    }
  }
}
```

### Multi-field retrievers

The semantic field participates in the multi-field query format supported by the linear and rrf retrievers. Rather than hand-writing an inner retriever per field, you supply a single query and a list of fields, mixing lexical fields and semantic fields freely:

```
GET example-index/_search
{
  "retriever": {
    "linear": {
      "query": "a cat on a windowsill",
      "fields": ["title", "my_semantic_field"],
      "normalizer": "minmax"
    }
  }
}
```
The retriever automatically separates lexical fields from semantic fields, queries each group, and normalizes the results so that each group contributes equally to the final ranking, preventing lexical matches from drowning out semantic ones.

### Cross-cluster search

The semantic field supports cross-cluster search (CCS), enabling use of the field in large, multi-cluster deployments. Simply list the indices to query using the standard <cluster>:<index> format:

```
GET example-index,remote-cluster:remote-index/_search
{
  "query": {
    "match": {
      "my_semantic_field": "a cat on a windowsill"
    }
  }
}
```
The fields queried across indices and clusters can use a mix of different inference endpoints that produce different query embeddings. The search request will automatically apply the proper query embedding to each individual field queried.

## Off the easel, into the world: optimising multimodal embeddings for production

When you move multimodal search from experiment to production, the size of your multimodal inputs becomes a practical concern. Multimodal data is supplied as base64-encoded data URLs, and that data is stored in the index. Those strings can grow large in a hurry: a single high-resolution file can balloon into several megabytes of encoded text, which has several side effects:

- The index size on disk can increase significantly.

- Requests and responses containing multimodal data are larger, increasing transmission time and ingress/egress costs.

- Inference on larger multimodal inputs is slower.

The good news is that you don’t need that much fidelity. Multimodal embedding models reduce each input to a compact representation before generating a vector anyway, so a smaller, lower-fidelity version of a multimodal input (such as a downscaled image or a lower-bitrate audio clip) produces a very similar embedding, and similar search quality, to its full-size original. This also applies to PDF input. PDFs are generally processed visually by multimodal models, so the quality only needs to be good enough to perform operations like image embedding and OCR. Long PDFs should be broken up into chunks of smaller inputs, so the embeddings generated more accurately represent each chunk. Feeding the model small inputs keeps your documents lean, trims index and response sizes, and speeds up ingestion, all without meaningfully affecting relevance. 

Elasticsearch reinforces this practice with a guardrail: the indices.inference.max_binary_input_size cluster setting caps the size of each binary input, defaulting to 1 MB. Any individual value that exceeds the limit is rejected with a clear error, so oversized inputs surface as an actionable problem at index time rather than as silent bloat. This setting is adjustable in self-hosted and ECH through the cluster settings API. It is not adjustable in our serverless offering, where 1 MB is the hard limit for binary sizes.

When possible, it is also advised to use source filtering to exclude semantic fields from responses. For example:

```
GET example-index/_search
{ 
  "_source": {
    "excludes": ["my_semantic_field"]
  },
  "query": {
    "match": {
      "my_semantic_field": "a cat on a windowsill"
    }
  }
}
```
This makes responses smaller, more performant, and easier to parse because multimodal data is not returned with each.

## Try out the semantic field

The semantic field is available in Elasticsearch 9.5 and Serverless. Start a free trial and try it out today.

### Related Content

Vector Database
### One setting for production vector search: How vectordb_document mode tunes Elasticsearch automatically

August 20, 2026|Mayya Sharipova|+2Inside ElasticVector Database
### How Elasticsearch's batched query phase improves search performance at scale

August 10, 2026|Ben Chaplin|+1AutoOpsVector DatabaseOperations
### The mystery stress your heap chart can't see: AutoOps now watches vector off-heap memory

August 06, 2026|Valentin CrettazVector DatabaseML ResearchElastic Cloud Serverless
### 17% faster search, zero config: auto-calibrating vector quantization in Elasticsearch

July 28, 2026|Tommaso Teofili|+1Vector DatabaseML Research
### How Elasticsearch auto-tunes vector quantization to hit your recall target

July 21, 2026|Thomas Veasey|+1
### Ready to build state of the art search experiences?

Sufficiently advanced search isn’t achieved with the efforts of one. Elasticsearch is powered by data scientists, ML ops, engineers, and many more who are just as passionate about search as you are. Let’s connect and work together to build the magical search experience that will get you the results you want.

Try it yourselfSubscribe to newsletterFollow us- - - - - - About usAbout ElasticLeadershipBlogNewsroom- Join usCareersCareer portalHow we hire- PartnersFind a partnerPartner loginRequest accessBecome a partner- Trust & SecurityLegalTrust centerPrivacy at ElasticTrade ComplianceEthics & Compliance- Investor relationsInvestor resourcesGovernanceFinancialsStock- Excellence AwardsPrevious winnersElastic{ON} TourBecome a sponsorAll eventsAbout us - About Elastic- Leadership- Blog- NewsroomJoin us - Careers- Career portal- How we hirePartners - Find a partner- Partner login- Request access- Become a partnerTrust & Security - Legal- Trust center- Privacy at Elastic- Trade Compliance- Ethics & ComplianceInvestor relations - Investor resources- Governance- Financials- StockExcellence Awards - Previous winners- Elastic{ON} Tour- Become a sponsor- All events- Trademarks- Terms of Use- Privacy Statement- Sitemap© . elasticsearch B.V. All Rights Reserved

This website and all associated content, software, discussion forums, products, and services are intended for professional use only. No consumer use of this website or its content is intended or directed.

Elastic, Elasticsearch, and other related marks are trademarks, logos, or registered trademarks of elasticsearch B.V. in the United States and other countries.

Apache, Apache Lucene, Apache Hadoop, Hadoop, HDFS and the yellow elephant logo are trademarks of the Apache Software Foundation in the United States and/or other countries. All other brand names, product names, or trademarks belong to their respective owners.

Notice at Collection |  Your Privacy Choices
