# Voice integration code review — 2026-10-05

Scope: `codex/voice-search-integration`, combining enrichment update `66acc7c` with voice implementation `e35ba93`, including merge resolutions, shared search UI, Group/Variant controls, current preset identity, provider configuration and local container deployment.

**Scoped integration ready: no blocking code findings; live fixture/browser checks pass. Human quality, microphone matrix and deployment acceptance remain open.**

## Findings and dispositions

No open P1/P2 code finding was identified in this integration scope. Prior review bodies remain historical evidence; their broader acceptance items are not closed by these checks.

### P2 integration risk — older search page would lose current controls — resolved

The voice branch extracted an older search page. A content merge into the current shared component preserves Group auto-Variant selection, scene linking, Group-only filtering and header logos. `components/SearchExperience.tsx:924-931` uses `const nextVariant = matchingVariant ?? variantRef.current` and updates Variant and Group together. `components/SearchExperience.tsx:937` adds `if (voiceOpen || voiceNotice) return`, preventing a Group change from submitting stale typed text during a voice workflow. Starting/reopening voice also clears the pending filter timer (`components/SearchExperience.tsx:767-768`, `812`). Browser drama selection changed Variant to `8b28281c…` without closing the voice panel.

### P3 integration gap — current 5s preset and Group-only upload contract — covered

`lib/voice/search-audio.ts:19` uses `chunk_preset: z.enum(CHUNK_PRESET_NAMES)` rather than an obsolete preset list. Recorded hash reconstruction and provider/model/task/dims/normalization checks remain enforced (`lib/voice/search-audio.ts:24-35`). New regressions in `lib/voice/search-audio.test.ts:27-30` accept the 5s identity and reject a modified window. `lib/voice/ui-request.test.ts:18-23` parses the actual multipart Group request with no video selection. Live training/5s and drama/2s searches passed for all three targets, with every returned hit confined to the selected Group and Variant.

## Checked and rejected concerns

- Default intent remains explicit: `useState<VoiceMode>('sound_sample')` at `components/SearchExperience.tsx:221`; omitted API mode also returned Sound Sample. Speech content never changes modes automatically.
- Duplicate matching selector did not return: `target={voiceTargetForModality(modality)}` at `components/SearchExperience.tsx:806` uses the shared Audio/Visual/All controls. Description remains unavailable for sound samples.
- Spoken Request performs transcription only. `components/SearchExperience.tsx:813-817` fills the editable query, clears submitted-query state and prompts review. Browser edit + ordinary Search succeeded; the API response contains no retrieval hits.
- Group filtering remains server-side, with ready-asset scope enumeration and explicit eligible IDs (`lib/voice/search-audio.ts:39-62`). Provider identity checks do not depend on the currently configured chunk preset.
- Existing search contracts: the new cancellation and partial-response behavior in `lib/es/search.ts` is opt-in. `lib/voice/search-regression.test.ts` compares request bodies and returned DTOs for legacy visual/audio/both and text-builder calls; full suite passed. Live routes were not modified.
- Query processing remains read-only: counts stayed 38 assets / 9,137 chunks. All 38 asset snapshots retained sequence/primary-term and selected variants, metadata revision, Group and media/playback paths; 20 sampled full chunk documents (including vectors) retained sequence/primary-term and source hashes. This is sample evidence for chunk contents, not an exhaustive 9,137-vector comparison.
- Docker receives the host helper through `host.docker.internal`, not container loopback. Exact endpoint/model/auto-en-zh configuration passed before storing its verification stamp in ignored `.env`. The helper uses cached weights, no installs/downloads, and remains bound to host loopback. It must be started again after host restart.
- Empty historical WAV fixtures were correctly rejected. Valid 1.64s English and 2.54s Chinese fixtures passed. The first sandbox test run failed only because HTTP tests could not bind sockets; the socket-enabled full rerun passed.
- Header logos and existing scene-link control are present in the rebuilt UI. The sample result opened in the video player: readyState 4, no media error. Real microphone permissions were not exercised.

## Gates

| Gate | Result |
| --- | --- |
| Node 22 / Yarn `yarn test --maxWorkers=4` | PASS — 127 files, 942 tests, including Python HTTP/process lifecycle tests |
| Host `yarn build` | PASS — compile/types/static pages, 173.56s |
| `docker compose up -d --build app` | PASS — production build, image rebuilt, app recreated and running |
| Container deployment identity | PASS — `e0a050797299`, image `775b0a8c9fcf…`, created 2026-10-05 08:50:54 UTC |
| Audio embedding transport | PASS — Elastic Inference Service, 1024 dimensions |
| Container ASR transport | PASS — automatic/English/Chinese, nonempty fixture transcripts |
| App voice capabilities | PASS — both modes available, audio/visual/both and auto/en/zh advertised |
| Group-filtered sound search | PASS — training/5s and drama/2s × audio/visual/both, 2 hits each, Group + Variant isolation |
| Default mode / invalid empty recording | PASS — omitted mode Sound Sample; empty WAV 400 VOICE_DURATION_INVALID |
| Spoken Request / typed comparison | PASS — transcript-only responses; fixture transcript and typed equivalent returned identical moment IDs |
| Browser navigation/upload/search/transcript/edit/player | PASS — separate tab, default mode, drama auto-Variant, preview, sound results, editable transcription, edited Search, ready player |
| Read-only data invariants | PASS within stated snapshots — counts and all 38 asset / sampled 20 chunk documents unchanged |
| `git diff --check`, resolved conflicts, common credential patterns / ignored env | PASS within changed content; no real env file tracked |
| Real microphone/Chrome-Safari matrix and full EN-ZH accessibility | NOT RUN — todo/53 A1 |
| Labeled sound relevance and human transcript quality | NOT RUN — todo/53 A2/A3; example results do not establish quality thresholds |
| Representative 100-request p95/cost/concurrency | NOT RUN — todo/53 A4 |
| Full file/image/library/media/live runtime acceptance | NOT RUN — only scoped current text/voice and player checks ran; todo/53 A5 |
| Shared admission, hosted retention and broader security/auth | NOT RUN — todo/53 A6 |
| `yarn lint` | NOT RUN — declared command remains unconfigured/interactive |

Follow-up: [todo/59](../todo/59-voice-integration-2026-10-05.md), with remaining release acceptance in [todo/53](../todo/53-voice-search-acceptance-2026-10-02.md). The existing draft voice PR remains unmerged.
