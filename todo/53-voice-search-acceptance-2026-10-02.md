# Voice search acceptance — 2026-10-02

Review: [voice-search-implementation-review](../reviews/voice-search-implementation-review-2026-10-02.md). Plan/implementation tracker: [todo/52](52-voice-search-2026-10-02.md).

- [x] Fix unfiltered voice submit, implicit text reruns and baseline custom-variant support; verify scoped API/browser behavior and full Node22 suite/build.
- [x] Remove the unsupported `microphone` EUI icon from the reopen control after screenshot inspection; retain its accessible Voice search label. No such icon exists in the installed EUI registry.
- [ ] **P2 A1** — Chrome/Safari microphone recording, permission ignored/denied, no device, 1–15s caps, supported codecs, stop/close/unmount, late/stale response and EN/ZH manual accessibility checks.
- [ ] **P2 A2** — 30 labeled sound samples plus human review; report recall/usefulness by category/target and negative-score distributions. Enable visual/both only after their independent quality gates.
- [ ] **P2 A3** — human multilingual transcript review and typed-versus-spoken cases with names, language switching, no-speech and current metadata/parser settings. Advertise ko/th only after fixture and quality validation.
- [ ] **P2 A4** — 100 requests/mode, concurrency 1/2 and cold/warm p95/cost measurements. Do not infer p95 from the single live examples.
- [ ] **P2 A5** — final app container rebuild/revision, configured accessible ASR, thumbnails/player and existing file/image/library/media/live runtime regression. Capture vector/path/metadata-revision immutability snapshots, beyond current count parity.
- [ ] **P2 A6** — shared admission for replicas, proxy body/logging limits, hosted-provider retention and authorization review before broader exposure. Optional local MLX service remains loopback only.
- [ ] **P3 A7** — reconcile Group controls and 5s/future presets when the enrichment branch lands; keep recorded identity hash/provider checks and existing contracts.
- [ ] Close V1/V7/V8 in todo/52 only after the corresponding evidence is recorded; then mark the implementation PR ready. Preserve todo/31 X1b as a separate project migration item.

- [x] **UI correction — authorized 2026-10-02:** remove duplicate Match against; drive sample target from shared Modality (Audio default, Visual, All→both), disable text-only Description/parser/fusion for samples, preserve ASR review. Rebuild localhost preview, verify UI + request mapping + live visual/both transport, and update PR #2.

  Evidence: Node22 full suite **73 files / 529 tests**, build **PASS**. Browser default Audio, Visual→`visual`, All→`both`, and zero Match against elements verified after restarting/reloading the current localhost preview. The request builder round-trips through the actual bounded parser in five new tests. Live API requests for all three targets returned HTTP 200 and two moments each. The ignored isolated preview `.env` now advertises `audio,visual,both`; shipping defaults remain off/unverified and human relevance remains open. Screenshot: `/private/tmp/voice-unified-modality-20261002.jpg`.
