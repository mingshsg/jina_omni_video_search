# Local voice ASR cancellation implementation review — 2026-10-02

Scope: the R3 implementation after `aa6a793` on `codex/voice-search`: optional local Whisper service/runtime, adapter timeout mapping, process/HTTP regressions and documentation. No unrelated enrichment, ingest or live-search changes.

**Verdict: local ASR compute cancellation/deadline and slot recovery pass scoped automated and host acceptance; ready to commit, with whole-feature acceptance still tracked separately.**

## Findings and dispositions

### P2 — historical R3 compute cancellation gap — fixed

`scripts/voice-whisper-server.py:110` calls `run_transcription(...)` with the client's socket, configured deadline and service-stop event. `scripts/voice_whisper_runtime.py:54` establishes the monotonic deadline before launching the isolated process; `:69-73` observes disconnect/shutdown and expiry. Nonblocking PCM/stdout pipes prevent transfer or unread input from defeating the deadline. The helper accepts at most 480,000 PCM bytes and 16KiB worker output; workers never receive an HTTP-supplied command.

`scripts/voice_whisper_runtime.py:115` uses `os.killpg(worker.pid, signal.SIGKILL)` and `:119` reaps the worker. Its pipes close in `finally`. Admission is released only after this lifecycle finishes (`scripts/voice-whisper-server.py:126-128`); failed reap closes admission instead of permitting concurrent residual compute. Tests exercise a worker that ignores SIGTERM and never reads stdin, a real HTTP disconnect, timeout → next request, busy 429, malformed/oversize output and graceful shutdown.

`lib/voice/transcribe.ts:28` maps ASR HTTP 504 to a sanitized `VOICE_TIMEOUT` instead of losing the cause in a generic provider failure. Existing success and other provider-error contracts remain covered by the suite.

### P2 — feature acceptance and performance remain open

`docs/voice-search.md` explains per-request model loading. Process isolation makes termination reliable and reloads weights for each request. Three generated-fixture app calls took 3913ms, 2414ms and 2262ms; this is not representative p95/cost or human transcription quality. The 100-request benchmark and remaining browser, deployment and relevance gates stay open in todo/53. This review closes R3, not those gates or the existing project migration item.

## Checks and rejected findings

- A first HTTP test exposed Python timeout sockets waiting inside `recv` despite MSG_DONTWAIT. Fixed at `scripts/voice_whisper_runtime.py:36`: poll readiness before peeking. The real-socket timeout/abort tests now pass; fake socket assertions alone would have missed this.
- Rejected a timeout that only abandons a promise: stalled workers are killed/reaped and the next HTTP request succeeds. The live rebuilt app's aborted request removed its cached-model worker in 61ms, followed by successful transcription.
- Rejected slot release before cleanup: kill/reap happens within the runner before returning/raising to the handler; an unreapable-worker regression verifies the helper stays busy.
- Rejected detached workers on normal service stop: server-close sets a stop event and joins handlers; its active-worker regression verifies termination before close returns. SIGKILL of the helper itself is outside graceful shutdown guarantees.
- Rejected query-audio persistence: validated PCM transfers through memory pipes; stdin/stdout are bounded, stderr is discarded, no query temp files/deletion/index writes were added. Cached model access is separate from recording persistence.
- Rejected unverified model success: generated auto/en/zh probes used actual cached MLX weights with offline mode. The rebuilt app's EN/ZH requests returned transcript responses without retrieval. Neither transcript content nor environment credentials were logged by the acceptance harness.
- Shared text/image/file/live retrieval and ingest code were not changed by this function; the full existing suite remains green. Python3 is now a documented test-harness prerequisite; MLX is optional and not needed by the tests.

Follow-up and commands: [todo/55](../todo/55-voice-asr-cancellation-2026-10-02.md). [todo/54 R3](../todo/54-voice-search-commit-review-2026-10-02.md) is closed with this evidence. Earlier reviews remain historical evidence.

## Gates

| Gate | Result |
| --- | --- |
| Node22 `yarn test --maxWorkers=4` | PASS: 74 files / 536 tests, 7.84s |
| Python process/HTTP contracts through Vitest | PASS: 12 scenarios, no model/download requirement |
| `yarn build` | PASS: compile/typecheck, 21/21 pages, 27.69s |
| `git diff --check` | PASS |
| Cached local MLX adapter auto/en/zh | PASS: generated fixtures, 29/29/11 transcript characters |
| Rebuilt app → cached worker EN/ZH | PASS: HTTP 200 transcript responses |
| Real app disconnect → worker reap → next request | PASS: 61ms reap; next HTTP 200 |
| Full microphone/browser/relevance/human-quality matrix | NOT RUN |
| Representative p95/cost/model-memory benchmark | NOT RUN |
| Docker/container and full media/runtime acceptance | NOT RUN |
| Remote-ASR compute cancellation, multi-replica admission | NOT RUN |
| Whole-repository security/migration review | NOT RUN |
| `yarn lint` | NOT RUN: known unconfigured/interactive command |
