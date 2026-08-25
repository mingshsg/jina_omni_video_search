---
title: "One index, all media: Introducing jina-embeddings-v5-omni (Elasticsearch Labs)"
source: https://www.elastic.co/search-labs/blog/jina-embeddings-v5-omni-all-media-one-index
downloaded: 2026-08-25
note: Offline snapshot for local planning. Prefer the live URL for the latest version.
---

jina-embeddings-v5-omni for text, images, video, and audio | Elasticsearch Labs

Skip to main content

# One index, all media: Introducing jina-embeddings-v5-omni

jina-embeddings-v5-omni lets you embed text, images, video, and audio into a single Elasticsearch index and query across all of them at once.

May 11, 2026

Jump to

Share

Get hands-on with Elasticsearch: Dive into our sample notebooks in the Elasticsearch Labs repo, start a free cloud trial, or try Elastic on your local machine now.

`jina-embeddings-v5-omni` brings text, images, video, and audio into a single Elasticsearch index. Extending the best-in-class jina-embeddings-v5-text models, the v5-omni suite adds visual and audio encoding through an innovative architecture that leaves the text backbone identical, providing frontier-class performance in one very compact embedding model.

You can now create high-performance semantic embeddings for text, images, videos, and audio recordings, spanning nearly 100 languages, and use them for classification, clustering, semantic similarity measurement, and indexing for retrieval. If your data lives in PDFs, recordings, and video alongside text, you no longer need separate pipelines for each.

The`jina-embeddings-v5-omni` family is the most compact embedding model currently on the market with support for pictures, speech, print, and video. It offers:

`jina-embeddings-v5-text`’’s frontier-class text embeddings for retrieval, analysis, and AI agent applications.

Best-in-size-class embeddings for visual semantic similarity, visual understanding, and image retrieval.`jina-embeddings-v5-omni-small` has the best performance on image benchmarks of any model in the 1 billion (10⁹) parameters and is superior to our own previous jina-clip-v2. Only a few models with three to 30 times as many parameters can beat it.

State-of-the-art embeddings for multilingual visual understanding and retrieval, beating models as much as 20 times larger.

Best-in-size-class audio embeddings, with only models that have double or more the number of parameters performing better on standard benchmarks.

Support for video, especially for locating objects and events in footage.

This has applications in all areas of information retrieval, document processing, and data analysis.`jina-embeddings-v5-omni` opens up access to information locked up in different media silos and makes it accessible for retrieval, analysis, and use by AI agents. Information in audio and video recordings, PDF, printed page scans, and infographics are on an equal footing with digitized texts in your data ecosystem.

Just like`jina-embeddings-v5-text`, these models come in two sizes:`small` and`nano`. Both models extend their corresponding text equivalent with additional modules supporting audio and visual input. Users can select modules at load time. In addition, task-specific extensions for semantic similarity, classification, clustering, and information retrieval are implemented as compact low-rank adapters (LoRAs) and are all loaded, so users can select them at inference time.

Both models are very compact.`jina-embeddings-v5-omni-small` can run on conventional GPU-equipped servers, and`jina-embeddings-v5-omni-nano` is small enough to run on commodity hardware. This represents a large potential savings in compute costs and makes possible licensed local installation and edge processing, reducing latency and increasing your control of your own data.

The v5-omni suite uses innovative model design and machine learning techniques to compose new embedding models from previously trained ones without having to retrain them. We use encoders from pretrained, language-aligned, embedding models for audio and video media as input preprocessors for our existing`jina-embeddings-v5-text` model suite. The resulting models generate embeddings for images and sound recordings that are semantically compatible with the embeddings it generates for texts.

The v5-omni models produce text embeddings that are identical to`jina-embeddings-v5-text`(that is,`jina-embeddings-v5-omni-small` with`jina-embeddings-v5-text-small`; and`jina-embeddings-v5-omni-nano` with`jina-embeddings-v5-text-nano`) so you can extend existing text retrieval repositories to multimedia applications without rebuilding your indices.

The integrated encoders are all derived from open-weight sources. For images and video, we’ve used encoders from Qwen3.5 models:

For`jina-embeddings-v5-omni-nano`, the fine-tuned SigLIP2 Base encoder from Qwen3.5-0.8B.

For`jina-embeddings-v5-omni-small`, the fine-tuned SigLIP2 So400m encoder from Qwen3.5-2B.

For audio support, we’ve added the encoder from Whisper-large-v3, extracted from Qwen2.5-Omni-7B, to both the small and nano versions.

We’ve connected these media-specific encoders to the text-processing backbone with trained cross-modal projectors. These projectors translate their native outputs to input embeddings compatible with`jina-embeddings-v5-text`. The only newly trained parts of the`jina-embeddings-v5-omni` models are the weights in those projectors.

A schematic of the`jina-embeddings-v5-omni` models. Only the cross-media projectors have new training.

This architecture means we only need to train the cross-model projectors, roughly 5.5 million parameters for`jina-embeddings-v5-omni-small` and under 3.5 million for`jina-embeddings-v5-omni-nano`, for each of the four LoRA adapters. This approach minimizes the additional training needed to connect different embedding models, leveraging the specialized training of each to produce an extremely compact, high-performance, modular embedding suite.

## Selected model properties

### Input/output

| Model name | Input contextwindow size | Embedding size |
| --- | --- | --- |
| jina-embeddings-v5-omni-small | 32,768 tokens* | 1024 dims(minimum: 32) |
| jina-embeddings-v5-omni-nano | 8,192 tokens* | 768 dims(minimum: 32) |

* See Using jina-embeddings-v5-omni below for more on how non-text media is tokenized.

### Size

| Model name | Total size |
| --- | --- |
| jina-embeddings-v5-omni-small(text-only base model + 4 LoRA adapters) | 700M params |
| image/video support(SigLIP2 So400m encoder extracted from Qwen3.5-2B) | 1.006B params |
| audio support(Whisper-large-v3 encoder extracted from Qwen2.5-Omni-7B) | 1.354B params |
| both | 1.660B params |
| LoRA adapters (each) | 20M |
| jina-embeddings-v5-omni-nano(text-only base model + 4 LoRA adapters) | 266M params |
| image/video support(SigLIP2 Base encoder extracted from Qwen3.5-0.8B) | 354M params |
| audio support(Whisper-large-v3 encoder extracted from Qwen2.5-Omni-7B) | 916M params |
| both | 1.004B params |
| LoRA adapters (each) | 7M |

* See Using jina-embeddings-v5-omni below for more on how non-text media is tokenized.

## Task-specific training

The`jina-embeddings-v5-omni` family supports the same task-specific LoRA adapters as`jina-embeddings-v5-text`:

| Task | Example uses |
| --- | --- |
| Retrieval | Information retrieval, by itself or in conjunction with other retrieval and candidate evaluation techniques. With the v5-omni models, you can retrieve audio, video, and images in one query from one index. |
| Clustering | Topic discovery and automatic topical organization across all media. |
| Classification | Categorization, sentiment analysis, and related kinds of tasks. |
| Semantic similarity | Data deduplication across media, recommender systems, related media, finding texts to match speech, identifying translations, and similar tasks. |

Output embeddings depend on the selected task category. For example, you shouldn’t use retrieval-oriented embeddings for clustering or semantic similarity embeddings for classification.

## Multimedia, multimodal, multilingual, multifunctional

To show what`jina-embeddings-v5-omni` can do, let’s take the famous opening passages of two novels and measure their semantic similarity:

A Tale of Two Cities (Charles Dickens)

```
It was the best of times, it was the worst of times, it was the
age of wisdom, it was the age of foolishness, 
it was the epoch of belief, it was the epoch of incredulity,
it was the season of Light, it was the season of Darkness,
it was the spring of hope, it was the winter of despair,
we had everything before us, we had nothing before us,
we were all going direct to Heaven, we were all going
direct the other way—in short, the period was so far like
the present period, that some of its noisiest authorities
insisted on its being received, for good or for evil, in 
the superlative degree of comparison only.
```

Pride and Prejudice (Jane Austen)

```
It is a truth universally acknowledged, that a 
single man in possession of a good fortune must
be in want of a wife. However little known the
feelings or views of such a man may be on his first
entering a neighbourhood, this truth is so well
fixed in the minds of the surrounding families,
that he is considered as the rightful property of
some one or other of their daughters.
```

Using`jina-embeddings-v5-omni-small`, with its semantic similarity adapter, these texts have a similarity of 0.5329.

That number doesn’t mean much without something to compare it with, so let’s compare these two texts to their French translations using the same model and adapter:

Semantic similarity scores for texts across languages

| | A Tale of Two Cities (English) | Pride and Prejudice (English) |
| --- | --- | --- |
| Tale of Two Cities (French)(Paris et Londres en 1783, tr. H. Loreau) | 0.9095 | 0.5074 |
| Pride and Prejudice (French)(Orgueil et Préjugés,tr. Leconte et Pressoir) | 0.4826 | 0.8784 |

The two texts show much greater similarity to their translations than to other texts in the same language or a different one. This reflects the very high performance multilingual semantic embeddings of`jina-embeddings-v5-text-small`, included unchanged in`jina-embeddings-v5-omni-small`.

Adding multimedia support to`jina-embeddings-v5-omni` means we can extend this experiment to whole other types of data. For example, we fetched scans of the first pages of both novels from old print editions:

Figure 2: A Tale of Two Cities, undated 19th-century edition, and Pride and Prejudice, 1903 Macmillan edition.

Let’s compare both texts to the scans, again using the semantic similarity adapter:

Semantic similarity scores between texts and images

| | A Tale of Two Cities (scan) | Pride and Prejudice (scan) |
| --- | --- | --- |
| Tale of Two Cities (text) | 0.7336 | 0.4891 |
| Pride and Prejudice (text) | 0.4804 | 0.7213 |

You see that semantic similarity scores strongly favor texts that match image contents.

We can also compare the texts to a screenshot of a social media post and a meme that reference those texts, using the same setup:

Figure 3: An Elon Musk tweet referencing A Tale of Two Cities, and a meme referencing the famous opening of Pride and Prejudice.

Semantic similarity scores between texts and images

| | A Tale of Two Cities | Pride and Prejudice |
| --- | --- | --- |
| Musk tweet (image) | 0.7156 | 0.4912 |
| Keep calm meme (image) | 0.4555 | 0.6244 |

We can do the same for speech. We obtained recordings of readings of both texts, in English and in French:

A Tale of Two Cities(English audio from Librivox).

A Tale of Two Cities(French audio generated by OmniVoice AI).

Pride and Prejudice(English audio from Librivox).

Pride and Prejudice(French audio generated by OmniVoice AI).

Semantic similarity scores between texts and audio across languages

| | A Tale of Two Cities (English audio) | A Tale of Two Cities (French audio) | Pride and Prejudice (English audio) | Pride and Prejudice (French audio) |
| --- | --- | --- | --- | --- |
| A Tale of Two Cities(English text) | 0.3816 | 0.3106 | 0.1607 | 0.1774 |
| A Tale of Two Cities(French text) | 0.3528 | 0.3253 | 0.1598 | 0.1721 |
| Pride and Prejudice(English text) | 0.1910 | 0.1682 | 0.3511 | 0.3398 |
| Pride and Prejudice(French text) | 0.1667 | 0.1474 | 0.3018 | 0.3702 |

This multilingual and multimedia ability extends to information retrieval.

The retrieval adapters for the`jina-embeddings-v5-omni` models implement asymmetric retrieval. This means they embed queries differently from the way they embed retrieval target documents, so cross-modal queries are always in some direction, with queries in one media and documents in another, giving different scores from when they’re reversed.

The tables below show the retrieval scores for text, audio, and page scan images for A Tale of Two Cities and Pride and Prejudice, when the text from A Tale of Two Cities (in English) is encoded as the query:

Text to text

| Document | Retrieval score |
| --- | --- |
| A Tale of Two Cities (French text extract) | 0.7597 |
| Pride and Prejudice (English text extract) | 0.1482 |
| Pride and Prejudice (French text extract) | 0.0523 |

Text to image

| Document | Retrieval score |
| --- | --- |
| A Tale of Two Cities (English page scan) | 0.5517 |
| A Tale of Two Cities (French page scan) | 0.3576 |
| Pride and Prejudice (English page scan) | 0.1917 |

Text to audio

| Document | Retrieval score |
| --- | --- |
| A Tale of Two Cities (English audio) | 0.3277 |
| A Tale of Two Cities (French audio) | 0.1980 |
| Pride and Prejudice (English audio) | 0.1419 |
| Pride and Prejudice (French audio) | 0.1759 |

Users can also run the query the other way around, doing audio-to-text and image-to-text retrieval.

Below are the scores using the English audio of A Tale of Two Cities as a query and various texts as documents:

Image to text

| Document | Retrieval score |
| --- | --- |
| A Tale of Two Cities (English text extract) | 0.3352 |
| A Tale of Two Cities (French text extract) | 0.2650 |
| Pride and Prejudice (English text extract) | 0.1626 |
| Pride and Prejudice (French text extract) | 0.1385 |

And the scores using a scan of page one of A Tale of Two Cities (in English) as a query:

Audio to text

| Document | Retrieval score |
| --- | --- |
| A Tale of Two Cities (English text extract) | 0.5304 |
| A Tale of Two Cities (French text extract) | 0.4845 |
| Pride and Prejudice (English text extract) | 0.1467 |
| Pride and Prejudice (French text extract) | 0.0761 |

## Video search

The`jina-embeddings-v5-omni`‘s capabilities for video indexing and search bring new capabilities to Elasticsearch databases, but it’s subject to many of the same warnings that apply to texts. Generating a single embedding for a long film is like embedding a very long novel: Detailed information will be swamped, and the resulting embedding will be a good match for many very spurious queries.

If you embed the whole text of Lord of the Rings (~500,000 words), it’s likely to be a good match for most queries, no matter what you’re looking for. Similarly, if you index a two-hour Hollywood film, you’ll get a lot of spurious matching and totally missed details.`jina-embeddings-v5-omni` is optimal with short clips.

For this example, we downloaded the trailer to the 1961 film Breakfast At Tiffany’s, which is just 158 seconds long and in the public domain. You can see the trailer on the Internet Archive.

Figure 4: The theatrical poster for Breakfast at Tiffany’s.

We used PySceneDetect to split the trailer into 28 individual scenes, with lengths varying from 1.877 seconds (45 frames) to 18.393 seconds (441 frames). Scene detection is imperfect, but it provides an adequate mechanism for splitting video into bite-sized chucks for retrieval. Then we generated document embeddings for each of the 28 segments, using`jina-embeddings-v5-omni-small`, so we could test the effectiveness of text queries at finding specific elements in the video.

For example, querying for “cat” returned the following clips as the top three results. The one scene with a cat in it is at the top, with a score of 0.1634:

Watch clip one.

The next highest match, with a score of 0.1237, is much lower:

Watch clip 2.

You can also query for actions. If you query with the string “kiss”, the top four matches all contain kisses:

Watch clip 3. Its score is 0.2864.

Scores: For the second match(0.2494), third match(0.2099), and fourth match(0.2068), respectively

And you can search for text displayed in videos, like for “Buddy Ebsen”, which only appears once.`jina-embeddings-v5-omni-small` readily identifies it as the best match with a score of 0.3885, considerably higher than the next best match:

Buddy Ebsen clip.

## Visual document retrieval

Jina AI multimodal embedding models are top performers in visual document processing and state-of-the-art in multilingual visual document processing. This means handling image data that contains text, figures, and structured information. Important data is often in the form of print scans, PDF files, diagrams, technical drawings, screenshots, pictures, infographics, and the like. These kinds of images are often mechanically composed or computer generated. They can’t usually be reduced to text without loss of meaning and are poorly suited to computational vision models designed for photography of natural scenes.

`jina-embeddings-v5-omni`’s embeddings encompass information about the things in the image, the text printed on them, and the relationships between the two. Visual document retrieval makes it possible to index rich images that contain both things and relevant text and to do so across languages.

As an example, let’s use four product images from various ecommerce websites:

Now, let’s see how well`jina-embeddings-v5-omni-small` scores these four images for the query “ramen noodles”:

| Campbell’s Chunky Chicken Noodle(Canadian packaging) | Kraft Dinner(Canadian packaging) | Maruchan Miso Flavour Fresh Ramen(Japanese packaging) | Birkel Spaghetti (German packaging) |
| --- | --- | --- | --- |
| 0.0872 | 0.0711 | 0.1123 | 0.0886 |

It readily finds the Japanese match.

Now, let’s try a query for “マカロニチーズ” (Japanese for macaroni and cheese):

| Campbell’s Chunky Chicken Noodle(Canadian packaging) | Kraft Dinner(Canadian packaging) | Maruchan Miso Flavour Fresh Ramen(Japanese packaging) | Birkel Spaghetti (German packaging) |
| --- | --- | --- | --- |
| 0.2207 | 0.3487 | 0.2760 | 0.2674 |

It finds the correct match with the same ease as an English query.

`jina-embeddings-v5-omni` also excels at interpreting information-rich images, like charts. To see this in action, look at these two bar charts:

Two charts, Chart 1 to the left, about the global burden of disease, and Chart 2 to the right, about the lifespans of dog breeds.

Let’s see how well they match two potential text questions, each relevant to one but not both charts, using`jina-embeddings-v5-omni-small` for retrieval:

| Text question | Chart 1 | Chart 2 |
| --- | --- | --- |
| “What are some common medical problems for elderly people?” | 0.2787 | 0.1099 |
| “How long do dogs live?” | 0.1350 | 0.3564 |

You can also reverse the search, using images as queries to find texts. The table below shows target documents extracted from the abstracts of topically related scientific papers and their retrieval scores, using the chart images as queries:

| | Text 1 | Text 2 |
| --- | --- | --- |
| | The health of populations living in extreme poverty has been a long-standing focus of global development efforts, and continues to be a priority during the Sustainable Development Goal era. However, there has not been a systematic attempt to quantify the magnitude and causes of the burden in this specific population for almost two decades. We estimated disease rates by cause for the world’s poorest billion and compared these rates to those in high-income populations. | The companion dog is one of the most phenotypically diverse species. Variability between breeds extends not only to morphology and aspects of behaviour, but also to longevity. Despite this fact, little research has been devoted to assessing variation in life expectancy between breeds or evaluating the potential for phylogenetic characterisation of longevity. |
| Chart 1 | 0.2377 | 0.1357 |
| Chart 2 | 0.0673 | 0.3576 |

## Features

### Truncatable embeddings

We trained the backbone`jina-embeddings-v5-text` models underpinning`jina-embeddings-v5-omni` with Matryoshka Representation Learning, so you can truncate both text and multimedia embeddings from these models.

By default,`jina-embeddings-v5-omni-small` generates embeddings with 1024 dimensions, taking 2KB to store at 16-bit precision.`jina-embeddings-v5-omni-nano`’s embeddings have 768 dimensions, taking up about 1.5KB. You can reduce the size of these embeddings down to 32 dimensions (64 bytes) at some cost to accuracy but with a large gain in processing speed and reduced resource costs. In general, reducing embedding sizes by half lowers accuracy by about 2%, down to 128 dimensions, below which accuracy falls much faster.

Truncatable embeddings allow users to decide the optimal trade-off between accuracy, speed, and cost, given their own use cases.

### Quantization

The`jina-embeddings-v5-omni` family also inherits robust performance under quantization from its`jina-embeddings-v5-text` backbone. This further increases speed and reduces computing and storage costs by storing less precise numbers. We’ve trained them to work with Elasticsearch’s Better Binary Quantization(BBQ) to provide near-identical performance to unquantized embeddings. On the Massive Text Embedding Benchmark (MTEB) retrieval benchmark suite, binarization reduces performance by less than 3% compared to full 16-bit values, while saving 93% of the space and dramatically increasing processing and retrieval speeds.

### Cross-language performance

`jina-embeddings-v5-text`’s extensive multilingual training carries over to`jina-embeddings-v5-omni`, with nearly 100 languages in`jina-embeddings-v5-text-small`’s pretraining and 15 major global languages in`jina-embeddings-v5-text-nano`’s. For audio media, the`Whisper-large-v3` model has roughly 100 languages in its training, and the Qwen-modified SigLip2 vision models integrated in`jina-embeddings-v5-omni-small` and`-nano` were trained with data from 201 distinct languages and dialects.

## Benchmark performance

### Text

`jina-embeddings-v5-omni` models are identical to`jina-embeddings-v5-text` models when used just for text. They’re the top performers on the MMTEB benchmark suite in their respective size categories for semantic text embeddings.

Figure 5:`jina-embeddings-v5-omni`’s size and performance on text benchmarks, compared to competing models. The cited size is without loading extensions for other media.

### Visual semantic similarity

On standard visual semantic similarity benchmarks,`jina-embeddings-v5-omni` delivers the best scores of any model near its size.`jina-embeddings-v5-omni` models show by far the best performance for public open-weight models of comparable size.`jina-embeddings-v5-omni-small` is only beaten by a model three times its size on visual semantic similarity tasks, and`jina-embeddings-v5-omni-nano` is beaten only by`jina-embeddings-v5-omni-small` and by models 10 to 25 times larger.

Figure 6: Visual semantic similarity benchmark mean scores for`jina-embeddings-v5-omni-small`,`jina-embeddings-v5-omni-nano`, and comparable models, as well as their sizes including vision extensions.

### Visual document retrieval

`jina-embeddings-v5-omni-small` is competitive with three and seven billion parameter models while remaining under one billion parameters.`jina-embeddings-v5-omni-nano` similarly stands out for its size, beating models ten to sixty times larger.

Figure 7: Mean ViDoRe visual document retrieval scores on six benchmarks: DocVQA, InfoVQA, ShiftProj, SynAI, Tabfquad, and TatDQA.

### Audio retrieval

On the standard MAEB (Massive Audio Embedding Benchmark) audio retrieval benchmarks, both`jina-embeddings-v5-omni-small` and`jina-embeddings-v5-omni-nano` rank among the top performers. Only very large models – more than three times the size of`jina-embeddings-v5-omni-small`– beat its score.

Figure 8: Mean score for various models on the MAEB audio retrieval benchmarks.

Although LAION’s`larger_clap_general` model does improve on jina-embeddings-v5-omni-nano ‘s score while having fewer parameters, it’s an audio-only model with none of the additional multimodal features of the v5-omni suite.

### Video

On video,`jina-embeddings-v5-omni-small` excels at finding the place in a video that matches a text query. The Charades-STA and MomentSeeker tests are the standard benchmarks for this task, and you can see from the charts below that`jina-embeddings-v5-omni-small` is the top scorer among comparable open-weight models despite a far smaller size.

Figure 9: Charades-STA scores for various models, along with their sizes.

Figure 10: MomentSeeker scores for various models, along with their sizes.

We also compared`jina-embeddings-v5-omni-small` to ByteDance's Seed 1.6, a closed-weight model with undisclosed parameter count. Our model beats Seed 1.6 by a large margin on the Charades-STA benchmark and nearly equals it on MomentSeeker.

| Model | Charades-STA score | MomentSeeker score |
| --- | --- | --- |
| seed-1.6-embedding | 29.30 | 59.30 |
| jina-embeddings-v5-omni-small | 55.57 | 58.93 |

## Strengths and limitations

`jina-embeddings-v5-omni` models expand users’ ability to index, search, and analyze digitized information in a number of ways, particularly:

Multilingual speech retrieval from text queries.

PDF, scans, and visual document search.

Video temporal grounding, that is, identifying parts of videos that match natural language text descriptions.

Audio genre classification, including musical genres.

Image classification based on scene information and object identification.

Performance is more limited in some other areas. It may be possible to use`jina-embeddings-v5-omni` to do these tasks, but we haven’t trained for them and results may be poor.

We’re actively working at improving our technology in these areas:

Finding specific videos from natural language descriptions.

Image-to-image semantic similarity and retrieval.

Intent classification in speech, like recognizing verbal commands.

Processing mixed media inputs, that is, images and accompanying text, or audio, images, and texts combined.

## Using jina-embeddings-v5-omni

This model suite supports input via three entry points: text, audio, and images and video together.`jina-embeddings-v5-omni` runs within a framework that converts a broad array of standard formats and does other preprocessing.

We process images using the same NaFlex approach provided in the initial SigLip2 release: If the input is smaller than 262,144 pixels (equivalent to 512x512), it’s upscaled until it's larger than that minimum; and if larger than 3,072,000 pixels, then it’s downscaled until it’s smaller than that maximum. The conversion process ensures that both the height and width of the image is a multiple of 14 pixels, with as little aspect ratio distortion as possible to accomplish that goal. The result is split into patches of 28x28 pixels, so the total number of patches is however many 28x28 squares are needed to cover the image. Each patch is treated like a single token at inference time, and each image input is accompanied by special start and end tokens to delimit a single image.

Omni warning

The`jina-embeddings-v5-omni` models modify video resolution in the same way that images are modified (see above), and we extract up to 32 frames from the video. If the video has more than 32 frames (which is likely, since standard formats are usually at least 24 frames per second), we evenly space the frames we extract. Then, for every two frames, the video preprocessor generates one set of tokens equal to the number of 28x28 squares needed to cover the video.

Figure 11:`jina-embeddings-v5-omni` extracts 32 equally spaced frames from the video. If you have a long video, this means a lot will be lost.

For more details on video preprocessing, see the SigLip2 technical documentation.

Audio tokenization follows the approach built into Qwen-2.5-Omni: Sound files are cut into 30-second segments; if longer than 30 seconds, resampled to 16kHz, transformed into a 128-channel mel-spectrogram. Each 40ms is treated as a single token, so every 30-second segment is handled as 750 tokens, one token per 40ms of audio, plus special start and end tokens to delimit a single sample.

For more details on audio preprocessing, see the Qwen-2.5-Omni Technical Report.

## Availability

Both`jina-embeddings-v5-omni-small` and`jina-embeddings-v5-omni-nano` are available on the Elastic Inference Service(EIS), via the Jina API, and for local installation via download (small and nano). Model weights are distributed freely to try out on a non-commercial license. Contact Elastic sales for commercial use.

## Getting started

To use`jina-embeddings-v5-omni` for text, you can integrate using the`semantic_text` field just like with`jina-embeddings-v5-text`. Just set the`inference_id` to`.jina-embeddings-v5-omni-small` or`.jina-embeddings-v5-omni-nano`. See the Reference Guide for instructions.

To embed other media with`jina-embeddings-v5-omni`, you need to use the inference API. For example:

```
POST _inference/embedding/.jina-embeddings-v5-omni-small
{
  "input": [
    {
      "content": { 
        "type": "image", 
        "format": "base64", 
        "value": "data:image/jpeg;base64,..." 
      } 
    }, 
    { 
      "content": { 
        "type": "text", 
        "value": "Some text to create an embedding" 
      } 
    } 
  ] 
}
```

For`jina-embeddings-v5-omni-nano`, change the`POST` URI to`_inference/embedding/.jina-embeddings-v5-omni-nano`.

To encode documents in other media, or generate embeddings for classification or clustering, you need to create an inference endpoint with the`jinaai` service.

For queries, use the query builder as in the example below. Replace the`inference_id` value with`.jina-embeddings-v5-omni-nano` to use the`nano` model instead of`small`.

```
POST my-index/_search
{
  "knn": {
    "field": "dense-vector-field",
    "k": 10,
    "num_candidates": 100,
    "query_vector_builder": {
      "embedding": {
        "inference_id": ".jina-embeddings-v5-omni-small",
        "input": {
          "type": "image",
          "format": "base64",
          "value": "data:image/jpeg;base64,..."
        }
      }
    }
  }
}
```

See the query builder documentation for more information.

To use BBQ with`jina-embeddings-v5-omni`, follow the instructions for BBQ indexing.

## More information

For more information about`jina-embeddings-v5-omni`, see the model’s technical report and page on the Jina AI website. The`jina-embeddings-v5-omni` collection page on Hugging Face also contains technical information and instructions for downloading and running these models locally. The`jina-embeddings-v5-omni` models can be downloaded under a CC-BY-NC-4.0 license, so you’re free to try them out, but for commercial use, please contact Elastic sales.

### Related Content

Jina AI ML Research

### 0.35% trained, 100% competitive: the frozen-tower architecture behind jina-embeddings-v5-omni

August 12, 2026

0.35% trained, 100% competitive: the frozen-tower architecture behind jina-embeddings-v5-omni

Vector Database Index Data Jina AI+1

### One field, every modality: how Elasticsearch's semantic field indexes and searches images, audio, video and PDFs automatically

August 03, 2026

One field, every modality: how Elasticsearch's semantic field indexes and searches images, audio, video and PDFs automatically

### 56% faster, up to 50% better retrieval performance: What's inside Jina's new 600 million parameter listwise reranker

July 27, 2026

+1

56% faster, up to 50% better retrieval performance: What's inside Jina's new 600 million parameter listwise reranker

### On-prem in under 5 minutes: Jina embedding models now available for on-prem deployment

July 23, 2026

On-prem in under 5 minutes: Jina embedding models now available for on-prem deployment

### A picture is worth 1.5x the words: What we learned benchmarking product search embeddings

July 16, 2026

A picture is worth 1.5x the words: What we learned benchmarking product search embeddings

### Ready to build state of the art search experiences?

Sufficiently advanced search isn’t achieved with the efforts of one. Elasticsearch is powered by data scientists, ML ops, engineers, and many more who are just as passionate about search as you are. Let’s connect and work together to build the magical search experience that will get you the results you want.

Try it yourself Subscribe to newsletter