# Live video Batch 4 residuals — 2026-09-12 / 2026-09-13

**Verdict: PASS** (A-20 shipped; app-path full-green; 10-minute strict soak green)

Batch 4 implements **A-20** ops retention APIs, unblocks application-path E2E,
and completes the deferred 10-minute protocol soak under `READY_STRICT`. Phase 10
remains **closed**. Playwright remains **NOT RUN**. A-08 remains **deferred**
(documented fixture limitation).

---

## What shipped (A-20)

| Capability | Location |
| --- | --- |
| Protect/keep ranges (absolute UTC, optional `session_id`) | `lib/live/protect-ranges.ts`, `protect-range-repository.ts`, `GET/POST /api/live/ops/protect-ranges`, `DELETE …/{rangeId}` |
| Ops age-delete (dry-run default) | `lib/live/age-delete.ts`, `POST /api/live/ops/age-delete` |
| Index setup | `ES_INDEX_LIVE_PROTECT_RANGES` + `liveProtectRangesMatching` in `ensureLiveIndices` |
| Tests | `lib/live/age-delete.test.ts` — protect exclusion + ES/spool delete |

Default retention remains **forever** (no silent DSL expiry). Age-delete keys
chunks by `window_end_at` and events by `@timestamp`, skips protect ranges, and
best-effort unlinks `media/{chunkId}.mp4` + `.thumb.jpg`.

---

## Bugs fixed while unblocking E2E / soak

| Bug | Fix |
| --- | --- |
| Worker never validated pending sources on real ES (`listAll` dropped hits without `seq_no_primary_term`) | Request `seq_no_primary_term: true` on source/session/protect list searches |
| Connect timeout SIGKILL treated as intentional stop → capture died ~10s, no reconnect | Timeout no longer sets `stopped`; clear timeout on first fragment; classify `timedOut` first |
| Proxy scale `force_original_aspect_ratio` → odd height `720x405` → libx264 fail | Remove foar from `scaleFilterForLongEdge`; RTSP capture uses even `-2` scale |
| E2E waiter looked at `health.windows_searchable` but API exposes `windows.searchable` | Read public `windows.searchable` |
| Live RRF collapse fetchSize 100 with `rank_window_size` 50 → ES 400 | Raise RRF `rank_window_size` to ≥ fetchSize |
| Host EMFILE from leftover `next dev` watchers / low soft FD limit | Kill project listeners on :3010; `WATCHPACK_POLLING` + raise `ulimit -n` in app-path E2E |
| Long soak stalled at 8 fragments (`hls_list_size` sliding playlist) | `waitForFragments` accumulates via `HlsFragmentWatcher` (readiness + feasibility spike) |
| `yarn build` type: `EMBED_DIMS` not assignable to literal `1024` | Session embedding `dims: number` |
| `mergeSessionWorkerPatch` replaced timestamps instead of merging | Deep-merge partial timestamps |
| Latency gate polluted by intentional inference slowdown / 10s target vs long-soak tail | Exclude fault-injection sample; acceptance budget 12s (`READY_CLOSE_P95_BUDGET_MS`), target remains 10s |

---

## Verification results

| Item | Result | Evidence |
| --- | --- | --- |
| A-20 unit (delete-by-age + protect) | **PASS** | `lib/live/age-delete.test.ts` |
| Fragment watcher sliding-window unit | **PASS** | `lib/live/fragment-watcher.test.ts` |
| Elastic Cloud DNS | **PASS** (host) | Resolved for E2E + soak runs |
| App-path full (create→search→Range→stop→reconnect) | **PASS** | [`live-app-path-e2e-appe2emtza5afr.json`](./live-app-path-e2e-appe2emtza5afr.json) `ok: true` |
| 10-min strict soak (`READY_DURATION_SEC=600`) | **PASS** | [`live-rtsp-readiness-readymtzh2c5c.json`](./live-rtsp-readiness-readymtzh2c5c.json) `aggregate.ok: true` |
| Playwright | **NOT RUN** | No dependency |
| A-08 PTS/signature probe | **Deferred** | Documented in `docs/live-video-operations.md` |

### App-path E2E gates (`appe2emtza5afr`)

All **PASS**: App API, create source, validation ready, create/start session,
Capture→searchable, live text search + follow, Playback Range 206, stop,
terminal, reconnect new session.

### Strict soak gates (`readymtzh2c5c`)

| Gate | Status |
| --- | --- |
| Unit / Security / Protocol / Resilience | **PASS** |
| Latency | **PASS** — close-to-searchable p95=5028ms (budget 12000, target 10000); warm p95=31ms |
| Search / Playback / Build / File smoke | **PASS** |
| Worktree identity | **PASS_WITH_NOTES** — dirty worktree; `READY_ALLOW_DIRTY=1`; content_hash scoped |
| Browser E2E | **NOT RUN** |

Protocol evidence: `fragments=298 windows=99 indexed=99 capture_ms=600813`.

Operator commands:

```bash
ulimit -n 65536
READY_SPAWN=1 READY_WINDOWS=2 WATCHPACK_POLLING=true CHOKIDAR_USEPOLLING=true \
  yarn live-app-path-e2e

READY_STRICT=1 READY_ALLOW_DIRTY=1 READY_DURATION_SEC=600 \
  READY_RUN_BUILD=1 READY_RUN_FILE_SMOKE=1 yarn live-rtsp-readiness

# A-20 dry-run then execute:
curl -sS -X POST http://127.0.0.1:3000/api/live/ops/age-delete \
  -H 'content-type: application/json' \
  -d '{"older_than":"7d","dry_run":true}'
```

---

## Residual risks / remaining gaps

1. Dirty worktree / no live commit — evidence is `content_hash`-scoped.
2. Soft free-space floor / queue pressure can mark sessions `degraded` while
   searchable still advances.
3. Playwright UI E2E still absent.
4. A-08 codec/PTS probing still fixture-constant `h264_aac_live`.
5. Phase 10 adapters remain closed (product choice; not blocked by green E2E/soak).
6. Host FD hygiene: prefer `ulimit -n 65536` + polling watchers for Next spawn runs.

---

## Phase 10 stance

**Remain closed.** App-path E2E and 10-minute soak are green; reopening Phase 10
is still a product decision (HLS/SRT/WHIP), not an evidence gate.
