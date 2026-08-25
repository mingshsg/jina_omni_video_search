---
title: "jina-embeddings-v5-omni: Geometry-preserving Embeddings via Locked Aligned Towers"
source: https://arxiv.org/html/2605.08384
pdf: https://arxiv.org/pdf/2605.08384
downloaded: 2026-08-25
note: Offline HTML-to-markdown snapshot of the technical report. Prefer arXiv for the authoritative version.
---

jina-embeddings-v5-omni: Geometry-preserving Embeddings via Locked Aligned Towers

- 

- 
- 
- 
- 
- 
- - 

  
    
      Report GitHub Issue
      ×
    

    
      Title:
      

      Content selection saved. Describe the issue below:

      Description:
      
    

    
      Submit without GitHub
      Submit in GitHub
    
  

    
    arXiv is now an independent nonprofit!
    Learn more
    &times;
  

  
    
      Back to arXiv
    
  
  
  

  
    License: CC BY-NC-SA 4.0
  
  
arXiv:2605.08384v4 [cs.CL] 17 Aug 2026

# jina-embeddings-v5-omni: Geometry-preserving Embeddings via Locked Aligned Towers

CCS: Information systems Multimedia and multimodal retrievalCCS: Computing methodologies Image representationsCCS: Computing methodologies Machine learning

Florian Hönicke

Note: Principal contributor.

Affiliation: Jina by Elastic

email: research@jina.ai

, 
Michael Günther

Affiliation: Jina by Elastic

email: research@jina.ai

, 
Andreas Koukounas

Affiliation: Jina by Elastic

email: research@jina.ai

, 
Mohammad Kalim Akram

Affiliation: Jina by Elastic

email: research@jina.ai

, 
Saba Sturua

Affiliation: Jina by Elastic

email: research@jina.ai

 and 
Han Xiao

Affiliation: Jina by Elastic

email: research@jina.ai

© none

Abstract.
    
In this work, we introduce GELATO (Geometry-preserving Embeddings via Locked Aligned TOwers), a novel approach to multimodal embedding models.
We build on the VLM-style architecture, in which non-text encoders are adapted to produce input for a language model, which in turn generates embeddings for all varieties of input.
We present the result: the jina-embeddings-v5-omni suite, a pair of models that encode text, image, audio, and video input into a single semantic embedding space.
GELATO extends the two Jina Embeddings v5 Text models to support additional modality by adding encoders for images and audio.
The backbone text embedding models and the added non-text modality encoders remain frozen.
We only trained the connecting components, representing 0.35% of the total weights of the joint model.
Training is therefore much more efficient than full-parameter retraining.
Additionally, the language model remains effectively unaltered: the text-encoder weights are bit-identical to the Jina Embeddings v5 Text models.
Our evaluations show that GELATO produces results competitive with substantially larger, state-of-the-art multimodal embedding models across text, image, and audio benchmarks.

  

## 1. Introduction

Text embedding models anchor retrieval, retrieval-augmented generation (RAG) (Lewis et al., 2020), and classification pipelines whose vector indexes depend on a stable embedding geometry.
At the same time, search workloads increasingly require images, including screenshots, page scans, infographics, and other rendered media; audio, such as speech, music, and natural sounds; as well as video, to be queried alongside text. (Xiao et al., 2025b; Macé et al., 2025; Jiang et al., 2025; El Assadi et al., 2026)

Figure 1. Average performance across multimodal embedding tasks versus model parameter count (see Table 1).A one-column frontier chart with Table 1 average scores for six open-weight omni models: jina-v5-omni-nano, jina-v5-omni-small, LanguageBind, LCO-3B, LCO-7B, and Nem-3B.

Figure 2. Architecture of jina-embeddings-v5-omni (jina-embeddings-v5-omni-small shown; jina-embeddings-v5-omni-nano uses a smaller ViT and LLaVA-style tokens).
Frozen towers feed trainable modality projectors into the frozen text backbone; task-specific exports select one projector/delimiter set and the matching LoRA adapter.

We present jina-embeddings-v5-omni, a pair of models that extends a text embedding backbone to image, video, and audio while leaving the model entirely unchanged for text inputs. The two models differ substantially in size: jina-embeddings-v5-omni-nano is based on jina-embeddings-v5-text-nano, with 0.24B parameters in its base text-only model, and jina-embeddings-v5-omni-small, based on jina-embeddings-v5-text-small with 0.67B parameters. (Akram et al., 2026)
The two base models have already been trained for high-performance text embeddings, using LoRA adapters to optimize them for multiple tasks: retrieval, text-matching, clustering, and classification.

To add support for non-text modalities, we integrate:

- • 

Vision encoders from Qwen3.5-2B and Qwen3.5-0.8B (Qwen Team, 2026), which have been adapted from SigLIP2 So400m and SigLIP2 Base respectively. (Tschannen et al., 2025)

- • 

The Qwen2.5-Omni audio encoder, (Chu et al., 2025) which has been adapted from Whisper-large-v3. (Radford et al., 2023)

The core idea of GELATO is to use independently pretrained, language-aligned encoders and align them to text embedding models through small trainable projectors rather than jointly retraining them. This makes it possible to readily construct modular multimodal embedding models while minimizing added parameters and additional training.

Contributions.

- (1) 

We describe GELATO and apply it in the construction of the jina-embeddings-v5-omni model suite by extending the Jina Embeddings v5 Text suite to support other media.

- (2) 

We contribute to the open embedding ecosystem by releasing the jina-embeddings-v5-omni model collection11
                    1
                    
                    
                    
                  Jina Embeddings v5 Omni Hugging Face collection., comprising two base models and eight task-specific variants for retrieval, classification, clustering, and text-matching across Small and Nano scales.

- (3) 

We evaluate jina-embeddings-v5-omni and comparable models across a range of standard benchmarks, and show that GELATO produces competitive results. (See Figure 1.)

- (4) 

We analyze the design rules behind GELATO through ablations on projector training, encoder choice, and Matryoshka truncation, and separately quantify training efficiency.

## 2. Related Work

Text-only embedding models are long established for retrieval and RAG systems, from bidirectional encoders such as Sentence-BERT (Reimers and Gurevych, 2019) and GTE-Qwen2 (Alibaba Tongyi Lab, 2024) to LLM-based text-only embedding models such as E5-Mistral (Wang et al., 2024b) and NV-Embed (Lee et al., 2025).
Jina Embeddings v5 Text (Akram et al., 2026) draws on this tradition: a state-of-the-art model family with task-conditioned LoRA adapters and support for truncation with low performance loss due to Matryoshka representation learning (Kusupati et al., 2022).

CLIP (Radford et al., 2021) established contrastive image–text embedding with separately encoded image and text towers, and SigLIP (Zhai et al., 2023), SigLIP2 (Tschannen et al., 2025), and EVA-CLIP (Fang et al., 2023) refine this paradigm through improved losses, data, and visual training recipes.
ImageBind (Girdhar et al., 2023) extends contrastive alignment to additional modalities.
Jina CLIP v1/v2 (Koukounas et al., 2024b; Koukounas et al., 2024a) maintains text-embedding performance in CLIP-style models, while supporting other media.
However, contrastively-trained multimodal embedders suffer from a gap between modality-specific regions of the shared representation space (Liang et al., 2022).

VLM-style architectures tackle this challenge by passing the outputs of non-text media encoders through the same language model as the text token representations.
These models, including LLaVA (Liu et al., 2023), BLIP-2 (Li et al., 2023), Qwen2-VL (Wang et al., 2024a), and Qwen3-VL (Bai et al., 2025), use projectors or connector modules to connect the encoders to the language model.
Embedding models derived from VLMs, like E5-V (Jiang et al., 2024), GME (Zhang et al., 2025), and Qwen3-VL-Embedding (Li et al., 2026), demonstrate strong multimodal retrieval performance, but involve adapting the language model, non-text media encoders, or both.

Omni-style systems train or align multiple modalities jointly, supporting video and audio in addition to images, for example, E5-Omni (Chen et al., 2026), WAVE (Tang et al., 2026), and LCO-Embedding-Omni (Xiao et al., 2025a).

We take note of previous work in frozen-tower methods based on the CLIP architecture, such as LiT (Zhai et al., 2022) and Nomic Embed Vision (Nussbaum et al., 2024), which freeze the text encoder while adapting the other media towers.
The most relevant prior work is the visual-module-plugin family.
MARVEL (Zhou et al., 2024b) adds a CLIP visual encoder with a linear projection layer to the frozen text retriever T5-ANCE, then finetunes the text retriever end-to-end for multi-modal retrieval.
VISTA (Zhou et al., 2024a) extends a frozen text embedding model with a trainable ViT image tokenizer, keeping the text encoder frozen throughout.
To the best of our knowledge, no previously published work extends a frozen text embedding model to image, video, and audio jointly while keeping all media encoders frozen and training only a single linear projector layer per modality together with a small set of modality delimiter token embeddings.

## 3. Architecture

Figure 2 summarizes the architecture of the jina-embeddings-v5-omni models.
We extend Jina Embeddings v5 Text from text-only embedding to vision and audio by adding scale-matched Qwen3.5 vision encoders22
            2
            
            
            
          jina-embeddings-v5-omni-small uses Qwen/Qwen3.5-2B; jina-embeddings-v5-omni-nano uses Qwen/Qwen3.5-0.8B. and the Qwen2.5-Omni audio encoder to the same text-sequence backbone.
We chose encoders from trained multimodal language systems rather than bare perceptual encoders such as SigLIP2 or Whisper-large because prior work shows that visual and audio features need explicit language-space alignment or natural-language supervision before they transfer reliably to text-conditioned multimodal tasks (Chen et al., 2025; Elizalde et al., 2023; Qwen Team, 2026; Chu et al., 2025).
The text processing path of jina-embeddings-v5-omni shares the frozen text-encoder weights of Jina Embeddings v5 Text bit-for-bit: token embeddings pass through the frozen text transformer, the inherited task LoRA adapter is applied, and the final embedding is produced by last-token pooling and L2 normalization.

### 3.1. Projectors

jina-embeddings-v5-omni uses image and audio encoders extracted from Qwen3.5 and Qwen2.5-Omni, respectively. Because their output dimensions do not match Jina Embeddings v5 Text’s input, we replace the source projection layers with new projectors that map into the text hidden space.
For audio, we inserted a randomly-initialized fc_audio layer that projects the encoder’s native 12801280 dimension output into jina-embeddings-v5-omni-small’s 10241024-dimension input space and jina-embeddings-v5-omni-nano’s 768768-dimension one.

We write each fully connected layer as the same affine map

ℓW,𝐛​(𝐱)=W​𝐱+𝐛,\ell_{W,\mathbf{b}}(\mathbf{x})=W\mathbf{x}+\mathbf{b},

with layer-specific weights and bias.
Thus fc_vision_1 is ℓWv1,𝐛v1\ell_{W_{\text{v1}},\mathbf{b}_{\text{v1}}}, fc_vision_2 is ℓWv2,𝐛v2\ell_{W_{\text{v2}},\mathbf{b}_{\text{v2}}}, and fc_audio is ℓWaud,𝐛aud\ell_{W_{\text{aud}},\mathbf{b}_{\text{aud}}}.

For vision, the Qwen3.5 visual projector converts ViT patch tokens into text-token features by applying LayerNorm, a 2×22{\times}2 spatial merge, fc_vision_1, GELU, and fc_vision_2.
Here, LayerNorm denotes feature normalization on the ViT patch tokens.
The 2×22{\times}2 spatial merge is a fixed space-to-depth (pixel-unshuffle) rearrangement that concatenates four neighboring patch embeddings into one 4​dvit4d_{\text{vit}} vector, reducing the spatial token count by 4×4\times; it is the inverse direction of pixel shuffle/sub-pixel rearrangement (Shi et al., 2016) and follows Qwen’s visual-merger design (Wang et al., 2024a; Qwen Team, 2026).
For each group of four neighboring patch tokens 𝐕i=[𝐯i,1,…,𝐯i,4]∈ℝ4×dvit\mathbf{V}_{i}=[\mathbf{v}_{i,1},\ldots,\mathbf{v}_{i,4}]\in\mathbb{R}^{4\times d_{\text{vit}}}, the vision projector produces

𝐦vis(i)\displaystyle\mathbf{m}^{(i)}_{\text{vis}}
=[LayerNorm​(𝐯i,1);…;LayerNorm​(𝐯i,4)]∈ℝ4​dvit,\displaystyle=\bigl[\text{LayerNorm}(\mathbf{v}_{i,1});\ldots;\text{LayerNorm}(\mathbf{v}_{i,4})\bigr]\in\mathbb{R}^{4d_{\text{vit}}},

𝐳vis(i)\displaystyle\mathbf{z}^{(i)}_{\text{vis}}
=GELU​(ℓWv1,𝐛v1​(𝐦vis(i))),\displaystyle=\text{GELU}\!\left(\ell_{W_{\text{v1}},\mathbf{b}_{\text{v1}}}(\mathbf{m}^{(i)}_{\text{vis}})\right),

𝐡vis(i)\displaystyle\mathbf{h}^{(i)}_{\text{vis}}
=ℓWv2,𝐛v2(𝐳(i)vis),i=1,…,Nvis.\displaystyle=\ell_{W_{\text{v2}},\mathbf{b}_{\text{v2}}}(\mathbf{z}^{(i)}_{\text{vis}}),\qquad i=1,\ldots,N_{\text{vis}}.

Only fc_vision_2 performs the dimension-specific projection into a text hidden space: in the 2B source checkpoint it maps 4096→20484096{\to}2048 into the Qwen3.5-2B text hidden dimension, and in the 0.8B source checkpoint it maps 3072→10243072{\to}1024 into the Qwen3.5-0.8B text hidden dimension.
These targets do not match Small’s 10241024-dimensional or Nano’s 768768-dimensional Jina text backbone, so we keep LayerNorm and fc_vision_1 frozen but replace fc_vision_2 with a randomly initialized 4096→10244096{\to}1024 layer for Small and 3072→7683072{\to}768 layer for Nano.

Let 𝐀=[𝐚1,…,𝐚K]∈ℝK×1280\mathbf{A}=[\mathbf{a}_{1},\ldots,\mathbf{a}_{K}]\in\mathbb{R}^{K\times 1280} denote the frozen Qwen2.5-Omni audio encoder states for an input with KK audio tokens.
Each audio token is independently projected into the Jina text hidden dimension by fc_audio

𝐡aud(i)=ℓWaud,𝐛aud(𝐚i),i=1,…,K,\mathbf{h}^{(i)}_{\text{aud}}=\ell_{W_{\text{aud}},\mathbf{b}_{\text{aud}}}(\mathbf{a}_{i}),\qquad i=1,\ldots,K,

where Waud∈ℝdtext×1280W_{\text{aud}}\in\mathbb{R}^{d_{\text{text}}\times 1280} and dtext∈{1024,768}d_{\text{text}}\in\{1024,768\} for Small and Nano.

### 3.2. Input Sequence Construction

Each input is serialized as one sequence of tokens.
Text remains ordinary text tokens; non-text modalities are represented by placeholder runs inside modality delimiters.
An image is encoded as

<|vision_start|>​<|image_pad|>×N⏟visual slots​<|vision_end|>\texttt{<|vision\_start|>}\;\;\underbrace{\texttt{<|image\_pad|>}\times N}_{\text{visual slots}}\;\;\texttt{<|vision\_end|>}

with NN visual slots.
An audio input is encoded as

<|audio_start|>​<|audio_pad|>×K⏟audio slots​<|audio_end|>\texttt{<|audio\_start|>}\;\;\underbrace{\texttt{<|audio\_pad|>}\times K}_{\text{audio slots}}\;\;\texttt{<|audio\_end|>}

with KK audio slots.
A video is a concatenation of one visual segment per sampled frame:

∥f=1F(<|vision_start|><|video_pad|>×Sf⏟frame ​f​ slots<|vision_end|>),\big\|_{f=1}^{F}\left(\texttt{<|vision\_start|>}\;\;\underbrace{\texttt{<|video\_pad|>}\times S_{f}}_{\text{frame }f\text{ slots}}\;\;\texttt{<|vision\_end|>}\right),

where ∥\| denotes sequence concatenation.
If a video contains an audio track, the extracted audio segment precedes the frame sequence:

𝐬aud|𝐬vid.\mathbf{s}_{\text{aud}}\|\mathbf{s}_{\text{vid}}.

Here, 𝐬aud\mathbf{s}_{\text{aud}} is the audio sequence above and 𝐬vid\mathbf{s}_{\text{vid}} is the video-frame sequence.
For mixed-modality inputs, text spans and modality segments are concatenated in document order.

### 3.3. Trainable Parameters

The trainable set is fc_vision_2, fc_audio, and the modality-delimiter embeddings.
jina-embeddings-v5-omni-small learns the vision and audio start/end delimiter embeddings used in Section 3.2; jina-embeddings-v5-omni-nano learns only the audio start/end delimiter embeddings.
The image, video, and audio placeholder positions are overwritten by projected encoder features rather than learned as standalone token embeddings.
Projector and delimiter-token training is run separately for retrieval, text-matching, clustering, and classification, while the text transformer, encoder towers, LayerNorm/fc_vision_1 vision-projector weights, and inherited LoRA adapters stay frozen.
The base package stores four such task-specific sets alongside the inherited LoRA adapters.

### 3.4. Dynamic Weight Loading

Jina Embeddings v5 Text already uses dynamic adapter selection to route retrieval, classification, clustering, and text-matching inputs through the corresponding task adapter.
We extend the same task-selection mechanism to the multimodal weights: the selected task variant determines which LoRA adapter, fc_vision_2, fc_audio, and learned special text-token embeddings are loaded or activated.
The task-specific projector and delimiter-token weights therefore follow the same task-specific variation as Jina Embeddings v5 Text.
Separately, the model exposes a modality attribute that controls which frozen modality towers are instantiated: text-only loading omits both vision and audio towers, vision-only loading omits the audio tower and fc_audio, audio-only loading omits the vision tower and vision projector, and omni loading keeps both vision and audio towers.

## 4. Training

Projector training uses bidirectional in-batch InfoNCE with Matryoshka representation learning.
For a batch of BB paired examples {(ℓi,ri)}i=1B\{(\ell_{i},r_{i})\}_{i=1}^{B}, let 𝐮i\mathbf{u}_{i} and 𝐯i\mathbf{v}_{i} be the left and right embeddings, and let 𝐮i,1:k\mathbf{u}_{i,1:k} denote the first kk dimensions.
With temperature τ=0.02\tau=0.02,

si​j(k)\displaystyle s_{ij}^{(k)}
=cos(𝐮i,1:k,𝐯j,1:k)τ,\displaystyle=\frac{\cos(\mathbf{u}_{i,1:k},\mathbf{v}_{j,1:k})}{\tau},

pℓ→r(k)​(j|i)\displaystyle p_{\ell\to r}^{(k)}(j|i)
=exp⁡(si​j(k))∑m=1Bexp⁡(si​m(k)),\displaystyle=\frac{\exp(s_{ij}^{(k)})}{\sum_{m=1}^{B}\exp(s_{im}^{(k)})},

pr→ℓ(k)​(j|i)\displaystyle p_{r\to\ell}^{(k)}(j|i)
=exp⁡(sj​i(k))∑m=1Bexp⁡(sm​i(k)).\displaystyle=\frac{\exp(s_{ji}^{(k)})}{\sum_{m=1}^{B}\exp(s_{mi}^{(k)})}.

ℒNCE(k)=−12​B∑i=1B[logpℓ→r(k)(i|i)+logpr→ℓ(k)(i|i)].\mathcal{L}_{\mathrm{NCE}}^{(k)}=-\frac{1}{2B}\sum_{i=1}^{B}\left[\log p_{\ell\to r}^{(k)}(i|i)+\log p_{r\to\ell}^{(k)}(i|i)\right].

The training loss sums this term over Matryoshka prefix dimensions,

ℒ\displaystyle\mathcal{L}
=∑k∈𝒦ℒNCE(k),\displaystyle=\sum_{k\in\mathcal{K}}\mathcal{L}_{\mathrm{NCE}}^{(k)},

𝒦Small\displaystyle\mathcal{K}_{\mathrm{Small}}
={32,64,128,256,512,768,1024},\displaystyle=\{32,64,128,256,512,768,1024\},

𝒦Nano\displaystyle\mathcal{K}_{\mathrm{Nano}}
={32,64,128,256,512,768}.\displaystyle=\{32,64,128,256,512,768\}.

We use the AdamW optimizer (Loshchilov and Hutter, 2019) with β1=0.9\beta_{1}{=}0.9, β2=0.999\beta_{2}{=}0.999, weight decay 0.010.01, and global gradient clipping at ∥∇∥2≤1\lVert\nabla\rVert_{2}\leq 1.
The learning rate is 2⋅10−42{\cdot}10^{-4} with 500500 linear warmup steps.
Training uses bf16 mixed precision and distributed data parallelism across 44 NVIDIA H100 GPUs, with global batch size 256256 paired examples.
Projector training is run separately per modality and per task: the vision projector (fc_vision_2 plus the vision modality-delimiter embeddings, where applicable) and the audio projector (fc_audio plus the audio modality-delimiter embeddings) are trained in independent runs, each one using the corresponding frozen LoRA adapter inherited from Jina Embeddings v5 Text and a task-matched source mixture.
Across both model sizes, the four task variants (retrieval, classification, clustering, text-matching), and the two modalities (vision, audio), this yields 2×4×2=162\times 4\times 2=16 projector-training runs in total.
Each run is trained for 15 00015\,000 optimizer steps.
Each batch contains examples from one source dataset sampled by mixture weight.
Figure 3 summarizes the shared projector-training mixture by token share across semantic data types.
The mixture is full of text-rich and complex images like scans and diagrams, matching practical enterprise search and RAG systems that operate over real-world multimodal documents whose layout, images, and OCR/parsing stages affect retrieval quality (Lewis et al., 2020; Yu et al., 2025).

(a) Image (token share)natural photos35.5%medical imagery30.3%documents & OCR23.7%product catalog5.3%charts & diagrams3.6%UI & screenshots1.6%(b) Audio (token share)music55.0%environmental sounds25.5%English speech14.2%multilingual speech3.1%animal sounds1.9%emotional speech0.2%
Figure 3. Distribution of input tokens across semantic data types, averaged over the four task-specific checkpoints.

## 5. Evaluation

We describe each evaluation suite by the types of tasks it covers:

- • 

Images: The Massive Image Embedding Benchmark (MIEB) (Xiao et al., 2025b) covers classification, clustering, visual semantic textual similarity (STS), retrieval, document retrieval, compositional reasoning, and vision-centric tasks.

- • 

Video: The Massive Multimodal Embedding Benchmark (MMEB) (Jiang et al., 2025) provides a video evaluation suite, MMEB-Video, covering classification, VQA, retrieval, and moment-retrieval sub-tasks.

- • 

Audio: The Massive Audio Embedding Benchmark (MAEB) (El Assadi et al., 2026) covers audio–text and audio-centric embedding quality, grouped by task type (retrieval, classification, clustering, text-matching).

- • 

Text: The Massive Multilingual Text Embedding Benchmark (MMTEB) (Enevoldsen et al., 2025) evaluates text-only embedding quality across retrieval, classification, clustering, semantic textual similarity, reranking, and pair-classification tasks.
Documents. We report ViDoRe (Macé et al., 2025) page-level retrieval, where embeddings must capture fine layout and small text.

For text, we report the published MMTEB scores for the inherited Jina Embeddings v5 Text encoders, which jina-embeddings-v5-omni shares bit-for-bit. (Akram et al., 2026)

Our baselines for comparison consist of open-weight omni-style models with support for the same media types: LanguageBind, Omni-Embed-Nemotron-3B, LCO-Embedding-Omni-3B, and LCO-Embedding-Omni-7B.
It also includes some task-matched specialized models: CLIP/SigLIP-style and VLM-derived embedders for vision, Whisper/CLAP-style embedders for audio, and VLM/video embedding models for video.
Parameter counts are task-path specific: summaries for omni-style models count all compared modalities, while modality-specific rows count only the encoders needed for that task.

Table 1. Open-weight omni-style model scores on selected evaluation subsets.
Text uses MMTEB; Image, Video, and Audio use aggregate MIEB, MMEB-Video subseta, and MAEB scores, respectively.

Model
Params (B)
Text
Image
Video
Audio
Avg

jina-embeddings-v5-omni-nano
0.95
65.52
47.87
26.87
49.69
47.49

LanguageBind
1.14
27.34
47.80
48.06
20.08
35.82

jina-embeddings-v5-omni-small
1.57
67.00
58.00
41.20
49.96
54.04

Omni-Embed-Nemotron-3B
4.70
47.64
44.47
24.46
48.27
41.21

LCO-Embedding-Omni-3B
4.70
57.55
58.42
46.84
52.51
53.83

LCO-Embedding-Omni-7B
8.93
59.31
58.64
47.41
52.37
54.43

a MMEB-Video subset: Breakfast, MSR-VTT, EgoSchema, HMDB51, UCF101, MSVD, SmthSmthV2, DiDeMo, and K700.
Params count the loaded parameters needed for text, image, video, and audio requests; LanguageBind counts one shared language encoder plus the Image, Video_FT, and Audio_FT modality paths, not duplicate text copies shipped across the separate checkpoints.
Avg averages the displayed numeric columns.

Table 2. Document-retrieval scores on the ViDoRe-in-MIEB subset.

Model
Params∗ (B)
Document retrieval

jina-embeddings-v5-omni-nano
0.31
79.25

LanguageBind
0.43
37.33

jina-embeddings-v5-omni-small
0.92
79.25

LCO-Embedding-Omni-3B
4.07
78.24

Omni-Embed-Nemotron-3B
4.70
85.64

LCO-Embedding-Omni-7B
8.93
80.32

*Text+image path parameters for document retrieval; audio/video encoders are not counted.
Subset tasks: DocVQA, InfoVQA, TabFQuAD, TAT-DQA, ArxivQA, ShiftProject, SyntheticDocQA-AI, SyntheticDocQA-Energy, SyntheticDocQA-HealthcareIndustry, and SyntheticDocQA-GovernmentReports.

### 5.1. Results

Table 1 shows that jina-embeddings-v5-omni-small has the strongest text-only performance and the best overall score among models below 55B parameters.
Its 54.0454.04 four-modality average is slightly above LCO-Embedding-Omni-3B (53.8353.83) and below only the larger LCO-Embedding-Omni-7B score of 54.4354.43, among comparable omni-style models.
The same table also contains comparisons by modality. jina-embeddings-v5-omni-small is very strong on text and competitive on images and audio, but video performance lags significantly compared to the baseline models.

Table 2 shows that both jina-embeddings-v5-omni-nano and jina-embeddings-v5-omni-small have strong visual document retrieval performance.
jina-embeddings-v5-omni-small scores 79.2579.25 with 0.920.92B active text+image-path parameters, above LCO-Embedding-Omni-3B (78.2478.24) and close to LCO-Embedding-Omni-7B (80.3280.32).
jina-embeddings-v5-omni-nano matches that with 79.2579.25 at 0.310.31B active parameters, also surpassing LCO-Embedding-Omni-3B (78.2478.24) at less than a tenth the parameter count.

Table 4 gives a detailed breakdown across multiple benchmarks. The strongest jina-embeddings-v5-omni-small performances are for image classification, image clustering, visual STS, multilingual image retrieval, and audio classification, while generic image retrieval, MMEB-Video, and audio clustering remain weaker.

Figures 5 and 6 show relative performance per language, compared to the average of the baseline models. Color indicates deviation from the five-model per-language mean for image-language and audio retrieval, respectively.
Figure 5 highlights the relatively strong performance of jina-embeddings-v5-omni-small on languages other than English, while Figure 6 does the same for audio performance.

### 5.2. Modality Geometry

Freezing the vision and audio encoders means that they are not contrastively trained the way a fully co-trained model would be, and therefore may not align the different modalities to the same degree.
We evaluate the resulting embedding geometry and retrieval quality on the MS-COCO Karpathy split (2,0002{,}000 images ×\times 55 captions = 10,00010{,}000 caption candidates) and the Clotho v2 test split (1,0451{,}045 audio–caption pairs, 11 caption each), comparing the jina-embeddings-v5-omni models to the three co-trained omni baselines from Table 4: LCO-Embedding-Omni-3B (3.73.7B), LCO-Embedding-Omni-7B (8.938.93B), and Omni-Embed-Nemotron-3B (4.74.7B).
We exclude the fourth omni-style baseline of Table 4, LanguageBind, because its per-modality CLIP-style architecture is structurally different from the unified-decoder pattern used by our omni models, so its modality-gap and retrieval-margin readings are not comparable.

All embeddings are L2L_{2}-normalised, and each model encodes texts and media in its natural retrieval protocol.
Following (Liang et al., 2022), we report centroid distance ∥μA−μB∥2\lVert\mu_{A}-\mu_{B}\rVert_{2} between modality means as the direct modality-gap measure, complemented by alignment lift (paired minus random-pair mean cosine) and the UMAP geometry of Figure 4.
We also report cross-modal Recall@1 in both directions on the multi-caption MS-COCO protocol (image→\rightarrowtext and text→\rightarrowimage; for audio, audio→\rightarrowtext and text→\rightarrowaudio) as a coupling signal — these directions probe whether matched pairs are retrievable across modalities, not the modality gap itself, which would require a mixed-modality target pool (e.g. text→\rightarrow{text, image}).
Between-model R@11 differences carry confidence intervals from a paired bootstrap (2,0002{,}000 resamples) over per-query correctness; these CIs are tabulated alongside the headline R@11 values in Table 3.
All measurements use the retrieval task-specific variants; classification, clustering, and text-matching variants carry different LoRA adapters and shift the absolute cosines.

Table 3. Modality geometry and retrieval across omni embedding models on MS-COCO (image–text, I-T, 2,0002{,}000 images ×\times 55 captions) and Clotho v2 (audio–text, A-T, 1,0451{,}045 audio ×\times 11 caption). →\rightarrow denotes primary →\rightarrow text retrieval (image→\rightarrowtext / audio→\rightarrowtext); ←\leftarrow denotes text →\rightarrow primary. All cosines are between L2L_{2}-normalised embeddings. Lift is paired minus random-pair mean cosine. R@11 in percent. Rows are ordered by mean R@11 across directions within each pair. Bold marks the column winner per pair.

Model
Pair
Params
Cent. L2L_{2}
Paired
Lift
R@1→1\,\rightarrow
R@1←1\,\leftarrow

LCO-Omni-7B
I-T
8.938.93B
0.46
0.55
0.42
74.0
63.6

LCO-Omni-3B
I-T
3.73.7B
0.43
0.57
0.41
71.6
58.0

jina-embeddings-v5-omni-small-retrieval
I-T
1.571.57B
0.71
0.40
0.30
68.0
57.0

jina-embeddings-v5-omni-nano-retrieval
I-T
0.950.95B
0.54
0.35
0.25
36.6
27.7

Omni-Embed-Nemotron-3B
I-T
4.74.7B
0.92
0.35
0.14
23.1
01.4

LCO-Omni-7B
A-T
8.938.93B
0.39
0.56
0.28
27.5
29.8

LCO-Omni-3B
A-T
3.73.7B
0.39
0.56
0.27
24.5
28.5

jina-embeddings-v5-omni-small-retrieval
A-T
1.571.57B
0.64
0.32
0.17
16.3
15.2

jina-embeddings-v5-omni-nano-retrieval
A-T
0.950.95B
0.63
0.29
0.14
14.1
14.8

Omni-Embed-Nemotron-3B
A-T
4.74.7B
0.56
0.53
0.11
10.1
09.6

Paired-bootstrap (2,0002{,}000 resamples) 95%95\% CIs for R@11 differences vs. jina-embeddings-v5-omni-small-retrieval.
Image–text: vs. LCO-Omni-3B image→\rightarrowtext [−5.8,−1.3][-5.8,-1.3], text→\rightarrowimage [−2.0,+0.0][-2.0,+0.0]; vs. LCO-Omni-7B image→\rightarrowtext [−8.2,−3.9][-8.2,-3.9], text→\rightarrowimage [−7.6,−5.7][-7.6,-5.7].
Audio–text: vs. LCO-Omni-7B audio→\rightarrowtext [−14.3,−8.2][-14.3,-8.2], text→\rightarrowaudio [−17.4,−11.7][-17.4,-11.7].

Six-panel UMAP grid comparing modality clustering across omni embedding models.

Figure 4. 2D UMAP of embeddings on 8080 parallel MSR-VTT clips per model.
Each row of source data contributes four embeddings (image: middle frame; video: full clip; audio: extracted track; text: caption); colours mark modalities.
UMAP is fit per model on its own 320320 (80×480\times 4) points (cosine metric, n_neighbors=1515, min_dist=0.10.1, random_state=4242).
LanguageBind’s frozen per-modality towers produce the canonical modality-gap pattern; the unified-decoder omni models, including the frozen-tower jina-embeddings-v5-omni-small and jina-embeddings-v5-omni-nano, produce interleaved geometry.Six-panel UMAP grid comparing modality clustering across omni embedding models.

Image–text.

The LCO-Embedding family leads on MS-COCO Karpathy: LCO-Omni-7B (8.938.93B) at image→\rightarrowtext R@1=74.0%1=74.0\% / text→\rightarrowimage 63.6%63.6\%, LCO-Omni-3B (3.73.7B) at 71.6%71.6\% / 58.0%58.0\% (Table 3).
Our jina-embeddings-v5-omni-small variant (1.571.57B, frozen-tower) sits in third place at 68.0%68.0\% / 57.0%57.0\%, statistically indistinguishable from LCO-Omni-3B on text→\rightarrowimage at the edge of significance, trailing it by 3.6%3.6\% on image→\rightarrowtext and trailing LCO-Omni-7B by 66–7%7\% in both directions; paired-bootstrap 95%95\% confidence intervals are tabulated in the Table 3 footnote.
At 18%18\% the parameter count of LCO-Omni-7B and 42%42\% of LCO-Omni-3B, the frozen-tower design closes most of the omni gap in both directions.
The jina-embeddings-v5-omni-nano variant (0.950.95B) trails the leaders at 36.6%36.6\% / 27.7%27.7\%, and Omni-Embed-Nemotron-3B (4.74.7B, co-trained) collapses to 23.1%23.1\% / 1.4%1.4\%. The low score for Omni-Embed-Nemotron-3B is evidence that parameter count alone does not determine outcome on this axis.

Audio–text.

The LCO-Embedding family leads for this modality as well: LCO-Omni-7B at 27.5%27.5\% / 29.8%29.8\%, LCO-Omni-3B at 24.5%24.5\% / 28.5%28.5\% (Table 3).
Our jina-embeddings-v5-omni-small variant reaches 16.3%16.3\% / 15.2%15.2\%, trailing LCO-Omni-7B by 1111–15%15\% and LCO-Omni-3B by 88–13%13\%; the jina-embeddings-v5-omni-nano variant lands a further 2%2\% below.
Omni-Embed-Nemotron-3B again underperforms at 10.110.1 / 9.6%9.6\% despite being the second-largest model in the table.
Critically, the gap between the jina-embeddings-v5-omni-small variant and LCO-Omni-7B is markedly larger on the audio pair (∼\sim1111–15%15\% absolute) than on the image pair (∼\sim66–7%7\%), under conditions where the centroid distance and paired cosines are within range across all five rows, suggesting the audio bridge into the text-aligned subspace is the weaker of the two projector paths.

Embedding-space geometry across all four modalities.

Figure 4 adds a complementary visual view: a 2D UMAP of 8080 parallel MSR-VTT clips (extracted middle frame, full clip, audio track, and caption), encoded by each model in its natural retrieval protocol.
Three qualitatively distinct patterns appear.
LanguageBind – the fourth omni-style baseline of Table 4, with separate per-modality CLIP-style towers bound to a shared text encoder – shows the canonical modality-gap pattern from (Liang et al., 2022): Each modality collapses into a tight, disjoint cluster, with sharp boundaries between them.
Omni-Embed-Nemotron-3B is intermediate. Text is visibly separated from the three other modalities, which themselves overlap somewhat.
The unified-decoder LCO-Omni models and our two frozen-tower jina-embeddings-v5-omni-small and jina-embeddings-v5-omni-nano variants produce broadly interleaved geometry: image, video, audio, and text co-mingle in the same neighborhood with substantial overlap, consistent with a single shared embedding space across all four input types rather than four pre-aligned cones.
This geometric picture explains the retrieval-margin behavior reported in the table: Well-mixed clusters have a smaller average modality-cluster offset (lower centroid distance), but their paired-pair coupling also has to compete with same-modality distractions, which is part of why the within-modality R@11 gaps remain visible.

Table 4. Main benchmark results.
Bold numeric cells mark the row winner among jina-embeddings-v5-omni-nano, jina-embeddings-v5-omni-small, and the strongest open-weight baseline model; bold row labels are benchmark or slice aggregates, and indented rows are task-type averages.
The “Strongest open-weight baseline” column is an orientation point, not a unified controlled ladder.

Benchmark / task type

#Tasks
Nano (0.95 B)
Small (1.57 B)

Strongest open-weight baseline

Params (B)
Score

MIEB Light (Image)

51
44.24
55.01

LCO-Embedding-Omni-3B

4.07
61.63

Image classification

15
44.12
64.12

LCO-Embedding-Omni-3B

4.07
59.07

Compositional / vision QA

11
38.85
47.61

LCO-Embedding-Omni-3B

4.07
52.00

Image clustering

2
60.46
83.18

LCO-Embedding-Omni-3B

4.07
73.19

Visual STS

4
65.92
74.25

royokong/e5-v

8.36
63.73

Retrieval

13
25.95
31.63

LCO-Embedding-Omni-3B

4.07
83.44

Document retrieval

6
74.21
74.25

LCO-Embedding-Omni-3B

4.07
72.99

MIEB (Image)

125
47.87
58.00

siglip-so400m-patch14-384

0.88
60.69

Image classification

45
53.26
68.99

LCO-Embedding-Omni-3B

4.07
64.30

Compositional / vision QA

13
40.18
49.48

LCO-Embedding-Omni-3B

4.07
53.40

Image clustering

5
72.28
86.01

LCO-Embedding-Omni-3B

4.07
83.24

Visual STS

7
75.92
81.74

LCO-Embedding-Omni-3B

4.07
79.62

Retrieval

45
30.66
37.95

LCO-Embedding-Omni-3B

4.07
46.29

Document retrieval

10
79.25
79.25

Omni-Embed-Nemotron-3B

4.70
85.64

MIEB Multilingual only (Image)

5
48.19
63.75

LCO-Embedding-Omni-3B

4.07
69.04

Visual STS

2
53.95
65.12

LCO-Embedding-Omni-3B

4.07
79.62

Retrieval

3
44.35
62.83

LCO-Embedding-Omni-3B

4.07
61.99

MMEB-Video (Video)

18
29.73
39.83

Qwen3-VL-Embedding-8B

8.14
67.15

V-CLS (classification)

5
27.85
42.73

Qwen3-VL-Embedding-8B

8.14
78.39

V-QA (question answering)

5
39.03
44.52

WeMM-Embedding-8B

8.77
71.66

V-RET (retrieval)

5
14.33
27.82

Qwen3-VL-Embedding-8B

8.14
58.73

V-MRET (moment retrieval)

3
43.02
47.20

Qwen3-VL-Embedding-8B

8.14
56.09

MAEB (Audio)

30
49.69
49.96

LCO-Embedding-Omni-7B

8.93
52.37

Retrieval / reranking

10
53.35
53.22

LCO-Embedding-Omni-7B

8.93
61.67

Classification / zero-shot

14
53.04
53.71

LCO-Embedding-Omni-7B

8.93
53.39

Text matching

3
65.56
65.38

LCO-Embedding-Omni-7B

8.93
67.30

Clustering

3
5.96
6.13

clap-htsat-fused

0.15
22.74

MIEB rows use the current MTEB benchmark task composition (MIEB Light 51 tasks, MIEB full 125 tasks, MIEB Multilingual-only 5 tasks). MMEB-Video uses the full 1818-task suite, including MomentSeeker.

Figure 5. XM3600 image-language comparison.
Tiles show jina-v5-omni-small; color is deviation from a five-model language mean.XM3600 language tiles for jina-v5-omni-small compared with Nano, LanguageBind, LCO-3B, and Nem-3B; LCO-7B is discussed by aggregate score.

Figure 6. Per-language audio retrieval.
Tiles show jina-v5-omni-small on shared CommonVoiceMini21/FLEURS languages; color is deviation from the mean of the baseline models.Audio language tiles for jina-v5-omni-small compared with Nano, LCO-3B, Nem-3B, and LanguageBind Audio across the shared CommonVoiceMini21/FLEURS languages.

## 6. Ablation Studies

The architecture described in Section 3 rests on two design choices: which projector layers to train and whether to update an encoder.
This section uses ablation studies to investigate those choices for GELATO.

### 6.1. Trainable Parameters

The released recipe trains only the second fully connected layer of the vision projector (fc_vision_2) and the single linear audio projector (fc_audio).
This subsection asks whether widening the trainable set — adding fc_vision_1, unfreezing the vision or audio encoder, or running a two-stage continuation — yields enough improvement to justify the extra parameters and training stages for every task-specific checkpoint.
We sweep five vision configurations (§6.1.1) and three audio configurations (§6.1.2).

Setup.

Runs in this subsection start from jina-embeddings-v5-omni-small-retrieval, use global batch 128128 (3232 per rank ×\times 4×4\timesH100), and run for 5 0005\,000 optimizer steps.
Image ablations use a fast MIEB subset—CIRR-IT2I and NIGHTS-I2I retrieval.
Audio ablations use an 8-task MAEB subset.
For these experiments, the primary trainable projector is randomly initialized at load time: fc_vision_2 for vision runs and fc_audio for audio runs.
The remaining layers (encoder, LayerNorm, fc_vision_1) retain their pretrained initialization values.

6.1.1. Vision

We tested which parts of the Qwen3.5 vision stack to train, keeping the rest frozen, evaluating five configurations.

- I 

fc_vision_2 only, lr 2⋅10−42{\cdot}10^{-4} (our configuration).

- II 

fc_vision_1 + fc_vision_2, lr 2⋅10−42{\cdot}10^{-4}; fc_vision_1 stays at the Qwen3.5 initialization, fc_vision_2 is reset.

- III 

fc_vision_1 + fc_vision_2 + vision encoder, lr 1⋅10−51{\cdot}10^{-5} (dropped 20×20\times because the encoder is unfrozen).

- IV 

I, then fc_vision_1 + fc_vision_2, continuing from the stage-I checkpoint.

- V 

I, then fc_vision_1 + fc_vision_2 + vision encoder, continuing from the stage-I checkpoint.

Runs I–III are single-stage ablations from the same reset fc_vision_2. Runs IV and V are two-stage continuations that first train run I and then unfreeze additional layers for a second 5 0005\,000-step stage.

Figure 7. Vision ablation tests on CIRR-IT2I and NIGHTS-I2I.
PRO is fc_vision_2, PRO1/2 is fc_vision_1+fc_vision_2, ViT is the vision encoder, and V adds only 0.0010.001 over I.

Result:

Figure 7 displays the results of these tests.
The fc_vision_2-only recipe (I) is sufficient: it reaches 0.1580.158, while training fc_vision_1 from the start (II) ends slightly lower at 0.1530.153.
Unfreezing the encoder from step 00 (III) is clearly harmful, ending at 0.0790.079.
The two-stage variants test whether I should be followed by a broader continuation stage.
Continuing with fc_vision_1+fc_vision_2 (IV) does not improve the checkpoint, and the broader continuation with the encoder unfrozen (V) reaches only 0.1590.159, an absolute gain of 0.0010.001 over I on this 2-task subset.
Run III’s collapse to 0.0790.079 is visible already early in training as a monotone decrease from the shared initial point, indicating that the vision encoder is destabilized as soon as it receives gradients from a randomly initialized fc_vision_2; even the 20×20\times-reduced learning rate is not enough to prevent the drift when the projector itself has not yet converged.
Runs IV and V remain near the stage-I plateau throughout their continuation, so the small numerical differences among I, IV, and V at step 5 0005\,000 reflect noise around a basin the projector-only recipe already reached rather than a continued ascent.
That gain is too small to justify a production recipe with an additional continuation stage and extra task-specific adapter/projector artifacts for all four variants of each model size, so the released configuration keeps the simpler frozen-tower choice: train fc_vision_2 and leave fc_vision_1, the vision encoder, and inherited LoRA adapters fixed.

6.1.2. Audio

We then tested which parts of the Qwen2.5-Omni audio stack to train, keeping the rest frozen, evaluating three configurations.

- I 

fc_audio only, lr 2⋅10−42{\cdot}10^{-4} (our configuration).

- II 

fc_audio + audio encoder, lr 1⋅10−51{\cdot}10^{-5}; starting from the reset projector.

- III 

I, then fc_audio + audio encoder, continuing from the final I checkpoint, lr 1⋅10−51{\cdot}10^{-5}.

Runs I and II are single-stage ablations from the same reset fc_audio. Run III is a two-stage continuation that first trains run I and then unfreezes the audio encoder for a second 5 0005\,000-step stage.

Figure 8. Audio ablation tests on UrbanSound8K, CommonVoiceMini21, MACS, GigaSpeech, SpokenSQuAD, Clotho, JamAlt Artist, and JamAlt Lyric.
PRO is fc_audio, AUD is the audio encoder, and III adds about 0.0220.022 over I.

Result:

Figure 8 displays the results of these tests.
The fc_audio-only recipe (I) is sufficient for this budget: it reaches 0.3980.398, while unfreezing the audio encoder from step 00 (II) ends lower at 0.3670.367.
The two-stage variant tests whether I should be followed by a broader continuation stage.
Continuing with fc_audio+audio encoder (III) reaches 0.4190.419, an absolute gain of 0.0220.022 over I.
Runs I and II diverge within the first ∼\sim1 0001\,000 steps as the audio encoder begins drifting away from its Qwen2.5-Omni initialization under gradients from a randomly initialized fc_audio; the curve then plateaus at a lower level than I and does not recover, mirroring the vision-encoder failure mode of run III in Figure 7.
Run III by construction tracks run I through step 5 0005\,000 and only diverges in the continuation stage, where the +0.022+0.022 lift accumulates gradually rather than as an abrupt jump — consistent with steady encoder adaptation from an already-converged projector at a 20×20\times-reduced learning rate, rather than a one-off alignment correction at the stage boundary.
We therefore keep the released recipe frozen for simplicity, while treating audio-encoder adaptation as a promising future training stage.

This converges with the audio–text geometry analysis (§5.2): the larger LCO baselines maintain a ∼\sim1111–15%15\% lead over the Small variant on Clotho cross-modal retrieval, and MAEB clustering in Table 4 shows the Small variant at 6.136.13 versus the audio-text specialist laion/clap-htsat-fused (0.190.19B) at 22.7422.74 — consistent with the linear fc_audio bridge discarding intra-modal variance that audio-only K-means relies on.
The single fc_audio projection is therefore the natural next target for additional trainable parameters, and the +0.022+0.022 MAEB gain from run III suggests that a budgeted audio-encoder continuation is a promising direction for the next model release.

### 6.2. Matryoshka Preservation Across Modalities

Figure 9. Matryoshka prefix tests across modalities.
Curves show mean nDCG@10; line style indicates modality and color shade indicates model size.
Line chart of mean nDCG@10 versus Matryoshka truncation dimension for text, image, audio, and video retrieval, with small and nano curves for each modality.

Figure 9 shows Matryoshka performance under embedding truncation. Image embeddings behave similarly to text ones: both jina-embeddings-v5-omni-small and jina-embeddings-v5-omni-nano lose roughly 0.180.18–0.210.21 nDCG@10 when truncated to 3232 dimensions. Audio also preserves most of its score at 256256 dimensions, while video degrades much more heavily at small dimensions, indicating weaker Matryoshka preservation for video embeddings.
The curves are near-flat from full dimension down to roughly 128128, with degradation only becoming visible below 6464; the Matryoshka loss therefore appears to keep most retrieval-relevant information in the first nibble of the embedding for image, text, and audio.
The text and image curves overlap almost exactly at every truncation level for a given model size, indicating that the linear fc_vision_2 projection inherits the prefix structure of the frozen Jina Embeddings v5 Text encoder rather than introducing its own scale-dependent loss.
The video curve diverges from the others well before 6464 dimensions and crosses below half its full-dimension score around 3232, suggesting that aggregating multi-frame information into a single embedding exhausts the residual capacity of the early prefix dimensions faster than the single-frame image case.
The Small and Nano curves for each modality track each other closely under truncation, so the released Matryoshka schedule transfers across both model sizes despite their different embedding widths (10241024 vs. 768768) and projector parameter counts.

### 6.3. Training Efficiency

This ablation test measures the efficiency gained by GELATO compared to full training.
Table 5 shows that projector training makes vision runs 1.8×1.8\times faster and audio runs 3.23.2–3.9×3.9\times faster at the 1515k-step budget, with lower peak GPU memory in every case.

Table 5. Training throughput and peak GPU memory.

Setting

Scope

Updated paramsa
s/step
Peak mem.
1515k steps

jina-embeddings-v5-omni-small

Vision

Projector

4.204.20M
0.4130.413
7.527.52 GiB
103.3103.3 min

Vision

Full

920.6920.6M
0.7520.752
12.9612.96 GiB
188.0188.0 min

Audio

Projector

1.311.31M
0.6170.617
6.066.06 GiB
154.3154.3 min

Audio

Full

1232.11232.1M
1.9891.989
19.5319.53 GiB
497.3497.3 min

jina-embeddings-v5-omni-nano

Vision

Projector

2.362.36M
0.1810.181
6.946.94 GiB
45.245.2 min

Vision

Full

311.6311.6M
0.3290.329
10.0210.02 GiB
82.382.3 min

Audio

Projector

0.980.98M
0.4470.447
5.775.77 GiB
111.7111.7 min

Audio

Full

847.8847.8M
1.7641.764
16.0816.08 GiB
440.9440.9 min

a Parameters that actually receive updates. In projector scope these are the trained projector weights (fc_vision_2 or fc_audio) plus the modality-delimiter token rows; the token-embedding matrix is held in the optimizer with gradients masked to those rows, so its remaining rows do not change but its optimizer state is included in peak memory.

## 7. Conclusion

We introduce GELATO, a novel approach to constructing multimodal embedding models by connecting frozen pre-trained modality-specific encoders directly to a frozen text embedding model via compact and easily trained projectors.
The result of this research, the jina-embeddings-v5-omni model suite, is also presented.
These models add vision and audio to the Jina Embeddings v5 Text models, yielding a competitive set of models for broad cross-modality applications.
Using GELATO, text-only embedding models that were never trained on vision or audio can be extended to photos, documents, video, speech, music, and sounds by training a single projector layer per modality while preserving text-only performance.

jina-embeddings-v5-omni-small is the best-performing open-weight embedding model below 22B parameters that supports text, audio, images, and video.
Against a baseline of comparable models, including modality-specific and VLM-derived embedders, it is particularly strong on visual document retrieval.
jina-embeddings-v5-omni-small and jina-embeddings-v5-omni-nano extend completely different text embedding models with different backbone architectures, suggesting that GELATO is an extensible strategy with broad application, outside of the jina-embeddings-v5-omni suite and for additional modalities.
This is a potential subject for future research.

The ablations suggest that projector-only alignment can serve as a compatibility-preserving initialization for rich multimodal training.
Future work will investigate the choice of non-text encoders, which is inadequately explored in this paper.
Furthermore, an investigation of training options under different conditions is indicated, like jointly training projectors for multiple modalities together.
We also note that jina-embeddings-v5-omni is comparatively closer to the baselines on moment retrieval than on the other video sub-tasks, but overall video performance remains weak.
We hope to improve performance in this area in future models.

## References

      
- Akram et al. (2026)

Mohammad Kalim Akram, Saba
Sturua, Nastia Havriushenko, Quentin
Herreros, Michael Günther, Maximilian
Werk, and Han Xiao. 2026.

jina-embeddings-v5-text: Task-Targeted Embedding
Distillation.

arXiv:2602.15547 [cs.CL]

https://arxiv.org/abs/2602.15547

      
- Alibaba Tongyi Lab (2024)

Alibaba Tongyi Lab.
2024.

gte-Qwen2: General Text Embeddings Based on
Qwen2.

Hugging Face model collection.

https://huggingface.co/collections/Alibaba-NLP/gte-qwen2

      
- Bai et al. (2025)

Shuai Bai, Yuxuan Cai,
Ruizhe Chen, Keqin Chen,
Xionghui Chen, Zesen Cheng,
Lianghao Deng, Wei Ding,
Chang Gao, Chunjiang Ge,
Wenbin Ge, Zhifang Guo,
Qidong Huang, Jie Huang,
Fei Huang, Binyuan Hui,
Shutong Jiang, Zhaohai Li,
Mingsheng Li, Mei Li,
Kaixin Li, Zicheng Lin,
Junyang Lin, Xuejing Liu,
Jiawei Liu, Chenglong Liu,
Yang Liu, Dayiheng Liu,
Shixuan Liu, Dunjie Lu,
Ruilin Luo, Chenxu Lv,
Rui Men, Lingchen Meng,
Xuancheng Ren, Xingzhang Ren,
Sibo Song, Yuchong Sun,
Jun Tang, Jianhong Tu,
Jianqiang Tu, Jianqiang Wan,
Peng Wang, Pengfei Wang,
Qiuyue Wang, Yuxuan Wang,
Tianbao Xie, Yiheng Xu,
Haiyang Xu, Jin Xu,
Zhibo Yang, Mingkun Yang,
Jianxin Yang, An Yang,
Bowen Yu, Fei Zhang,
Hang Zhang, Xi Zhang, Bo
Zheng, Humen Zhong, Jingren Zhou,
Fan Zhou, Jing Zhou,
Yuanzhi Zhu, and Ke Zhu.
2025.

Qwen3-VL Technical Report.

arXiv:2511.21631 [cs.CV]

https://arxiv.org/abs/2511.21631

      
- Chen et al. (2026)

Haonan Chen, Sicheng Gao,
Radu Timofte, Tetsuya Sakai, and
Zhicheng Dou. 2026.

e5-omni: Explicit Cross-modal Alignment for
Omni-modal Embeddings.

arXiv:2601.03666 [cs.CL]

https://arxiv.org/abs/2601.03666

      
- Chen et al. (2025)

Yitong Chen, Lingchen
Meng, Wujian Peng, Zuxuan Wu, and
Yu-Gang Jiang. 2025.

CoMP: Continual Multimodal Pre-training for Vision
Foundation Models.

arXiv:2503.18931 [cs.CV]

https://arxiv.org/abs/2503.18931

      
- Chu et al. (2025)

Yunfei Chu, Jin Xu,
Xiaohuan Zhou, Qian Yang,
Haojie Zhang, Zhijie Gu,
Yuxuan Zhou, Jingren Zhou,
Junyang Lin, and Chang Zhou.
2025.

Qwen2.5-Omni Technical Report.

arXiv:2503.20215 [cs.CL]

https://arxiv.org/abs/2503.20215

      
- El Assadi et al. (2026)

Adnan El Assadi, Isaac
Chung, Chenghao Xiao, Roman Solomatin,
Animesh Jha, Rahul Chand,
Silky Singh, Kaitlyn Wang,
Ali Sartaz Khan, Marc Moussa Nasser,
Sufen Fong, Pengfei He,
Alan Xiao, Ayush Sunil Munot,
Aditya Shrivastava, Artem Gazizov,
Niklas Muennighoff, and Kenneth
Enevoldsen. 2026.

MAEB: Massive Audio Embedding Benchmark.

arXiv:2602.16008 [cs.SD]

https://arxiv.org/abs/2602.16008

      
- Elizalde et al. (2023)

Benjamin Elizalde, Soham
Deshmukh, Mahmoud Al Ismail, and
Huaming Wang. 2023.

CLAP Learning Audio Concepts From Natural
Language Supervision. In IEEE International
Conference on Acoustics, Speech and Signal Processing.
1–5.

      
- Enevoldsen et al. (2025)

Kenneth Enevoldsen, Isaac
Chung, Imene Kerboua, Márton Kardos,
Ashwin Mathur, David Stap,
Jay Gala, Wissam Siblini,
Dominik Krzemiński, Genta Indra
Winata, Saba Sturua, Saiteja Utpala,
Mathieu Ciancone, Marion Schaeffer,
Gabriel Sequeira, Diganta Misra,
Shreeya Dhakal, Jonathan Rystrøm,
Roman Solomatin, Ömer
Çağatan, Akash Kundu, Martin
Bernstorff, Shitao Xiao, Akshita
Sukhlecha, Bhavish Pahwa, Rafał
Poświata, Kranthi Kiran GV, Shawon
Ashraf, Daniel Auras, Björn
Plüster, Jan Philipp Harries,
Loïc Magne, Isabelle Mohr,
Mariya Hendriksen, Dawei Zhu,
Hippolyte Gisserot-Boukhlef, Tom Aarsen,
Jan Kostkan, Konrad Wojtasik,
Taemin Lee, Marek Šuppa,
Crystina Zhang, Roberta Rocca,
Mohammed Hamdy, Andrianos Michail,
John Yang, Manuel Faysse,
Aleksei Vatolin, Nandan Thakur,
Manan Dey, Dipam Vasani,
Pranjal Chitale, Simone Tedeschi,
Nguyen Tai, Artem Snegirev,
Michael Günther, Mengzhou Xia,
Weijia Shi, Xing Han Lù,
Jordan Clive, Gayatri Krishnakumar,
Anna Maksimova, Silvan Wehrli,
Maria Tikhonova, Henil Panchal,
Aleksandr Abramov, Malte Ostendorff,
Zheng Liu, Simon Clematide,
Lester James Miranda, Alena Fenogenova,
Guangyu Song, Ruqiya Bin Safi,
Wen-Ding Li, Alessia Borghini,
Federico Cassano, Hongjin Su,
Jimmy Lin, Howard Yen,
Lasse Hansen, Sara Hooker,
Chenghao Xiao, Vaibhav Adlakha,
Orion Weller, Siva Reddy, and
Niklas Muennighoff. 2025.

MMTEB: Massive Multilingual Text Embedding
Benchmark.

arXiv:2502.13595 [cs.CL]

https://arxiv.org/abs/2502.13595

      
- Fang et al. (2023)

Yuxin Fang, Wen Wang,
Binhui Xie, Quan Sun,
Ledell Wu, Xinggang Wang,
Tiejun Huang, Xinlong Wang, and
Yue Cao. 2023.

EVA-CLIP: Improved Training Techniques for CLIP
at Scale.

arXiv:2303.15389 [cs.CV]

https://arxiv.org/abs/2303.15389

      
- Girdhar et al. (2023)

Rohit Girdhar, Alaaeldin
El-Nouby, Zhuang Liu, Mannat Singh,
Kalyan Vasudev Alwala, Armand Joulin,
and Ishan Misra. 2023.

ImageBind: One Embedding Space To Bind Them All.
In Proceedings of the IEEE/CVF Conference on
Computer Vision and Pattern Recognition. 15180–15190.

      
- Jiang et al. (2024)

Ting Jiang, Minghui Song,
Zihan Zhang, Haizhen Huang,
Weiwei Deng, Feng Sun,
Qi Zhang, Deqing Wang, and
Fuzhen Zhuang. 2024.

E5-V: Universal Embeddings with Multimodal Large
Language Models.

arXiv:2407.12580 [cs.CL]

https://arxiv.org/abs/2407.12580

      
- Jiang et al. (2025)

Ziyan Jiang, Rui Meng,
Xinyi Yang, Semih Yavuz,
Yingbo Zhou, and Wenhu Chen.
2025.

MMEB: Massive Multi-discipline Multimodal Embedding
Benchmark.

arXiv:2410.05160 [cs.CV]

https://arxiv.org/abs/2410.05160

Introduced with VLM2Vec.

      
- Koukounas et al. (2024a)

Andreas Koukounas,
Georgios Mastrapas, Sedigheh Eslami,
Bo Wang, Mohammad Kalim Akram,
Michael Günther, Isabelle Mohr,
Saba Sturua, Nan Wang, and
Han Xiao. 2024a.

jina-clip-v2: Multilingual Multimodal Embeddings for
Text and Images.

arXiv:2412.08802 [cs.CL]

https://arxiv.org/abs/2412.08802

      
- Koukounas et al. (2024b)

Andreas Koukounas,
Georgios Mastrapas, Michael Günther,
Bo Wang, Scott Martens,
Isabelle Mohr, Saba Sturua,
Mohammad Kalim Akram, Joan
Fontanals Martínez, Saahil Ognawala,
Susana Guzman, Maximilian Werk,
Nan Wang, and Han Xiao.
2024b.

Jina CLIP: Your CLIP Model Is Also Your Text
Retriever.

arXiv:2405.20204 [cs.CL]

https://arxiv.org/abs/2405.20204

      
- Kusupati et al. (2022)

Aditya Kusupati, Ashish
Bhatt, Matthew Wallingford, Aniruddha
Sinha, Vivek Ramanujan, William
Howard-Snyder, Kaifeng Chen, Sham Jain,
and Ali Farhadi. 2022.

Matryoshka Representation Learning. In
Advances in Neural Information Processing
Systems.

      
- Lee et al. (2025)

Chien Van Lee, Rajarshi
Roy, Mengting Xu, Jonathan Raiman,
Mohammad Shoeybi, and Bryan Catanzaro.
2025.

NV-Embed: Improved Techniques for Training LLMs
as Generalist Embedding Models.

arXiv:2412.04252 [cs.CL]

https://arxiv.org/abs/2412.04252

      
- Lewis et al. (2020)

Patrick Lewis, Ethan
Perez, Aleksandra Piktus, Fabio Petroni,
Vladimir Karpukhin, Naman Goyal,
Heinrich Küttler, Mike Lewis,
Wen-tau Yih, Tim Rocktäschel,
Sebastian Riedel, and Douwe Kiela.
2020.

Retrieval-Augmented Generation for
Knowledge-Intensive NLP Tasks. In Advances in
Neural Information Processing Systems, Vol. 33.
9459–9474.

https://proceedings.neurips.cc/paper/2020/hash/6b493230-Abstract.html

      
- Li et al. (2023)

Junnan Li, Dongxu Li,
Silvio Savarese, and Steven Hoi.
2023.

BLIP-2: Bootstrapping Language-Image Pre-training
with Frozen Image Encoders and Large Language Models. In
Proceedings of the International Conference on
Machine Learning, Vol. 202. PMLR,
19730–19742.

      
- Li et al. (2026)

Mingxin Li, Yanzhao
Zhang, Dingkun Long, Keqin Chen,
Sibo Song, Shuai Bai,
Zhibo Yang, Pengjun Xie,
An Yang, Dayiheng Liu,
Jingren Zhou, and Junyang Lin.
2026.

Qwen3-VL-Embedding and Qwen3-VL-Reranker: A
Unified Framework for State-of-the-Art Multimodal Retrieval and Ranking.

arXiv:2601.04720 [cs.CL]

https://arxiv.org/abs/2601.04720

      
- Liang et al. (2022)

Weixin Liang, Yuhui
Zhang, Yongchan Kwon, Serena Yeung,
and James Zou. 2022.

Mind the Gap: Understanding the Modality Gap in
Multi-modal Contrastive Representation Learning. In
Advances in Neural Information Processing
Systems, Vol. 35. Curran Associates,
Inc., New Orleans, LA, USA,
17612–17625.

arXiv:2203.02053 [cs.LG]

https://arxiv.org/abs/2203.02053

      
- Liu et al. (2023)

Haotian Liu, Chunyuan Li,
Qingyang Wu, and Yong Jae Lee.
2023.

Visual Instruction Tuning. In
Advances in Neural Information Processing
Systems, Vol. 36.

      
- Loshchilov and Hutter (2019)

Ilya Loshchilov and
Frank Hutter. 2019.

Decoupled Weight Decay Regularization. In
International Conference on Learning
Representations.

      
- Macé et al. (2025)

Quentin Macé,
António Loison, and Manuel Faysse.
2025.

ViDoRe Benchmark V2: Raising the Bar for Visual
Retrieval.

arXiv:2505.17166 [cs.IR]

https://arxiv.org/abs/2505.17166

      
- Nussbaum et al. (2024)

Zach Nussbaum, Brandon
Duderstadt, and Andriy Mulyar.
2024.

Nomic Embed Vision: Expanding the Latent Space.

arXiv:2406.18587 [cs.CV]

https://arxiv.org/abs/2406.18587

      
- Qwen Team (2026)

Qwen Team.
2026.

Qwen3.5: Towards Native Multimodal Agents.

https://qwen.ai/blog?id=qwen3.5

      
- Radford et al. (2021)

Alec Radford, Jong Wook
Kim, Chris Hallacy, Aditya Ramesh,
Gabriel Goh, Sandhini Agarwal,
Girish Sastry, Amanda Askell,
Pamela Mishkin, Jack Clark,
Gretchen Krueger, and Ilya Sutskever.
2021.

Learning Transferable Visual Models From Natural
Language Supervision. In International Conference
on Machine Learning, Vol. 139. PMLR,
8748–8763.

      
- Radford et al. (2023)

Alec Radford, Jong Wook
Kim, Tao Xu, Greg Brockman,
Christine McLeavey, and Ilya
Sutskever. 2023.

Robust Speech Recognition via Large-Scale Weak
Supervision. In International Conference on
Machine Learning, Vol. 202. PMLR,
28492–28518.

      
- Reimers and Gurevych (2019)

Nils Reimers and Iryna
Gurevych. 2019.

Sentence-BERT: Sentence Embeddings using Siamese
BERT-Networks. In Proceedings of the 2019
Conference on Empirical Methods in Natural Language Processing.
Association for Computational Linguistics,
3982–3992.

      
- Shi et al. (2016)

Wenzhe Shi, Jose
Caballero, Ferenc Huszár, Johannes
Totz, Andrew P. Aitken, Rob Bishop,
Daniel Rueckert, and Zehan Wang.
2016.

Real-Time Single Image and Video Super-Resolution
Using an Efficient Sub-Pixel Convolutional Neural Network. In
Proceedings of the IEEE Conference on Computer
Vision and Pattern Recognition. 1874–1883.

https://openaccess.thecvf.com/content_cvpr_2016/html/Shi_Real-Time_Single_Image_CVPR_2016_paper.html

      
- Tang et al. (2026)

Changli Tang, Qinfan
Xiao, Ke Mei, Tianyi Wang,
Fengyun Rao, and Chao Zhang.
2026.

WAVE: Learning Unified and Versatile Audio-Visual
Embeddings with Multimodal LLM. In International
Conference on Learning Representations.

https://openreview.net/forum?id=MiV3WXDYJb

      
- Tschannen et al. (2025)

Michael Tschannen, Alexey
Gritsenko, Xiao Wang, Muhammad Ferjad
Naeem, Ibrahim Alabdulmohsin, Nikhil
Parthasarathy, Talfan Evans, Lucas
Beyer, Ye Xia, Basil Mustafa,
Olivier Hénaff, Jeremiah Harmsen,
Andreas Steiner, and Xiaohua Zhai.
2025.

SigLIP 2: Multilingual Vision-Language Encoders with
Improved Semantic Understanding, Localization, and Dense Features.

arXiv:2502.14786 [cs.CV]

https://arxiv.org/abs/2502.14786

      
- Wang et al. (2024b)

Liang Wang, Nan Yang,
Xiaolong Huang, Binxing Jiao,
Linjun Yang, Daxin Jiang,
Rangan Majumder, and Furu Wei.
2024b.

Multilingual E5 Text Embeddings: A Technical
Report.

arXiv:2402.05672 [cs.CL]

https://arxiv.org/abs/2402.05672

      
- Wang et al. (2024a)

Peng Wang, Shuai Bai,
Sinan Tan, Shijie Wang,
Zhihao Fan, Jinze Bai,
Keqin Chen, Xuejing Liu,
Jialin Wang, Wenbin Ge,
Yang Fan, Kai Dang,
Mengfei Du, Xuancheng Ren,
Rui Men, Dayiheng Liu,
Chang Zhou, Jingren Zhou, and
Junyang Lin. 2024a.

Qwen2-VL: Enhancing Vision-Language Model’s
Perception of the World at Any Resolution.

arXiv:2409.12191 [cs.CV]

https://arxiv.org/abs/2409.12191

      
- Xiao et al. (2025a)

Chenghao Xiao, Hou Pong
Chan, Hao Zhang, Weiwen Xu,
Mahani Aljunied, and Yu Rong.
2025a.

Scaling Language-Centric Omnimodal Representation
Learning.

arXiv:2510.11693 [cs.CL]

https://arxiv.org/abs/2510.11693

      
- Xiao et al. (2025b)

Chenghao Xiao, Isaac
Chung, Imene Kerboua, Jamie Stirling,
Xin Zhang, Márton Kardos,
Roman Solomatin, Noura Al Moubayed,
Kenneth Enevoldsen, and Niklas
Muennighoff. 2025b.

MIEB: Massive Image Embedding Benchmark.

arXiv:2504.10471 [cs.CV]

https://arxiv.org/abs/2504.10471

      
- Yu et al. (2025)

Shi Yu, Chaoyue Tang,
Bokai Xu, Junbo Cui,
Junhao Ran, Yukun Yan,
Zhenghao Liu, Shuo Wang,
Xu Han, Zhiyuan Liu, and
Maosong Sun. 2025.

VisRAG: Vision-based Retrieval-augmented
Generation on Multi-modality Documents. In
International Conference on Learning
Representations.

https://openreview.net/forum?id=zG459X3Xge

      
- Zhai et al. (2023)

Xiaohua Zhai, Basil
Mustafa, Alexander Kolesnikov, and
Lucas Beyer. 2023.

Sigmoid Loss for Language Image Pre-Training. In
Proceedings of the IEEE/CVF International
Conference on Computer Vision. 11975–11986.

      
- Zhai et al. (2022)

Xiaohua Zhai, Xiao Wang,
Basil Mustafa, Andreas Steiner,
Daniel Keysers, Alexander Kolesnikov,
and Lucas Beyer. 2022.

LiT: Zero-Shot Transfer With Locked-image Text
Tuning. In Proceedings of the IEEE/CVF Conference
on Computer Vision and Pattern Recognition. 18123–18133.

      
- Zhang et al. (2025)

Xin Zhang, Yanzhao Zhang,
Wen Xie, Mingxin Li,
Ziqi Dai, Dingkun Long,
Pengjun Xie, Meishan Zhang,
Wenjie Li, and Min Zhang.
2025.

GME: Improving Universal Multimodal Retrieval by
Multimodal LLMs.

arXiv:2412.16855 [cs.CL]

https://arxiv.org/abs/2412.16855

Includes gme-Qwen2-VL checkpoints.

      
- Zhou et al. (2024a)

Junjie Zhou, Zheng Liu,
Shitao Xiao, Bo Zhao, and
Yongping Xiong. 2024a.

VISTA: Visualized Text Embedding For Universal
Multi-Modal Retrieval.

arXiv:2406.04292 [cs.IR]

https://arxiv.org/abs/2406.04292

      
- Zhou et al. (2024b)

Tianshuo Zhou, Sen Mei,
Xinze Li, Zhenghao Liu,
Chenyan Xiong, Zhiyuan Liu,
Yu Gu, and Ge Yu.
2024b.

MARVEL: Unlocking the Multi-Modal Capability of
Dense Retrieval via Visual Module Plugin.

arXiv:2310.14037 [cs.IR]

https://arxiv.org/abs/2310.14037

    

  
    Experimental support, please
    view the build logs
    for errors. Generated by
    
      
        L
        A
        T
        E
      
      xml
      
    .
  
  
    
## Instructions for reporting errors

    We are continuing to improve HTML versions of papers, and your feedback helps enhance accessibility and mobile
      support. To report errors in the HTML that will help us improve conversion and rendering, choose any of the
      methods listed below:

    
      - Click the "Report Issue" (
            
          ) button, located in the page header.
    
    Tip: You can select the relevant text first, to include it in your report.

    Our team has already identified the following issues. We appreciate your time reviewing and reporting rendering errors we
      may not have found yet. Your efforts will help us improve the HTML versions for all readers, because disability
      should not be a barrier to accessing research. Thank you for your continued support in championing open access for
      all.

    Have a free development cycle? Help support accessibility at arXiv! Our collaborators at LaTeXML maintain a list of packages that need conversion, and welcome developer contributions.

  

  
    
      
        We gratefully acknowledge support from
        our major funders,
        member institutions, ,
        and all contributors.
      
      
    

    
      Major funding support from
