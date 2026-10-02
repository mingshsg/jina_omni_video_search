# Voice-search implementation review — 2026-10-02

Scope: `codex/voice-search`, based on integration `db23b88` plus planning PR #1. Self-review of the new file-video voice path, shared cancellation changes and separate Voice tab.

**Verdict: scoped implementation checks pass; keep the PR draft while release acceptance remains open.**

## Findings and dispositions

### P1 — existing project migration planning remains open, outside this feature

`todo/31-project-level-review-2026-09-23.md:13` retains `- [ ] **X1b — plan the Next 15 migration as its own item.**`. The earlier V0 wording incorrectly asserted no open project P1. Corrected V0: the retrieval/Suggest P1s are closed, X1b is preserved, and the user explicitly authorized voice implementation. This review does not validate the historical advisory claims or declare the migration fixed; no new migration plan or unrelated framework changes are included.

### P2 — deployment and human quality acceptance are owed

`lib/voice/config.ts:43` uses `!voice.enabled ? 'disabled'` and requires exact verification stamps. These transport stamps cannot prove labeled audio relevance, microphone capture compatibility, multilingual human transcript quality or p95/cost. `.env.example:84` therefore remains `VOICE_SEARCH_ENABLED=false`; only the isolated host environment was enabled. Track the owed gates in todo/53.

`lib/voice/runtime.ts:4` explicitly defines a `Single-process demo limit`; `scripts/voice-whisper-server.py:96` binds `127.0.0.1`. Multi-replica admission, proxy limits/logging, provider retention and container-accessible ASR require separate deployment acceptance. Do not use host success as Docker evidence.

### P3 — reconcile future presets and Group controls when enrichment lands

`lib/voice/search-audio.ts:18` validates `chunk_preset: z.enum(CHUNK_PRESET_NAMES)`, including baseline `custom`. Recorded hash/provider stack checks at lines 28–33 remain mandatory. The 5s preset and Group-only UI on the enrichment branch are outside this base. Unknown future presets fail closed; merge reconciliation must preserve Group filters and expand the preset source through that feature's existing definitions rather than weakening identity checks.

## Checks and rejected findings

- **Fixed:** valid empty facets previously produced `undefined`, which the voice UI treated as invalid. `components/SearchExperience.tsx:770` now passes `parsed.filters ?? null` for a valid unfiltered scope. Browser generated-WAV upload → Find moments succeeded after the fix.
- **Fixed:** reset/sort/chip hooks could replay a prior text query while handling a sample or reviewing a transcript. `components/SearchExperience.tsx:699` gates implicit text reruns with `!voiceOpen && !voiceNotice`. Explicit Search still runs the existing text path.
- **Fixed:** baseline `custom` was omitted from the initial voice variant allowlist. The shared preset definitions now supply the schema; a hash-tampering regression checks custom variants.
- **Rejected: audio search is silently ASR.** Sound Sample calls the audio-query transport directly; transcription is a separate response union. Omitted-mode API request returned moments, with indexed audio and matching variant evidence.
- **Rejected: changing to voice re-embeds the library.** The new path only enumerates/counts/searches existing indices. Across voice/transcript/text probes, assets remained 38 and chunks 9137. This is count evidence plus code inspection, not a vector/file/metadata byte snapshot.
- **Rejected: shared AbortSignal changes legacy request bodies or DTOs.** `lib/voice/search-regression.test.ts` covers one-argument legacy transport, identical bodies/DTOs with optional cancellation, text builders, visual/audio/both branches. Existing full suite passes.
- **Rejected: temporary query recordings are written and removed.** The app uses bounded stdin/stdout decode and reconstructs WAV in RAM; local Whisper decodes BytesIO → NumPy. No query filesystem write/delete or index mutation exists. Generated validation fixtures are separate test artifacts and were preserved.
- **Rejected: one provider probe proves all stacks.** Only configured EIS/audio was live-probed. Local/Jina embedding and visual/both relevance remain explicitly unverified. ASR fixtures were generated English/Chinese speech, not private user recordings.

## Gates

| Gate | Result |
| --- | --- |
| Node 22.20.0 / Yarn 1.22.22 full suite | PASS: 72 files / 524 tests; 77 voice tests |
| Production build/typecheck | PASS: compile and 21/21 static routes |
| Actual codec decode, body bounds, cancel/resource contracts | PASS: automated tests |
| EIS mono16k WAV audio query | PASS: normalized 1024-d vector; transport only |
| Local cached MLX ASR auto/en/zh | PASS: transport; two generated phrases |
| Sound API → ES, omitted mode, ready/variant isolation | PASS: HTTP 200, selected variant, audio present |
| Typed versus reviewed transcript | PASS: same text search moment IDs, HTTP 200 |
| In-app browser tab/upload/preview/results/transcript review | PASS: generated WAV, two mode controls |
| Query asset/chunk count parity | PASS: 38 assets / 9137 chunks before and after |
| Full vector/path/metadata snapshot parity | NOT RUN |
| Native mic, Chrome/Safari/permission/device matrix | NOT RUN |
| Labeled 30-sample relevance / human transcript quality | NOT RUN |
| 100 requests per mode p95/cost | NOT RUN |
| Jina/local embedding, visual/both live relevance | NOT RUN |
| Final Docker rebuild and image/API/player acceptance | NOT RUN |
| Full file/image/library/media/live runtime regression | NOT RUN |
| Multi-replica/proxy/provider-retention validation | NOT RUN |
| `yarn lint` | NOT RUN: known interactive/unconfigured command |

Follow-up: [todo/53](../todo/53-voice-search-acceptance-2026-10-02.md). Implementation evidence and original planning history: [todo/52](../todo/52-voice-search-2026-10-02.md).
