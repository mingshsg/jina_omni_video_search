# Plan 13 — Short-recording voice search

Date: 2026-10-02. Status: **implementation authorized and implemented on `codex/voice-search`; scoped validation recorded in todo/52, full acceptance pending**.
Tracker: [todo/52](../todo/52-voice-search-2026-10-02.md).
PR base: `live-video-search` at `db23b8889761f53cb304d147ec2f8fd81cb138a7`.
The original planning PR #1 changed only this plan and its tracker. The subsequent implementation PR adds code and operations documents without index migrations or ingestion changes.

## Integration update — 2026-10-05

Implementation integration is authorized. Branch `codex/voice-search-integration` combines voice-search `e35ba93` with the current enrichment branch `66acc7c`; [todo/59](../todo/59-voice-integration-2026-10-05.md) records the deployment and validation. Keep the current Group auto-Variant selection, scene linking and logos; use shared Modality controls for sample targets and preserve the Sound Sample default. Add 5s identity and Group upload-contract regressions, then verify the rebuilt container with recorded fixtures. Historical acceptance gates remain distinct from this scoped integration.

## Goal and confirmed product decisions

Record a short clip in the browser and retrieve related **video moments**, with their existing timestamps, thumbnails and playback links.

The user confirmed both modes on 2026-10-02, with **Sound Sample as the default when no mode is selected**. Treat the mode as explicit user intent; never infer it from whether speech is present.

| Mode | Example | Processing | Result |
| --- | --- | --- | --- |
| **Sound Sample** (default) | Engine, applause, laughter, or a recorded dialogue excerpt | Embed the recording directly; match existing chunk vectors | Ranked moments; no transcription required |
| **Spoken Request** | “Find a car chase” / “找李政宰的追逐场景” | Transcribe in the original language, let the user edit, submit through existing text search | The same moments and metadata behavior as typing that reviewed text |

Keep mode separate from the **target modality**. Sound Sample searches audio moments by default; the existing page's Modality selector chooses Visual, Audio or All for the recording too. The duplicate Match against control is removed following the user's 2026-10-02 correction. “Find a car chase” in Sound Sample mode is a sound/semantic sample, not automatically a command. Spoken Request makes that distinction visible.

Initial delivery covers the file-video search page. Existing live search remains unchanged. Live voice querying and continuous follow-search are a later scoped extension after file acceptance; they must reuse live session/time/variant filters and have their own contract tests. Exact recording identification, speaker identity, song identification and exact dialogue lookup are outside this feature's acceptance promise.

## Feasibility and inspected baseline

Feasible by composition of existing building blocks, subject to the capability and relevance spike below.

| Inspected code on the PR base | Evidence and consequence |
| --- | --- |
| `lib/embed/types.ts:37-43` | Provider interface already exposes `embedAudio(data, role)` alongside text/image/video. Add a query path rather than changing ingestion. |
| `lib/embed/eis.ts:142-148` | Audio bytes are wrapped as `audio/wav` and sent through the binary inference body. Normalize browser recordings to genuine WAV before calling this adapter. The EIS binary body does **not** use `role` to send a query-task override; audio query behavior needs a real endpoint probe. |
| `lib/embed/jina.ts` and `lib/embed/local.ts` | Both expose audio methods; Jina selects the configured query task. Interface presence does not establish endpoint capability or relevance. |
| `lib/es/search.ts:167-205,521-601` | Image search provides the pattern: eligibility enumeration, one query embedding, explicit vector, shared chunk search, existing hit DTO. Its helpers are private and readiness is conditional; a new audio function must explicitly require ready assets. |
| `lib/es/search-core.ts:3-6,8-36` | `visual`, `audio`, `both` and their hit attribution already exist. Query input modality is distinct from the vector field being searched. Keep `SearchSortBy` unchanged. |
| `lib/ingest/variant.ts` | Variant identity includes provider/model/passage-task/dims/normalization/proxy settings. A current provider vector must never be compared with an incompatible recorded stack. |
| `app/api/search/route.ts`, `lib/es/hybrid-search.ts` | Existing text parsing, facets and hybrid retrieval are the destination for reviewed speech text. Use the same UI submit path; duplicating route orchestration would drift. |

The current enrichment checkout was also inspected (`c9e3b57`), but is **not** part of this PR's base or diff. Its `lib/drama/asr.ts` requires paths/timed subtitle segments; `docs/drama-host-mlx-asr.md` describes a manual host process. Neither is a drop-in interactive voice transcription service. Group-only controls and scene linking also exist there, beyond the base. If those changes land, preserve the active Group filter and existing grouping on voice results. Implement voice ASR independently so merging the drama branch is not a prerequisite.

No chunk re-embedding or mapping migration is expected for compatible existing variants. Videos without indexed audio are absent from the audio-only candidate set; visual and both targets can include visual-only videos. Querying an incompatible variant fails explicitly rather than silently switching providers or mixing variants.

### Planning gate disposition

The tracked base P1s in `todo/22`, `todo/30`, `todo/32` are checked closed. The enrichment checkout has unchecked P1-section entries F1–F4 in `todo/37`; `todo/38` records subsequent fixes and still-owed runtime acceptance. An untracked duplicate `todo/32 … (1).md` also retains a stale open R1, while tracked `todo/32` records its fix. Preserve those records; do not close them based on this planning pass.

The user's explicit request for a new planning PR authorized this document despite AGENTS.md's general freeze on new plans with open P1 trackers. **Implementation was subsequently authorized on 2026-10-02.** Before feature implementation, reconcile tracked P1 dispositions and resolve any genuinely open P1 on the implementation base, with verification evidence. Track that prerequisite in todo/52. This planning PR makes no project-readiness claim.

## Browser experience

**Updated user decision (2026-10-02, implementation):** add a separate **Voice search** navigation tab at `/search-voice`. Reuse the existing file-search experience for controls, moment cards and playback; mount the recording panel on that page. The ordinary Search page keeps its text flow. Use EUI and existing EN/ZH localization. Show two choices, **Sound Sample** selected initially and **Spoken Request** selectable. Initial mode is not restored from storage; a prior spoken-mode session must not change the default on a new panel opening.

State machine: `idle → requesting_permission → recording → preview → processing → results|transcript_review|error`. Cancel/close returns to idle and releases recorder resources. No upload occurs before explicit Search/Transcribe. Recording may continue into preview at the duration cap, but never automatically submits.

1. Start requests `getUserMedia({audio: ..., video: false})` only after a user click. Show an elapsed timer and recording indicator; Stop is always available. Permission denied, no microphone, ignored permission prompt, and unsupported browser each have a visible recoverable state. Cancel a pending permission UI; if its promise resolves late, stop every returned track immediately.
2. Select a supported MIME via `MediaRecorder.isTypeSupported`, then inspect the actual `recorder.mimeType`. Candidate containers: WebM/Opus, Ogg/Opus, MP4/AAC; support is probed rather than assigned by browser name. If no recording format works, offer a short audio-file upload in the same panel.
3. Sound Sample should request disabling echo cancellation/noise suppression/automatic gain where supported, because these can remove environmental sounds; Spoken Request can request speech-friendly defaults. Record actual constraints in technical measurements. Server decode is authoritative regardless of client constraints.
4. Preview offers playback, re-record, Cancel, and mode-specific submit. A switch of mode or target keeps the local recording but invalidates outstanding requests and results. Changes never spend a provider call automatically.
5. Spoken Request returns an editable transcript in the existing query field, with a clear “Search” action. Preserve the original language and current filters/variant/search mode. Users correct names before search. Empty/silent ASR output stays an error, not a query. No translation or inferred facet auto-approval is added.
6. Sound Sample returns the existing moment cards/grouping. Mark query input as audio and target as audio/visual/both; do not label visual-only evidence as an audio match or turn similarity scores into percentages. Display empty results honestly. A coverage note explains that audio-only excludes videos without indexed audio.

Use a per-panel request sequence and `AbortController`; ignore every superseded response. Closing, re-recording, mode/target/variant/filter changes or beginning a text search invalidate in-flight voice responses. Retain only the current Blob for preview/retry while the panel is open. Filter changes require explicit audio resubmission in MVP; do not replay ASR/embedding through the text filter-rerun hook. Stop all tracks on Stop/error/close/unmount, and revoke object URLs when no longer used. Browser permission requires HTTPS or localhost; HTTP LAN hosting should offer upload or explain the recording limitation.

## Proposed API and contracts

Use one new Node-runtime endpoint: `POST /api/search/voice`, multipart only. It returns a discriminated union, leaving existing `/api/search` and `/api/search/image` responses untouched. Disable caching (`Cache-Control: no-store`). Reject unknown fields, repeated scalar fields and multiple files. Never accept a client URL or server filesystem path.

| Field | Contract |
| --- | --- |
| `file` | Required recording/upload bytes; exactly one file |
| `mode` | Optional `sound_sample` or `spoken_request`; omission means **`sound_sample`**; empty/unknown values are 400 |
| `variant_id` | Required nonempty string for Sound Sample, using existing variant validation; not accepted for transcription |
| `target` | Sound Sample only: `audio` (default), `visual`, `both` |
| `size` | Sound Sample only: integer 1–100, default 20 |
| `video_id` | Sound Sample only: optional existing single-video scope (API compatibility; no extra video selector in the Group-only UI) |
| `filters` | Sound Sample only: JSON using `parseSearchFilters`; preserve existing metadata and Group semantics when available on the implementation base |
| `language` | Spoken Request only: `auto` (default), `en`, `zh`, `ko`, `th`; advertise each language only after its provider spike passes |

Validation applies after resolving the mode default: omitted mode with a recording but no variant is 400, never an implicit transcription. Spoken Request rejects target/variant/search fields rather than silently ignoring them. The browser keeps current search controls locally for the later ordinary text-search submission.

Response shapes (new endpoint only):

```ts
type VoiceResponse =
  | { kind: 'moments'; hits: SearchHit[];
      meta: { mode: 'sound_sample'; query_modality: 'audio';
        modality: 'audio' | 'visual' | 'both'; sort_by: 'audio' | 'visual' | 'rrf';
        variant_id: string; query_duration_ms: number; query_mime: 'audio/wav';
        took_ms: number; filter: ExistingFilterMeta | null;
        audio_channel_status: 'ok' | 'no_indexed_audio' } }
  | { kind: 'transcript'; transcript: string;
      meta: { mode: 'spoken_request'; language: string | null;
        query_duration_ms: number; took_ms: number } };
```

Carry existing size/rank-window/badge fields on the moments meta as appropriate; finalize exact DTO in the implementation contract tests. `SearchHit` is the existing type, not a second hit schema. Unknown ASR language is `null`, not invented confidence. Distinguish zero relevant-looking results from no indexed audio: compute coverage through a bounded scoped existence check if needed; never infer it solely from hit count. Nearest-neighbor hits alone do not prove relevance; no universal similarity cutoff is promised.

Add `GET /api/search/voice/capabilities`: per-mode availability/reason and supported limits/languages/targets for the deployment. Missing ASR disables only Spoken Request. Provider audio compatibility must be probed out of band and cached by deployment configuration; GET must not incur inference. Do not expose secret values, internal endpoint URLs or raw provider errors. Unknown/unverified capability is unavailable with an actionable reason; do not infer support from the ES root version. Server validation is authoritative even if a stale browser says available.

Use existing `{error:{code,message}}` envelope conventions and sanitized, stable errors:

| HTTP | Examples | Behavior |
| --- | --- | --- |
| 400 | `VOICE_INVALID_REQUEST`, `VOICE_EMPTY`, `VOICE_DURATION_INVALID`, `VOICE_NO_SPEECH` | Correct request/re-record/edit as appropriate |
| 413 | `VOICE_TOO_LARGE` | Request rejected before expensive processing |
| 415 | `VOICE_UNSUPPORTED_AUDIO` | Retry with an advertised container |
| 409 | `VOICE_VARIANT_MISMATCH` | Select a compatible variant; never auto-fallback |
| 429 | `VOICE_BUSY` | Explicit retry with bounded `Retry-After` |
| 502 / 503 / 504 | `VOICE_PROVIDER_FAILED` / `VOICE_UNAVAILABLE` / `VOICE_TIMEOUT` | Keep local preview; retry requires a click; no mode switch |

## Processing and implementation boundaries

### Shared preparation (new `lib/voice/prepare-audio.ts`)

Proposed demo limits, to be validated: 1–15 seconds, upload 5 MiB, multipart envelope 6 MiB, one audio stream, no video stream. Enforce the body bound while streaming before `request.formData()` allocation; use a bounded reader/parser and reject even with absent or dishonest Content-Length. A proxy limit is additional protection, not the only enforcement. Stop browser capture when either duration or byte cap is reached.

Verify a permitted container/codec from bytes and decoder output; MIME/extension are hints. Decode through a spawned ffmpeg process with fixed arguments, no shell, stdin/stdout pipes, bounded stderr/output (at most 480,000 PCM bytes plus a bounded WAV header), process concurrency and a hard wall-clock deadline. Require decoded duration/stream count within policy; reject overlong input rather than quietly truncating it to a permitted sample. Restrict decoder demuxers/protocols to required local pipe formats so a crafted playlist cannot fetch a network URL or local file. The format/pipe combination itself needs codec integration tests.

Output genuine mono 16 kHz signed 16-bit PCM WAV bytes, at most about 0.5 MiB for 15 seconds; inspect emitted WAV framing (seekless headers may need a bounded in-memory header reconstruction). Check against active provider binary/base64/request limits before calling it. Use bounded RAM only; **no recording/temp file writes, deletion, library ingestion or query-audio persistence**. This also respects the user's no-file-deletion convention. Unsupported deployments return unavailable instead of adding an implicit disk fallback.

### Sound Sample (`lib/voice/search-audio.ts`)

1. Validate request, capture a stable request scope and enumerate eligible **ready** assets for the requested variant plus hard filters. Empty scope short-circuits before embedding. Enumeration-limit errors fail closed, never widen to global search.
2. Load the recorded variant stack from asset records and assert compatibility with the active provider, including model, passage task, dims, normalization and variant/proxy identity. Treat query-task pairing separately: query task need not equal the stored passage task, but the provider's query/passsage pairing must be verified. Reject missing/contradictory stack evidence. Do not trust a client-supplied variant ID alone.
3. Prepare WAV once and call `embedQueryAudio(wav, cfg, signal)` once. This query-only adapter retains the existing provider audio body but adds bounded responses, AbortSignal and zero retries; the existing provider interface has no cancellation contract, so ingest transport remains unchanged. Require exact configured dimension count, finite components and nonzero norm; respect existing normalization ownership. Never route EIS audio through a text `query_vector_builder`.
4. Reuse `executeChunkSearch` with explicit `QueryVectorMode` and the existing chunk filter builder. Target `audio` uses `embedding_audio` and audio sort; `visual` uses `embedding_video` and visual sort; `both` uses the existing RRF and attribution behavior. Reuse its weights, candidate window and rank constant; no raw cross-channel score addition or audio-specific new `SearchSortBy` member. Voice opts into `requireCompleteResults`: reject timeouts or failed shards in the primary and attribution searches; existing callers retain their behavior.
5. Return read-only moment hits and operational metadata. Shared helpers may be extracted from `lib/es/search.ts` only with existing text/image/live regression tests proving responses and filters unchanged. Do not add BM25 or automatic transcript fusion to Sound Sample in MVP.

### Spoken Request (`lib/voice/transcribe.ts`)

Use a separate server-only buffer-to-text adapter, with original-language transcription and the current 2,000-character text-search request limit (`app/api/search/route.ts:18`). It does not need SRT/timestamps, drama artifacts or subtitle indices. Return empty speech as `VOICE_NO_SPEECH`; reject malformed/oversize responses; treat a supplied language as a hint with explicit capability support. Reject an unverified language with `VOICE_UNAVAILABLE` rather than forcing it through an English model.

Proposed optional configuration in `lib/voice/config.ts`: `VOICE_SEARCH_ENABLED=false` initially; `VOICE_ASR_API_URL`, `VOICE_ASR_MODEL`, `VOICE_ASR_API_KEY`, all unset by default. Use the configured OpenAI-compatible transcription protocol with verified `response_format=json`, buffer upload and timeout; require URL/model, and a key only when the selected endpoint requires authentication. No implicit cloud provider/key reuse. A local host service is an optional deployment if it exposes this verified protocol; the existing manual MLX script is not that service. Real values live only in ignored `.env`; `.env.example` gets placeholders in the future implementation PR. Do not make new fields required in `AppConfig`.

ASR text is untrusted query content. Show/edit it and pass it to the existing text submission path; never execute it as tool instructions. Search mode, modality, facet parser and ambiguity chips work exactly as if the reviewed text was typed. An ASR outage never silently becomes sound matching.

### Budgets, cancellation and retention

Provisional demo budgets: at most two active voice processing requests per process, bounded queue (zero by default), 30-second overall server deadline including decoder/provider retries, 35-second browser deadline. Per-stage limits fit inside the overall deadline. Preserve provider-wide concurrency caps so voice cannot bypass ingest budgets. A client disconnect or overall expiry must terminate ffmpeg and cancel provider work/retries; merely racing a timeout promise is insufficient.

Existing embedding adapters do not expose an AbortSignal. Add backward-compatible optional call options only if needed, with ingest/live regression tests, or implement a query-specific adapter wrapper that truly cancels underlying transport. Prove provider/gate slots are released on timeout. Provider billing may still count an already-submitted request. No automatic browser retries or inference caches across users. Multi-replica deployments need a shared limiter or gateway enforcement; a process-local two-request cap is only a demo boundary.

Local ASR implementation: `scripts/voice-whisper-server.py` validates multipart/WAV input, then passes PCM via memory pipes to an isolated worker. `scripts/voice_whisper_runtime.py` monitors the HTTP peer and a 25s maximum compute deadline including model startup; on disconnect, shutdown, timeout or malformed/oversize output it kills the owned group and reaps the worker before releasing the single slot. An unreapable worker closes admission until helper restart. The app preserves helper HTTP 504 as `VOICE_TIMEOUT`. Per-request model loading is a deliberate cancellation boundary; performance acceptance remains separate in todo/53. Evidence and regression harness: todo/55.

Do not log/index recordings, base64, transcripts, authorization headers or provider response bodies. Logs/measurements may include request ID, mode, stage, duration/byte counts, status, latency, provider usage when returned and estimated cost with a dated pricing source. Report unavailable usage as unavailable. Audio exists in server memory only for the request; transcript exists only in the browser query draft. State which configured provider receives the audio before submission, without displaying credentials. Review proxy/body logging and provider retention settings before wider deployment.

## Sequenced delivery and acceptance

Keep the feature planning PR separate from blocker fixes and implementation. Implement in the following order, tracked by todo/52:

1. **Prerequisites and feasibility spike.** Reconcile P1s on the chosen base. Verify actual audio-query requests for every advertised EIS/Jina/local provider, recorded variant isolation, query/passage pairing, WAV acceptance, cancellation and budget. Probe WebM/Opus and MP4/AAC decode through pipes. Pick/verify the ASR deployment and original-language text response; do not require an ASR key to ship Sound Sample.
2. **Sound Sample API.** Add optional config, bounded upload/preparation, read-only filtered audio search and capability/error contracts. No index migration, re-embedding or changes to ingestion/metadata writes.
3. **Recording UI and Spoken Request.** Ship both explicit modes together once their gates pass; default Sound Sample. Add preview/upload fallback, transcript review, cancellation and EN/ZH strings. An unavailable Spoken Request may remain visibly disabled with its reason while Sound Sample is usable; do not advertise it as working before ASR acceptance.
4. **Acceptance and documentation.** Update API/operations/UI documentation, verify rebuilt app image contains the revision, and run browser/provider/relevance/performance gates. File-search/live-search regression failures block release. A follow-up PR may add live voice querying after separate live acceptance.

| Gate | Required evidence / proposed target | Current result |
| --- | --- | --- |
| Request/default contract | Omitted mode is sound; explicit modes work; malformed/duplicate fields, oversize streaming body, MIME spoof, video-only, duration boundaries and unknown variants fail predictably | Pending; see todo/52 for scoped implementation evidence |
| Unit/service contracts | Tests under `lib/**/*.test.ts`: filters/ready isolation, one audio embedding, empty-scope zero calls, missing audio, finite/dimension checks, stale responses, cancellation/resource release, API union and provider sanitization | Pending; see todo/52 for scoped implementation evidence |
| Browser capture | Current Chrome + Safari desktop; supported MIME → valid WAV → search, permission ignored/denied, no device, upload fallback, cap, preview, mode switch, close/unmount and delayed responses. HTTPS and localhost; EN/ZH accessible controls | Pending; see todo/52 for scoped implementation evidence |
| Provider/server acceptance | Real selected endpoint accepts exact WAV/query body; compatibility and task pairing verified, no fallback across stacks. Binary support for one provider never proves the others | Pending; see todo/52 for scoped implementation evidence |
| Spoken-text parity | Reviewed transcript submitted with same mode/filter/parser settings yields same request and ranked results as typed text; EN/ZH first, ko/th only when tested. Named-actor corrections and no-speech negatives | Pending; see todo/52 for scoped implementation evidence |
| Audio relevance | At least 30 manually labeled samples, including speech, environmental sound and music, with repeat examples/noisy/mismatched-language negatives. Proposed Recall@5 ≥ 0.80 on labeled-positive samples, reported per category and target. Human review separately checks top-5 usefulness; exact source identity is not required | Pending; see todo/52 for scoped implementation evidence |
| Negative relevance | Silence/near-silence, unrelated sound and corpus with no audio; zero vectors rejected; no fabricated “confident match.” Report hard-negative top-score distribution before deciding any cutoff | Pending; see todo/52 for scoped implementation evidence |
| Latency/cost | ≥100 searches/mode on a fixed documented corpus/variant/deployment, concurrency 1 and 2, cold/warm split. Provisional stop-to-results p95 ≤5s sound; stop-to-transcript p95 ≤8s speech. Exclude recording and human review time; report stage latency/requests/usage and pricing-derived cost rather than inventing a dollar threshold | Pending; see todo/52 for scoped implementation evidence |
| Read-only/regression | Compare chunk counts/vectors/variant/file paths and metadata revisions before/after voice queries. Existing text/image/library/media/live route regressions unchanged; no provider cross-mixing | Pending; see todo/52 for scoped implementation evidence |
| Host build/full suite | `yarn test`: 62 files / 447 tests pass. `yarn build`: compile/typecheck/static generation pass. Yarn 1.22.22, bundled Node 24.19.0, existing dependency install shared read-only through a local symlink. These validate the planning branch baseline, not voice behavior | Historical baseline PASS; final Node 22 implementation PASS in todo/52 |
| Runtime deployment | Rebuild `app` after implementation; check image/revision and exercise UI/API in that container. Rebuild worker only if worker changes are later authorized | Pending; see todo/52 for scoped implementation evidence |

Targets are proposed acceptance thresholds, not measured claims. Human relevance review remains separate from automated test/build success. If the capability spike finds poor cross-modal quality, ship only targets that pass and return unavailable for unverified targets; changing provider for indexed variants requires a separate reindex/variant decision.

## Primary sources checked 2026-10-02

- [Jina omni-small model card](https://jina.ai/models/jina-embeddings-v5-omni-small/): audio/visual/text embeddings share a space; supports 1024 dimensions and common audio formats. This supports feasibility, not the app's measured search accuracy or any particular deployed endpoint contract.
- [Jina API OpenAPI](https://api.jina.ai/openapi.json) and [Embedding API](https://jina.ai/embeddings/): audio input schema and retrieval tasks; verify the exact configured provider request at implementation time. No changes to existing provider/body/dims defaults are implied here.
- [MDN getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia): user permission, secure context/localhost, denial and unanswered permission prompts.
- [MDN MediaRecorder](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder): MIME capability detection, recorded blobs and lifecycle events. Container support must still be measured in selected browsers.
- [ffmpeg protocol documentation](https://ffmpeg.org/ffmpeg-protocols.html): pipe I/O and protocol restrictions; codec/framing/resource behavior requires integration tests.

The original planning PR performed no provider calls or live Elasticsearch queries. Implementation performed the scoped provider/API/browser checks in todo/52. No microphone capture, container rebuild or filesystem deletion was performed.
