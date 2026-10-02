# Voice search push review — 2026-10-02

User requested code review and push if sound. Scope: unpushed `aa6a793` and `9e6f563`, plus review fixes, on `codex/voice-search`; PR #2 targets `live-video-search` and stays draft.

- [x] **P2 R1** — Fixed shutdown of idle connections, incomplete headers and partial uploads. Three real-socket tests failed before the fix and pass after accepted connections are interrupted before joining handlers.
- [x] **P2 R2** — Unexpected process-group termination errors now attempt reap, close pipes and raise cleanup failure, preserving closed admission. Fault injection passes. Cleanup state initializes before bind; occupied-port startup regression passes.
- [x] Reviewed shared-search opt-in, file removal, worker admission/bounds/errors and secret/commit scope. [Review report](../reviews/voice-search-push-review-2026-10-02.md).
- [x] Node22 full suite: 74 files / 536 tests, including 17 Python scenarios via the wrapper, PASS in 9.75s. Build/typecheck: 21/21 pages, PASS in 29.09s. Whitespace and common credential-pattern scan of changed tracked content PASS. Owned localhost preview/helper restarted from reviewed source.
- [x] Prepared review and publication scope for the existing draft PR. Remote was refreshed and has no divergent commits. Publication target: `origin/codex/voice-search`, PR #2; confirm pushed HEAD using both Git and GitHub.

Wider browser/microphone, human relevance, representative p95/cost and Docker acceptance remain in todo/53 and are not push prerequisites for the draft PR.

Fresh generated-fixture app acceptance: EN/ZH HTTP 200, 29/11 transcript characters, 4834/2691ms; cancelling a started real worker reaped it in 58ms, then the next request returned HTTP 200 in 2420ms. These timings are individual examples, not p95. Harness: `/private/tmp/voice-asr-worker-acceptance-20261002.mjs`.
