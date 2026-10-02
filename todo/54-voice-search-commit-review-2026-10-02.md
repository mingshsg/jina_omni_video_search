# Voice search commit review — 2026-10-02

Review: [voice-search-commit-review](../reviews/voice-search-commit-review-2026-10-02.md). Base reviewed: `ce3ab15` on `codex/voice-search`, compared with `origin/live-video-search`.

- [x] **P2 R1** — Clear the retained clip, preview and submit eligibility when EUI sends an empty file selection. Confirmed the installed EUI remove action invokes `onChange(null)`. Code-path inspection completed; browser remove/reselect acceptance remains open below.
- [x] **P2 R2** — Reject incomplete final moment-search responses for voice only. Test Audio, Visual and all three All branches with timeout and failed-shard responses; preserve legacy handling and bodies.
- [x] Run Node22 `yarn test --maxWorkers=4`: 73 files / 534 tests PASS.
- [x] Node22 `yarn build`: PASS, 21/21 pages, 27.35s. `git diff --check`: PASS. Stage only the explicit review/fix files and inspect the staged diff before committing.
- [x] **P2 R3** — Implemented isolated local MLX workers, a maximum 25s compute deadline, disconnect/shutdown termination, kill/reap-before-release and fail-closed cleanup. Twelve stdlib process/HTTP scenarios pass, including stalled-worker timeout/abort and next-request recovery. Rebuilt app → cached model EN/ZH returned 200; abort reaped its real worker in 61ms and the next request returned 200. Full suite: 74 files / 536 tests; build PASS. See [todo/55](55-voice-asr-cancellation-2026-10-02.md). Human/performance/deployment acceptance remains separate.
- [ ] **P2 R4** — Browser upload/remove/reselect/re-record check on the rebuilt preview, then the microphone/codec/stale-response matrix from todo/53 A1. Do not count static inspection as browser acceptance.
- [ ] Complete remaining human relevance, performance, Docker and full runtime regression gates in [todo/53](53-voice-search-acceptance-2026-10-02.md) before marking PR #2 ready. This commit review does not close them.

Commit scope: R1/R2 fixes, their regressions, plan correction and review/tracking documentation only. Preserve untracked `node_modules.shared-link`, ignored `.env`, and unrelated files in the original checkout. Existing voice implementation commits are already present; no new implementation commit is needed for unchanged files.
