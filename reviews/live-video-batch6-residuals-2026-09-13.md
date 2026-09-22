# Live video Batch 6 residual fixes — 2026-09-13

**Verdict: PASS** (program-correctness actionable bugs fixed; product deferrals unchanged)

Cross-check of Batch 5 +
[`program-correctness-completion-review-2026-09-13.md`](./program-correctness-completion-review-2026-09-13.md)
against the current worktree (Phase 10 opt-in present). Fixed only still-open
correctness / isolation holes. Product locks unchanged: no auth, Playwright
optional, A-08 PTS deferred, RTMP deferred, multi-stream deferred, retained-cap
eviction deferred while caps unused.

---

## Status matrix (program-correctness IDs)

| ID | Topic | Status |
| --- | --- | --- |
| A-01 Uncommitted live tree | Commit hygiene | **Deferred-OK** (user: no commit) |
| A-02 HLS continuous playlist mediation | Dynamic graph | **Deferred-OK** (preflight + referenced URI check remains; continuous FFmpeg mediation is larger architecture) |
| A-03 Literal-IP HLS vs TLS/SNI | Hostname TLS | **Deferred-OK** (known literal-bind tradeoff; prefer IP endpoints for demo) |
| A-04 Query params dropped | Signed URLs | **Fixed** — `search` preserved on private rewrite; omitted from provenance |
| A-05 Authenticated HLS preflight | Basic auth | **Fixed** — playlist fetch sends Basic; credentials dropped on cross-origin redirect |
| A-06 SRT listener “peer” = bind IP | False admission | **Fixed** — allowlist is fail-closed ops gate only; docs corrected |
| A-07 SRT passphrase / ffconcat | Injection / length | **Fixed** — 10–79 + no controls; ffconcat rejects newlines/NUL |
| A-08 PATCH incompatible transport | API store invalid config | **Fixed** — `patchSource` reuses `transportsForProtocol` |
| A-09 Endless reconnect on exit 1 | Retry budget | **Deferred-OK** (reconnect desired for MVP; not a broken default) |
| A-10 Partial DBQ unlinks survivor media | Data integrity | **Fixed** — re-search survivors before media reclaim |
| A-11 Truncated scan still mutates | Partial delete | **Fixed** — refuse mutation when truncated (dry_run still reports) |
| A-12 Protect vs age-delete race | Concurrent ops | **Deferred-OK** (serialize ops manually for demo) |
| A-13 App E2E cleanup honesty | Evidence | **Deferred-OK** (hygiene; not blocking) |
| A-14 Strict readiness vs docs | Playwright/tsc/lint | **Deferred-OK** (product) |
| A-15 Phase 10 overclaim | Soak evidence | **Deferred-OK** — remote soak still open; unit gates only |
| A-16 WHIP example anonymous | Fixture security | **Fixed** — loopback bind + placeholder credentials |
| A-17 HLS capability not enforced | Isolation | **Fixed** — worker validation requires `manifestSupportsHls` |
| A-18 Worker image root/unpinned | Ops | **Deferred-OK** |
| A-19 Evidence hash noise | Hygiene | **Deferred-OK** |
| A-20 Cap eviction / PTS | Product | **Deferred-OK** |

---

## Code changes

| Area | Change |
| --- | --- |
| `lib/live/source-url.ts` | Preserve validated `search` on bind rewrite |
| `lib/live/control-service.ts` | PATCH transport validation |
| `lib/live/age-delete.ts` | Partial DBQ survivor check; refuse truncated mutation |
| `lib/live/memory-es.ts` | `ids` query support for survivor search |
| `lib/live/source-adapter.ts` | ffconcat newline/NUL rejection |
| `lib/live/adapters/srt.ts` | Passphrase contract; honest listener peer gate |
| `lib/live/adapters/hls.ts` + `registry.ts` | HLS capability gate |
| `lib/live/hls-playlist.ts` | Authenticated preflight + safe redirect credential drop |
| `test/fixtures/live/mediamtx-phase10.example.yml` | Loopback + non-anonymous placeholders |

---

## Verification

```text
yarn vitest run lib/live worker
# 35 files / 170 tests PASS (2026-09-13)
```

Intentionally not run: Phase 10 remote soak, Playwright, clean-commit acceptance.
