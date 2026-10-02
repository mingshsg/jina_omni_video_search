# todo/52 — Voice-search planning and implementation

Date: 2026-10-02. Plan: [13-voice-search.md](../plan/13-voice-search.md).
Scope: planning PR only against `live-video-search`; feature implementation is future work.

## Planning work

- [x] Confirm two modes: **Sound Sample default when mode is omitted**, Spoken Request selectable.
- [x] Inspect embedding/search/variant contracts and current ASR/Group implementation boundaries.
- [x] Check P1 dispositions; preserve historical and untracked files. Record discrepancies and the implementation prerequisite in the plan.
- [x] Verify primary browser/Jina/ffmpeg references; mark deployment capability and quality unverified.
- [x] Define inputs, processing, DTOs, failure handling, privacy/retention, cancellation, budgets and acceptance gates.
- [x] Isolate branch `codex/voice-search-plan` from `origin/live-video-search` (`db23b88`), excluding enrichment commits and user-owned untracked duplicate review/tracker files.
- [x] Run full `yarn test` and `yarn build`; record counts, runtime and limitations below.
- [ ] Inspect final diff, commit only plan/tracker, push and open planning PR; attach PR to this chat.

## Implementation sequence — not authorized by this planning request

- [ ] **V0 Prerequisites:** reconcile `todo/37` reopened P1 dispositions against `todo/38` and current code; confirm tracked `todo/32` R1 closure rather than relying on the untracked duplicate. Resolve genuinely open P1s in separate PRs before implementation. Do not rewrite historical review bodies.
- [ ] **V1 Capability spike:** validate exact audio-query/WAV/task pairing on every advertised provider; compare active provider identity with recorded variants; fail closed on unsupported stacks. Verify valid/nonzero finite vectors and dims, duration/body budgets, actual cancellation and semaphore release.
- [ ] **V2 Decoder spike:** bounded multipart reader, codec/container allowlist, safe stdin/stdout-only ffmpeg, real mono16k WAV framing, no URL/file access, no file writes/deletions, overlong/spoofed input failure.
- [ ] **V3 Sound Sample service:** new voice endpoint/capability contract; readiness + hard filter + variant isolation; one embedding; audio/visual/both existing retrieval; old route regressions. Audio default and omitted-mode validation tested.
- [ ] **V4 Transcription adapter:** optional server-only voice config, verified buffer-to-text ASR deployment, original-language/empty/malformed/timeout handling, no implicit cloud/key reuse. No dependency on drama artifacts, timed subtitles, or manual host script.
- [ ] **V5 Recording UI:** explicit default/sample and selectable/spoken modes; start/stop/preview/re-record/upload; editable transcript to ordinary text submit; capture constraints by mode; EN/ZH accessibility and availability reasons. Preserve active Group/filters on the final implementation base.
- [ ] **V6 Cancellation/resource/privacy:** sequence tokens and AbortSignal, late permission-track stop, close/unmount/changes cancel, explicit retries only, bounded concurrency/deadlines, no audio/transcript/provider-body logging or query persistence, configured destination disclosure.
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

No voice implementation exists. Build/test success above establishes baseline integrity on this branch only. Future voice acceptance gates remain open.
