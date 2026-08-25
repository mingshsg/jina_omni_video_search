# Original Request (Verbatim)

Captured: 2026-08-25
Source: initial user message + three clarification rounds in the planning conversation.

## Initial message (verbatim)

> I would like to plan and develop a Web site to demostrate jina viedo embedding using jina v5 embedding omni model.
>
> 1. the backend will be an Elastic Serverless instance (config via .env) provisioned with search profile.
> 2. the website you developed can read the uploaded video file and perform embedding and put the correspond embedding information into the Elastic Serverless instance
> 3. this omni model will embed videos so you need to split the video file to multiple so to be able to be embedded with the model with multiparts (chunks)
> 4. the information saved into Elastic as dense vector with meta_data like which file, what location, the chunk is at which mm:ss etc.
> 5. the video file import should support multiple modes: URL, local address and upload. user can select the mode and provide necessary information, program will validate it.
> 6. ideally, we will split the file in 1 minute 4 second per chunk, with 4 second overlapping to upload. if the file is big or high resolution, resize to 720p level.
> 7. the website should provide playback, so user can search for something in the video by text, and then the results will location the movie with location and click to play from that time.
>
> ask me anything if I have missed out and you want to know before you start to plan. when you plan, make sure to put my requirements and your interpretted requirements into requirements/ and your plan to plan/ and your todo to todo/

## Follow-up exchange on the binary size limit (verbatim)

> 我怎么记得用omni的时候上限是75M

> or it is a video embedding, maybe is 10M

Resolution of this point is documented in
[01-interpreted-requirements.md](01-interpreted-requirements.md), section
"Constraint C1".

## Decisions made during clarification

Each item below was presented as a multiple-choice question and answered by the
user. The chosen option is recorded, not paraphrased.

- **Technology stack**: Next.js full stack (App Router, TypeScript, Tailwind),
  invoking ffmpeg from API routes. Chosen over a Python FastAPI backend with a
  separate React frontend.
- **Embedding path**: Elastic Inference Service (EIS) preconfigured endpoint
  `.jina-embeddings-v5-omni-small`. Later amended to a pluggable provider (see
  below) once the size-limit difference between EIS and the direct Jina API
  became clear.
- **Clip payload strategy**: configurable, defaulting to the dual-track approach
  (see next item) rather than sending real-time clips at full quality.
- **Media storage and playback**: application-local media store directory with a
  streaming endpoint that supports HTTP Range requests, so all three import
  modes share one playback experience.
- **UI language**: bilingual Chinese and English, switchable.
- **Proxy strategy under the size cap**: dual track. Every window produces two
  vectors, one from a 32-frame video proxy (no audio) and one from an
  independent low-bitrate audio clip. Text queries can then match either what is
  shown on screen or what is spoken.
- **Chunk granularity**: default 64 s window with 4 s overlap as specified,
  tunable through `.env`, plus a "fine-grained" preset of 10 s / 2 s for
  side-by-side comparison during demos.
- **Provider strategy**: pluggable. EIS is the default; `.env` can switch to the
  direct Jina API, which allows a larger per-input budget.
