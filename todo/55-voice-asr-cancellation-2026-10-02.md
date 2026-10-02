# Local voice ASR cancellation — 2026-10-02

Authorized: user requested the next function after the commit review. Scope: close [todo/54 R3](54-voice-search-commit-review-2026-10-02.md), local Whisper compute cancellation/deadline and service-slot recovery, on `codex/voice-search`.

- [x] Replace in-handler compute with an owned subprocess; pass validated PCM through bounded memory pipes, keep model/language chosen by server, retain one-slot/no-queue admission.
- [x] Monitor client disconnect and a maximum 25s compute deadline including model startup/input transfer; kill and reap the worker group before slot release. Fail closed on unreapable workers.
- [x] Verify real worker timeout/abort/oversize/crash and HTTP 429 → recovery contracts with generated fixtures and no model downloads. Twelve stdlib scenarios run under the Vitest wrapper, including large pipe input, blocked input, SIGTERM-ignoring stall, pre-disconnected peer, malformed/oversize output, failed reap admission and graceful service close. ASR 504 mapping has an adapter regression.
- [x] Verify actual cached local Whisper original-language transcription through the new worker and the app route, without private recordings. Probe auto/en/zh PASS, transcript lengths 29/29/11. Rebuilt app EN/ZH: HTTP 200, 29/11 characters. Abort after real worker startup: worker reaped in **61ms**, subsequent EN request HTTP 200. No private microphone recording used.
- [x] Update plan/operations and close R3 only after evidence; preserve unrelated acceptance gates in todo/53. [Scoped implementation review](../reviews/voice-asr-cancellation-implementation-review-2026-10-02.md).
- [x] Full Node22 suite: **74 files / 536 tests PASS**, 7.84s command time, plus 12 Python scenarios inside the wrapper. Production build: **PASS**, 21/21 pages, 27.69s. Whitespace/diff inspection PASS.

Commit scope: the local worker/runtime, Python HTTP/process regression harness and Vitest wrapper, sanitized ASR timeout mapping, plan/operations and review/task records. Commit on the existing feature branch; keep unrelated files, ignored environment values and dependency symlink out of Git.

Live fixture harness: `/private/tmp/voice-asr-worker-acceptance-20261002.mjs`. App-route timings were 3913ms EN, 2414ms ZH and 2262ms EN after abort. These are individual host examples, not p95 or human transcript-quality acceptance. The owned preview/helper were restarted from the reviewed source; Docker acceptance remains NOT RUN.

Design tradeoff: each request loads its own model; cached weights avoid downloads, but cold/warm timing must be measured. Persistent model reuse is future optimization, not a reason to leave compute uncancellable. Python3 is needed for the standard-library process/HTTP regression harness; MLX remains optional for runtime.
