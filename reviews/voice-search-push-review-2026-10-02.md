# Voice search push review — 2026-10-02

Scope: unpushed commits `aa6a793` and `9e6f563` compared with remote `ce3ab15`, plus the fixes below. Refreshed origin and confirmed PR #2 is open/draft, head `codex/voice-search`, base `live-video-search`. Covers upload removal, opt-in complete search results, local ASR worker lifecycle, adapter timeout mapping and their regression coverage.

**Verdict: two P2 findings fixed and regression-checked; no remaining blocker found for pushing this scope to the existing draft PR. This is not merge/release acceptance.**

## Findings and dispositions

### P2 R1 — Unfinished HTTP requests blocked graceful helper shutdown — fixed

At reviewed `9e6f563`, `scripts/voice-whisper-server.py:29` set `daemon_threads = False`, while `server_close()` only set the compute stop event and joined threads. The socket timeout was assigned inside `do_POST`, after request-line/header parsing. An idle connection or partial request could therefore keep a handler blocked and prevent service exit even though no model was running.

Three real-socket regressions reproduced this: idle connection, partial headers and partial upload each failed the one-second shutdown assertion before the fix. The corrected `scripts/voice-whisper-server.py:59` calls `connection.shutdown(socket.SHUT_RDWR)` on accepted connections before joining handlers; `:66` sets the inactivity timeout at acceptance. All three cases now pass, along with active-worker shutdown and normal requests.

### P2 R2 — Unexpected group-termination errors bypassed cleanup quarantine — fixed

At reviewed `9e6f563`, `scripts/voice_whisper_runtime.py:115` called `os.killpg(...)` outside the wait/pipe-close `finally` and caught only `ProcessLookupError`. Another OS error would skip reap/pipe closure and reach the handler's generic failure path, which released the admission slot. This contradicted its stated behavior when termination cannot be confirmed.

The corrected `scripts/voice_whisper_runtime.py:120-129` records an unexpected signalling error, attempts reap, then raises `WorkerCleanupFailed`; `:130-132` always closes pipes. Fault injection verifies this distinct cleanup failure and closed pipes; the existing HTTP regression verifies that cleanup failure keeps admission closed. Cleanup state is also initialized before socket bind (`scripts/voice-whisper-server.py:35-38`), because TCPServer invokes `server_close` on a failed bind; an occupied-port regression now verifies the original OSError is preserved.

## Checks and rejected findings

- **Legacy search behavior:** `requireCompleteResults` is optional, enabled only by voice. Regression coverage checks Audio, Visual and each All branch for timeout/failed-shard rejection while preserving legacy request bodies and response handling.
- **Upload retention:** removing the file now clears the clip, returns state to idle and invalidates any request. The clip effect revokes its preview URL and submission requires a current clip. Browser removal/reselection acceptance remains tracked, not inferred from this code review.
- **ASR mode/identity:** server owns the worker command/model and validates request model/language/WAV input; Spoken Request returns a transcript with no implicit search. Worker output is bounded and validated, and upstream diagnostics stay out of API errors.
- **Resource release:** inspected normal success, blocked input, client abort, deadline, malformed/oversize output, worker failure, service shutdown and failed cleanup. Real-process/HTTP regressions cover these boundaries with generated fixtures. The 25s compute bound includes model load and pipe transfer.
- **Secrets and scope:** `.env` remains ignored; tracked environment files are examples. Common credential-pattern scan of changed tracked content returned zero matches. No query-file persistence, direct deletion, ingestion/index changes or unrelated checkout edits were added. This is a scoped scan, not a whole-repository security audit.
- **Publication:** refreshed remote branch was an ancestor of local HEAD (0 remote-only / 2 local-only commits before the review fix). The PR stays draft; browser/microphone, human relevance, representative p95/cost, Docker/full-runtime gates in todo/53 remain open. Project migration item todo/31 X1b is outside this review.

Tracker: [todo/56](../todo/56-voice-search-push-review-2026-10-02.md). Prior reviews retain their historical evidence; this review supplies the current push verdict and follow-up lifecycle corrections.

## Gates

| Gate | Result |
| --- | --- |
| Three unfinished-HTTP shutdown regressions before fix | FAIL reproduced; all three PASS after fix |
| Node22 `yarn test --maxWorkers=4` | PASS: 74 files / 536 tests, 9.75s |
| Python lifecycle regressions via Vitest wrapper | PASS: 17 scenarios, including five new push-review cases |
| `yarn build` | PASS: compile/typecheck, 21/21 pages, 29.09s |
| `git diff --check` | PASS |
| Common credential-pattern scan / ignored env | PASS within changed tracked content; no values emitted |
| Refreshed app → cached local Whisper EN/ZH | PASS: HTTP 200, 29/11 transcript characters; individual calls 4834/2691ms |
| Actual app abort → worker reap → next request | PASS: 58ms reap; next EN request HTTP 200 in 2420ms |
| Browser upload/microphone/cross-browser acceptance | NOT RUN in this review |
| Human relevance/quality, 100-request p95/cost | NOT RUN |
| Docker and full file/image/library/media/live runtime acceptance | NOT RUN |
| Multi-replica/provider-retention/full security assessment | NOT RUN |
| `yarn lint` | NOT RUN: unconfigured interactive command |
