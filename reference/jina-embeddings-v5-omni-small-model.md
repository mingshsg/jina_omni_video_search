---
title: "jina-embeddings-v5-omni-small model card"
source: https://jina.ai/models/jina-embeddings-v5-omni-small/
downloaded: 2026-08-25
note: Offline snapshot for local planning. Prefer the live URL for the latest version.
---

jina-embeddings-v5-omni-small - Search Foundation Models- - - - - - - - - - - - - - - - -   
  - 
- - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - searchreorderModelsAPIkeyboard_arrow_downReaderConvert any URL to Markdown for better grounding LLMs.EmbeddingsMultimodal multilingual embeddings.RerankerReranker for maximizing search relevancy.Elastic Inference ServiceRun Jina models natively inside Elasticsearch.MCPterminalCLIarticlellms.txtsmart_toyAgentsdata_objectSchemamenu_bookDocsLog inloginarrow_backBack to Models Embeddings copyright CC BY-NC 4.0 open_in_new Release Post
# jina-embeddings-v5-omni-small

Multimodal embeddings for text, image, audio, video, and PDFLicensecopyright CC-BY-NC-4.0Release Datecalendar_month2026-05-07InputabcTextimageImageaudiotrackAudiovideocamVideopicture_as_pdfPDFarrow_forwardOutputmore_horizVectorMatryoshka Dimensions help_outline32641282565127681024Model DetailsParameters: 1.7BInput Token Length: 32KOutput Dimension: 1024Base Model help_outlineopen_in_newjina-embeddings-v5-text-small Trained Languages help_outline32 languages more_horizSupported Languages help_outline93 languages more_horizQuantizations help_outlineGGUFApple Silicon Support help_outlineMLXRelated Modelslinkjina-embeddings-v5-omni-nanolinkjina-embeddings-v5-text-smalllinkjina-embeddings-v3linkjina-clip-v2Supported Taskssearch Retrievalcompare_arrows Text Matchingbubble_chart Clusteringlabel ClassificationAvailable via Elastic Inference Service Jina API AWS SageMaker Hugging Face Air-gappedI/O graph 1Text

jina-embeddings-v5-omni-small

Image

Task

Vector

I/O graph 2Text

jina-embeddings-v5-omni-small

Audio

Task

Vector

I/O graph 3Text

jina-embeddings-v5-omni-small

Video

Task

Vector

I/O graph 4multiple

Vector

Text

jina-embeddings-v5-omni-small

PDF

Task

Pareto fronthelp_outlineMMTEBRTEB publicMIEBMAEBchevron_leftchevron_right- - - - - - - 30M- 100M- 300M- 1B- 3.0B- 10B20406080bekko-embedding-v1-a25mbge-large-enbge-large-en-v1.5bge-m3bge-small-en-v1.5BOOM-4B-v1e5-base-v2e5-mistral-7b-instructF2LLM-v2-14BF2LLM-v2-330MF2LLM-v2-4BF2LLM-v2-80Mgranite-embedding-small…GritLM-7Bjina-embeddings-v2-base…jina-embeddings-v2-smal…jina-embeddings-v3jina-embeddings-v4jina-embeddings-v5-omni…jina-embeddings-v5-text…jina-embeddings-v5-text…LaBSEMoD-EmbeddingNemotron-3-Embed-8BNV-Embed-v2Octen-Embedding-0.6BOcten-Embedding-4BOcten-Embedding-8Bparaphrase-multilingual…paraphrase-multilingual…PIXIE-Rune-v1.0potion-multilingual-128Msnowflake-arctic-embed-…UAE-Large-V1voyage-4-nanoParameters (log)nDCG@10This modelOn the frontJina AIOtherRTEB public 66.84Parameters 1.6BRank by score 14 / 62Pareto front Behind itValue distributionhelp_outlineAUC 0.8269CorpusTranslation pairs Doc retrieval Code Image / banner Image / logo Taskclassificationclusteringretrieval.passageretrieval.queryretrieval.query → retrieval.passagetext-matching- - 0.808- 0.40- 0.50- 0.60- 0.70- 0.80- 0.90Related10.9%Hard negative2.1%Unrelated0.9%Recommended cutoffsFPR 0.1 · 0.717 FPR 0.01 · 0.808 FPR 0.001 · 0.860 FPR 0.0001 · 0.878 balanced · 0.697 AUC 0.8269Noise ceiling 0.855Recall cliff 0.566Pairs measured 119 / 11kThis model shares its text tower with jina-embeddings-v5-text-small. The distributions here are that model's, which it matches to fp16 wire precision.Vector componentshelp_outline- -0.160.010.18 σ 0.0313 · 244k valuesEmbedding geometryhelp_outline- 01024Per-dimension mean, hover for a rangeNoise floor 0.300Effective dims 70 / 1024Dimension truncationhelp_outline- 32641282565121024text-matching · Cutoff by requested dimensionsLanguage pairshelp_outline- de-ruen-deen-koen-zhja-koCutoff spread across pairs: 0.024Choose models to compare jina-embeddings-v5-omni-smalljina-embeddings-v5-omni-nanojina-embeddings-v5-text-smalljina-embeddings-v3jina-clip-v2cancelarrow_drop_downcompare_arrowsComparePublications (1)SIGIR 2026May 11, 2026jina-embeddings-v5-omni: Geometry-preserving Embeddings via Locked Aligned TowersOverview

jina-embeddings-v5-omni-small (~1.74B parameters) is a multimodal embedding model that accepts text, images, video, and audio and produces embeddings in a shared vector space aligned with jina-embeddings-v5-text-small. You can index with text and query with any modality, or vice versa, without reindexing. The text backbone and all four task-specific LoRA adapters (retrieval, text-matching, clustering, classification) are frozen during multimodal training, so text-only outputs are bit-identical to jina-embeddings-v5-text-small. The model produces 1024-dimensional embeddings with Matryoshka truncation down to 32 dimensions and supports 32K token context length.Methods

Trained in a third stage extending jina-embeddings-v5-text-small. The text backbone and all four task-specific LoRA adapters are frozen; only the cross-modal projectors are newly trained. A SigLIP2 So400m vision encoder handles images and video (32 uniformly sampled frames). A Whisper-large-v3 audio encoder handles audio input. PDF pages are rendered as images and processed through the vision pathway. Training uses contrastive loss with cross-modal hard negatives to align visual and audio representations with the existing text embedding space.Performance

Text-only performance is bit-identical to jina-embeddings-v5-text-small — the text backbone and LoRA adapters are untouched during multimodal training. On cross-modal retrieval, the model demonstrates strong alignment across text-image, text-audio, and text-video tasks. PDF page retrieval is handled through the vision pathway. The omni-small model offers the best accuracy-efficiency tradeoff among Jina multimodal embedding models for server deployment.Best Practice

Same four LoRA adapters as v5-text-small: retrieval, text-matching, clustering, and classification. For multimodal inputs via the API, pass image URLs, audio file URLs, video file URLs, or PDF URLs directly — the model routes each modality through the appropriate encoder. Supported audio formats include WAV, MP3, FLAC, OGG, M4A, and Opus. Video inputs are processed as 32 uniformly sampled frames. Mix modalities freely within a single batch: the embedding space is shared across all modalities. Use cosine similarity for comparison. Matryoshka truncation from 1024 to 32 dimensions is supported. Text-only embeddings are drop-in compatible with jina-embeddings-v5-text-small — no reindexing needed when upgrading.Blogs that mention this modelMay 12, 2026 • 7 minutes readjina-embeddings-v5-omni: Embeddings for Text, Image, Audio and VideoOne model, four modalities: text, image, audio, video. Best-in-class omni embeddings in 1.6B and 0.9B.1Current language / themelanguageundefined / AutoSearch FoundationReaderEmbeddingsRerankerGet Jina API keyRate LimitAbout usNewsDownload Jina logoopen_in_newDownload Elastic logoopen_in_newAPI Status    Elastic © 2026.SecurityTerms & ConditionsPrivacyManage CookiesDo Not Sell or Share My Personal InformationThis website and all associated content, software, products, and services are intended for professional use only. No consumer use is intended or directed.
