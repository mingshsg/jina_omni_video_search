# Voice search

The separate **Voice search** tab is `/search-voice`. It reuses the file-search controls, moment grouping and player.

- **Sound Sample** is selected initially. A short recording is embedded directly. The existing **Modality** selector below chooses Audio (default), Visual (recording→video-frame matching), or All (both vector channels). There is no separate Match against selector. Speech in this mode is a sample, not an instruction. Deployments configure available targets independently; unavailable targets disable sample submission with an explanation. Description, text parsing and text fusion apply to text search, so are disabled while submitting a Sound Sample.
- **Spoken Request** transcribes in the original language. The transcript appears in the editable query field; review it and click the ordinary Search button. The existing text search mode, parser and filters apply.

Choose Record → Stop → preview → Find moments/Transcribe, or upload a short audio file. Nothing is submitted automatically. Limits are 1–15 seconds, 5 MiB per file and 6 MiB multipart envelope. The browser stops capture at 14.5s to leave room for final packets. Actual decoded duration is authoritative; long uploads are rejected rather than truncated. Microphone capture requires HTTPS or localhost; upload works without capture permission. Closing the panel, changing mode/target/controls, re-recording or beginning text search cancels pending voice work.

The app accepts single-stream WAV PCM, WebM/Opus, Ogg/Opus/Vorbis, MP4/AAC, MP3 or FLAC audio. Inputs with video, playlists, unsupported codecs or malformed framing are rejected. ffprobe and ffmpeg run with pipes, restricted protocols/formats, 5s subprocess deadlines and bounded output. The normalized provider input is mono16k 16-bit PCM WAV in RAM. The app never writes, indexes or retains query recordings/transcripts and never invokes library ingestion from voice search.

## Enable a deployment

Use ignored `.env`; keep credentials out of Git. New settings are independent of `AppConfig` and default to off/unverified. A missing transcription service affects Spoken Request only.

1. Configure the existing embedding provider and its binary budget. Run `yarn probe-voice --audio`. The read-only probe sends one synthetic 1.2s tone and prints `VOICE_AUDIO_VERIFIED_STACK`; copy that value into `.env` along with `VOICE_SEARCH_ENABLED=true` and initially `VOICE_AUDIO_TARGETS=audio`.
2. The verification stamp includes provider, endpoint, model, query/passage tasks, dimensions and normalization. Changing them invalidates capability. Existing recorded variants are separately re-hashed, including chunk/proxy settings, and checked before inference. An incompatible variant returns 409 rather than mixing vectors or changing providers. Audio-only scope with no indexed audio returns empty moments with `audio_channel_status=no_indexed_audio` and spends no inference.
3. For Spoken Request, explicitly configure `VOICE_ASR_API_URL`, `VOICE_ASR_MODEL`, optional `VOICE_ASR_API_KEY` and `VOICE_ASR_LANGUAGES`. The endpoint must support buffer WAV upload, `response_format=json`, original-language transcription, cancellation and a `{text,language?}` response. HTTPS is required for external endpoints; HTTP is permitted only for loopback or `host.docker.internal`. Redirects and credential-bearing URLs are refused.
4. Supply representative speech fixtures for every advertised language: `yarn probe-voice --asr --auto=/absolute/sample.wav --en=/absolute/english.wav --zh=/absolute/chinese.wav`. If you configure fewer or more languages, use matching fixture arguments. On success it prints `VOICE_ASR_VERIFIED_CONFIG`; save it in `.env`. The probe logs lengths, not transcripts. Verification is transport acceptance; human transcript quality remains a separate gate.
5. Restart the app after configuration changes. `GET /api/search/voice/capabilities` reads configuration without provider calls and returns availability/reasons, destinations, targets, languages and limits. It does not reveal endpoints or keys. Unknown verification is unavailable.

### Optional local MLX Whisper service

On an Apple Silicon host with `numpy`, `mlx_whisper` and cached weights already installed:

```bash
HF_HUB_OFFLINE=1 /usr/local/bin/python3 scripts/voice-whisper-server.py --port 8768
```

Set `VOICE_ASR_API_URL=http://127.0.0.1:8768/v1/audio/transcriptions` and `VOICE_ASR_MODEL=mlx-community/whisper-large-v3-turbo` in the host app's ignored `.env`. The optional server uses one processing slot, bounded multipart input and in-memory WAV→NumPy decoding, with no recording files. It binds to loopback only and does not log transcripts or request bodies. It does not run in the Next.js container; use a separately configured accessible service for container deployments. This script does not install dependencies or download weights when `HF_HUB_OFFLINE=1`. A remote Whisper deployment can use the same explicit protocol configuration.

## API

`POST /api/search/voice` is multipart, Node runtime, `Cache-Control: no-store`.

| Field | Contract |
| --- | --- |
| `file` | Exactly one nonempty recording |
| `mode` | `sound_sample` (default if omitted) or `spoken_request`; empty/unknown values rejected |
| `variant_id` | Required for Sound Sample; not accepted for transcription |
| `target` | Sound Sample only: audio default, visual or both, subject to advertised capability |
| `size` | Sound Sample only: integer 1–100, default 20 |
| `video_id` / `filters` | Sound Sample only: optional current single-video scope / metadata-filter JSON |
| `language` | Spoken Request only: advertised auto/en/zh/ko/th |

Unknown fields, repeated scalars, multiple files, contradictory mode fields and client URL/path inputs are rejected. An omitted mode without a variant is an error, never implicit ASR.

Sound response: `{kind:"moments",hits:SearchHit[],meta:{mode:"sound_sample",query_modality:"audio",modality,sort_by,variant_id,query_duration_ms,query_mime,took_ms,size,rank_window_size,badge_strategy,filter,audio_channel_status}}`. The hit DTO and rankings remain the existing file-search contracts; no universal relevance percentage/cutoff is implied. Audio coverage is independently checked from the filtered chunk scope, not guessed from an empty hit list.

Speech response: `{kind:"transcript",transcript,meta:{mode:"spoken_request",language,query_duration_ms,took_ms}}`. No retrieval is performed in this branch. Unknown detected language is null. Empty or overlong (>2000 characters) transcripts fail.

Errors retain `{error:{code,message}}`: 400 invalid/empty/no speech/duration, 413 upload/provider byte bound, 415 decode/codec, 409 variant mismatch, 429 busy (`Retry-After: 2`), 503 disabled/unverified/missing decoder or ASR, 502 sanitized upstream failure, 504 cancellation/deadline. No automatic browser/provider retries or cross-mode fallback.

## Operations and validation limits

Two voice requests per app process, zero waiting voice queue, 30s overall server budget and 35s browser budget. Decoder processes are killed on abort; fetch/ES transports receive AbortSignal. Audio inference also uses the existing embedding concurrency gate, with cancelled waiters removed. Existing ingest callers retain their original gate behavior. An already-submitted provider request may still be billed after cancellation.

The limiter is a single-process demo boundary. Replicas require shared admission control. Review proxy/body logging and provider retention separately. Rebuild `app` after code changes before validating a Docker demo: `docker compose up -d --build app`, then verify its revision/image creation time. Tests on a host build do not verify the running container.

See [todo/52](../todo/52-voice-search-2026-10-02.md) for exact current gates. Transport verification, unit/build success and unlabeled example hits do not establish 30-sample relevance, human transcript quality, p95/cost, Safari recording or deployment readiness. Live voice querying is future scoped work.
