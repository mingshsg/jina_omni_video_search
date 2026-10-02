# Voice search commit review — 2026-10-02

Scope: review `codex/voice-search` at `ce3ab15` against `origin/live-video-search` (`db23b88`), then review the R1/R2 corrections below. Covers multipart/decode/provider boundaries, variant/filter isolation, recording lifecycle, the extracted SearchExperience, shared search/concurrency changes, tests and optional ASR helper. The original enrichment checkout and its untracked user documents are outside this commit.

**Verdict: R1/R2 fixes and review documentation are ready to commit after passing the full suite/build; the feature remains draft, with ASR compute cancellation and release acceptance open.**

## Findings and disposition

### P2 R1 — Removing an upload retained a submittable clip — fixed

At reviewed HEAD, `components/VoiceSearchPanel.tsx:122` used `if (!file) return`. The installed EUI file picker calls `onChange(null)` on removal (`node_modules/@elastic/eui/lib/components/form/file_picker/file_picker.js:118`). Thus removing a file changed the picker but retained the preview/clip and enabled submission of that previous recording.

The corrected `components/VoiceSearchPanel.tsx:123` now runs `setClip(null); setState('idle'); setError(null)` after invalidation and recorder disposal. The existing clip effect revokes the preview URL and the submit button requires a clip (`:129`). Code inspection and build passed; upload/remove browser acceptance was not rerun in this review and is explicitly tracked in R4.

### P2 R2 — Partial moment searches were reported as successful voice results — fixed

At reviewed HEAD, `lib/es/search.ts:249` directly returned `client.search(...)`; assembly discarded `timed_out` and `_shards.failed`. Voice checked completeness of its asset enumeration but not the final kNN/RRF/attribution responses. A partial search could therefore appear as valid empty/incomplete results or misleading channel attribution.

The opt-in check at `lib/es/search.ts:253` rejects `response.timed_out || (response._shards?.failed ?? 0) > 0`. Voice enables `requireCompleteResults: true` at `lib/voice/search-audio.ts:67`; other callers retain their request bodies, DTOs and partial-result behavior. Five new parameterized cases cover Audio, Visual and each of the three All branches, checking timeout and shard failures as well as legacy behavior. The handler's existing generic failure path sanitizes the exception into HTTP 502.

### P2 R3 — Local ASR compute is not cancelled by the app deadline — open

`scripts/voice-whisper-server.py:82` executes synchronous `mlx_whisper.transcribe(...)`; `:89` releases `SLOT` only after it returns. There is no cancellable worker or model-compute deadline. The application's AbortSignal terminates the HTTP request, but a slow/stalled local transcription keeps the single service slot busy after the 30s app deadline. This falls short of the compute-cancellation requirement in plan/13.

Documented this boundary in `docs/voice-search.md`. Keep the helper limited to the local draft demo. Add bounded/cancellable worker execution or verify an ASR service that provides it, then prove capacity returns after a stalled request. Track in todo/54 R3; a passing HTTP cancellation unit test does not close it.

## Checks and rejected findings

- No new P1 was identified within this feature diff. Existing project migration planning in todo/31 X1b is outside this review and remains open; this is not a whole-repository security or release-readiness verdict.
- Rejected implicit ASR fallback: omitted mode is Sound Sample; speech returns a transcript without searching. The parent requires explicit text Search after review.
- Rejected loss of cross-modal targets: the shared Modality maps Audio/Visual/All to audio/visual/both; no Match against control remains. UI request-builder tests round-trip through the real multipart parser.
- Rejected variant mixing: recorded identity is reconstructed from provider/model/task/dimensions/normalization/chunk/proxy fields and compared with the active stack before inference. Eligible ready IDs stay in chunk filters; empty scope spends no embedding.
- Rejected query-media persistence or ingest mutation: reviewed voice path uses bounded RAM and pipe-based decoding, no filesystem query write or index mutation. This is code evidence, not a fresh full database/media snapshot.
- Rejected unconditional shared-search behavior changes: cancellation and completeness handling are opt-in; regressions compare legacy one-argument request bodies and DTOs for visual/audio/both and text query builders. The SearchExperience extraction was compared with the original page; ordinary-page defaults and implicit text rerun conditions remain equivalent while voice is absent.
- Resource checks cover late microphone permission, track/timer disposal, bounded upload/decode, decoder codec/protocol allowlists, embedding-queue cancellation, transport abort and sanitized errors. Native microphone and component-level stale-response acceptance remain in todo/53; the optional Python helper has the separate R3 gap above.
- `.env` is ignored and not staged; tracked environment files are examples. Preserved `node_modules.shared-link` and unrelated original-checkout files. No direct file deletion performed.
- Prior scoped EIS/ASR/API/browser evidence remains in todo/52–53. It was not rerun during this review and is not counted as fresh acceptance here.

Follow-up: [todo/54](../todo/54-voice-search-commit-review-2026-10-02.md), plus remaining [todo/53](../todo/53-voice-search-acceptance-2026-10-02.md) gates. The earlier implementation review remains historical evidence for its separate runtime scope.

## Gates

| Gate | Result |
| --- | --- |
| Node 22.20.0 / Yarn 1.22.22 `yarn test --maxWorkers=4` | PASS: 73 files / 534 tests; 7.91s command wall time |
| `yarn build` | PASS: compile/typecheck, 21/21 static pages; 27.35s |
| Voice partial-response rejection / legacy response regression | PASS: Audio, Visual, All primary and attribution branches |
| Real ffmpeg codec/body/duration tests | PASS as part of full suite |
| `git diff --check` | PASS |
| Removed-upload state handling | Code inspection PASS; browser NOT RUN |
| Live ES/ASR/provider requests on this revision | NOT RUN |
| Native microphone, Chrome/Safari, component race/accessibility matrix | NOT RUN |
| ASR compute deadline/disconnect slot recovery | NOT RUN; known R3 gap |
| Human relevance/transcript quality, representative p95/cost | NOT RUN |
| Docker rebuild/full file-image-library-media-live acceptance | NOT RUN |
| Full vector/path/metadata immutability snapshot | NOT RUN |
| Multi-replica/proxy/retention/security assessment | NOT RUN |
| `yarn lint` | NOT RUN: repository command is unconfigured/interactive |
