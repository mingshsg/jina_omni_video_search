# todo/52 — Voice-search planning and implementation

Date: 2026-10-02. Plan: [13-voice-search.md](../plan/13-voice-search.md).
Scope: planning PR against `live-video-search`, followed by isolated implementation on `codex/voice-search` (authorized by the user on 2026-10-02).
Planning PR: [#1 — Voice search](https://github.com/mingsorg/jina_omni_drama/pull/1).

## Planning work

- [x] Confirm two modes: **Sound Sample default when mode is omitted**, Spoken Request selectable.
- [x] Inspect embedding/search/variant contracts and current ASR/Group implementation boundaries.
- [x] Check P1 dispositions; preserve historical and untracked files. Record discrepancies and the implementation prerequisite in the plan.
- [x] Verify primary browser/Jina/ffmpeg references; mark deployment capability and quality unverified.
- [x] Define inputs, processing, DTOs, failure handling, privacy/retention, cancellation, budgets and acceptance gates.
- [x] Isolate branch `codex/voice-search-plan` from `origin/live-video-search` (`db23b88`), excluding enrichment commits and user-owned untracked duplicate review/tracker files.
- [x] Run full `yarn test` and `yarn build`; record counts, runtime and limitations below.
- [x] Inspect final diff, commit only plan/tracker, push and open planning PR; attach PR to this chat. PR #1 targets `live-video-search`; feature implementation remains open below.

## Implementation sequence — authorized 2026-10-02

- [x] **V0 Prerequisites:** implementation starts from planning branch at `e9390ba`, based on `live-video-search` `db23b88`. Its tracked todo/22 F1–F3, todo/30 S1–S3 and todo/32 R1 are closed; todo/31 X1b remains an open project-level P1 migration-planning item. The user explicitly authorized voice implementation; that separately tracked migration is preserved, not included or declared fixed. Drama todo/37/38 and the untracked duplicate are outside this branch. Preserve them and their pending acceptance; no unrelated fixes are included.
- [ ] **V1 Capability spike (scoped PASS; wider providers/relevance pending):** validate exact audio-query/WAV/task pairing on every advertised provider; compare active provider identity with recorded variants; fail closed on unsupported stacks. Verify valid/nonzero finite vectors and dims, duration/body budgets, actual cancellation and semaphore release.
- [x] **V2 Decoder spike:** bounded multipart reader, codec/container allowlist, safe stdin/stdout-only ffmpeg, real mono16k WAV framing, no URL/file access, no file writes/deletions, overlong/spoofed input failure.
- [x] **V3 Sound Sample service:** new voice endpoint/capability contract; readiness + hard filter + variant isolation; one embedding; audio/visual/both existing retrieval; old route regressions. Audio default and omitted-mode validation tested.
- [x] **V4 Transcription adapter:** optional server-only voice config, verified buffer-to-text ASR deployment, original-language/empty/malformed/timeout handling, no implicit cloud/key reuse. No dependency on drama artifacts, timed subtitles, or manual host script.
- [x] **V5 Recording UI:** explicit default/sample and selectable/spoken modes; start/stop/preview/re-record/upload; editable transcript to ordinary text submit; capture constraints by mode; EN/ZH accessibility and availability reasons. Preserve active Group/filters on the final implementation base.
- [x] **V6 Cancellation/resource/privacy:** sequence tokens and AbortSignal, late permission-track stop, close/unmount/changes cancel, explicit retries only, bounded concurrency/deadlines, no audio/transcript/provider-body logging or query persistence, configured destination disclosure.
- [ ] **V7 Acceptance:** live provider/server/browser tests, typed-vs-spoken parity, 30 labeled samples + human relevance review, 100 requests/mode for p95/cost, read-only before/after evidence and existing file/live regression. Record each gate separately.
- [ ] **V8 Release docs/runtime:** update contracts/operations/.env.example placeholders; default feature flag off until verified; Node22 full suite/build; rebuild app and verify container revision before browser acceptance. Live voice remains separate follow-up scope.

## Validation evidence for this planning PR

On the isolated planning branch, using the existing dependency install via an uncommitted local `node_modules` symlink (no lockfile/dependency changes):

```bash
PATH=/Users/ming.shen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH yarn test
PATH=/Users/ming.shen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH yarn build
```

- **PASS** — `yarn test`: Vitest 3.2.7, 62 files / 447 tests, 3.82s suite duration.
- **PASS** — `yarn build`: Next.js 14.2.35, compile/typecheck and static generation (20/20); command completed in 24.32s.
- Runtime: Yarn 1.22.22, bundled Node 24.19.0. Default shell Node is 20.15.1; common Node 22 install paths were absent. **Node 22 verification NOT RUN**; it remains required before feature acceptance.
- **PASS** — only plan/tracker staged; original enrichment checkout and its two untracked duplicate files unchanged.
- **NOT RUN** — `yarn lint` (known interactive/unconfigured command), microphone/browser tests, billed embedding/ASR calls, live Elasticsearch request/variant/relevance tests, latency/cost measurements and container rebuilds.

These historical results establish the planning baseline only; implementation evidence follows below.

## Implementation progress — 2026-10-02

- Branch: `codex/voice-search`, isolated at `/private/tmp/jina-voice-search-implementation-20261002`; user's enrichment checkout preserved.
- Added bounded multipart contracts, in-memory ffprobe/ffmpeg decoding, cancellable query transports, recorded-variant verification, read-only retrieval, ASR adapter and EUI recording panel. Both modes implemented; Sound Sample is the default.
- Native microphone capture and labeled relevance acceptance are still pending. Default feature flag is off; separate verification fingerprints gate audio and ASR capabilities.
- Temporary official Node 22.20.0 obtained for required verification. The initially shared `node_modules` was cleared externally during build; a separate frozen-lockfile Yarn install completed without lockfile changes. The shared symlink was preserved by moving it, not deleting it. Initial build/test attempts interrupted by missing dependencies are not passing gates.
- User confirmed a separate Voice search tab; `/search-voice` implements it. With no optional backend preference supplied, a local cached Whisper service was used for isolated validation; deployments can explicitly configure their own API.

## Implementation validation — 2026-10-02

Runtime: Node 22.20.0, Yarn 1.22.22, independent `yarn install --frozen-lockfile --non-interactive`. Final commands:

```bash
yarn test --maxWorkers=4
yarn build
yarn probe-voice --audio
yarn probe-voice --asr --auto=<generated-en.wav> --en=<generated-en.wav> --zh=<generated-zh.wav>
```

- **PASS** — full suite: 72 files / 524 tests. Includes 77 new voice tests, actual supported-codec decode and shared text/vector/multichannel request/response regressions. Final build compile/typecheck and 21/21 static routes, including `/search-voice` and voice APIs.
- **PASS (transport)** — configured EIS accepted 1.2s synthetic mono16k WAV and returned a valid normalized 1024-dimensional vector. Only `audio` is advertised in the isolated validation configuration. Jina/local embedding and visual/both live verification **NOT RUN**.
- **PASS (transport and two synthetic phrases)** — cached local MLX Whisper, auto/en/zh. English returned exactly `Find a car chase in the rain.`; Chinese remained Chinese (11 characters). These fixtures do not establish multilingual human transcript quality.
- **PASS (live API)** — omitted mode returned Sound Sample moments, selected variant `8b28281cd6671e40`, 15 ready eligible assets, indexed audio present, 2 requested hits, every hit in the selected variant. Empty scope returned 0 without inference; ASR returned the transcript union. Two ordinary text requests with the typed phrase and returned transcript produced identical moment IDs, HTTP 200.
- **PASS (read-only counts)** — assets 38 → 38; chunks 9137 → 9137 across voice/transcript/text requests. Full vector/file-path/metadata-revision snapshots **NOT RUN**; unchanged counts alone do not prove byte-for-byte immutability.
- **PASS (host browser, in-app browser)** — separate navigation tab, Sound Sample initial selection, compatible variant, generated WAV upload/preview, search produces existing grouped audio moment cards; switch to Spoken Request retains clip, transcript enters editable query and requires ordinary Search. Fixed empty-filter sentinel (valid unfiltered scope had disabled submit) and stopped implicit text reruns while reviewing voice results/transcripts.
- **PASS (static)** — no voice ingestion/index writes; bounded RAM-only query preparation; no provider bodies/credentials/transcripts logged; ignored `.env` only. The optional Whisper server creates no recording files. The new transport preserves existing ingest provider APIs.
- **NOT RUN** — actual microphone permissions/recording, Chrome/Safari capture matrix, browser denial/no-device/manual quality, 30 labeled samples/human relevance, 100 requests per mode p95/cost, full image/library/media/live runtime regression, final Docker image rebuild, multi-replica admission and hosted ASR/provider retention review. Local host media cannot substitute for container playback acceptance.
- **NOT RUN** — `yarn lint` (known unconfigured interactive command).

V1 and V7/V8 remain open for these acceptance gates; V2–V6 are implementation-complete within the scoped host/test evidence. Repository defaults remain disabled/unverified. Original enrichment checkout, its work and untracked duplicates are preserved; newer Group/5s preset work is outside this PR base and must be reconciled when it lands. Baseline `custom` variants are verified and supported; unknown future presets fail closed.

Review and follow-up: [voice-search-implementation-review](../reviews/voice-search-implementation-review-2026-10-02.md), [todo/53](53-voice-search-acceptance-2026-10-02.md). The implementation PR is a draft until release gates close.
