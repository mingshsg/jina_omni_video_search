# Live video Batch 3 verification hygiene — 2026-09-12

**Verdict: PASS WITH NOTES** (gates/hygiene landed; full application soak blocked by environment)

Batch 3 closes readiness **identity and acceptance semantics**, demotes the
scratch runner to an honest **protocol probe**, adds an **application-path E2E**
driver, and completes the small **A-14/V-05** recovery-metadata gap. It does
**not** reopen Phase 10. Playwright remains **NOT RUN**.

**A-20 status (Batch 4):** implemented — see
[`reviews/live-video-batch4-residuals-2026-09-12.md`](./live-video-batch4-residuals-2026-09-12.md).
Forever retention remains the default; age-delete is ops-triggered only.

---

## What was proven

| Item | Result | Evidence |
| --- | --- | --- |
| A-04 / V-08 `READY_STRICT` gate aggregation | **PASS** | `lib/live/readiness-gates.ts` + `readiness-gates.test.ts` (8 cases). Offline STRICT run `reviews/live-rtsp-readiness-readymty5ji4z.json`: `ok=false` when mandatory gates are `NOT RUN`. Smoke twin `…readymty5jpsf.json`: `ok=true` with same NOT RUN rows. |
| A-05 / V-02 worktree identity | **PASS** | Manifests record `git.dirty`, `git.content_hash`, porcelain snippet. Dirty under STRICT blocked unless `READY_ALLOW_DIRTY=1`. |
| A-03 demotion | **PASS** | `yarn live-rtsp-readiness` reports `evidence_class: protocol_probe` and documents that it does not drive public APIs / worker loop / media routes. |
| A-06 / V-03 / V-04 app-path driver | **PARTIAL** | New `yarn live-app-path-e2e` (`scripts/live-app-path-e2e.ts`) drives HTTP create→validate→session→search→Range media→stop→reconnect when web+worker+ES+MediaMTX are reachable. |
| A-14 / V-05 recovery metadata | **PASS** (unit) | `window_finalized` / `window_processed` fields retained in reducer; `buildRecoveryWorkItem` restores hash/timestamps/duration; `applyRecovery` uses it. Test in `lib/live/recovery.test.ts`. |
| Unit suite `lib/live` + `worker` | **PASS** | 33 files / 144 tests (2026-09-12). |
| Full 10-minute soak (`READY_DURATION_SEC=600`) | **NOT RUN** | Host cannot resolve Elastic Cloud DNS (`getaddrinfo ENOTFOUND` / resolver timeout for `videosearch-bb8e23.es.southeastasia.azure.elastic.cloud`). |
| Application-path E2E end-to-end | **FAIL / blocked** | Spawned web/worker; worker bootstrap fails on ES DNS. Example: `reviews/live-app-path-e2e-appe2emty5dbmx.json`. MediaMTX fixture was up; outbound ES name resolution was not. |
| Playwright browser E2E (L5) | **NOT RUN** | No Playwright dependency; deferred with honest gate row. |
| A-08 PTS/signature probe | **Deferred** | Not in Batch 3; fixture-only limitation remains documented. |
| A-20 age-delete + protect | **Deferred** | Unchanged. |

---

## Runner / operator notes

```bash
# Protocol probe (not application acceptance):
yarn live-rtsp-readiness

# Strict acceptance semantics (mandatory gates must be PASS; dirty needs ALLOW):
READY_STRICT=1 READY_ALLOW_DIRTY=1 READY_DURATION_SEC=600 \
  READY_RUN_BUILD=1 READY_RUN_FILE_SMOKE=1 yarn live-rtsp-readiness

# Application path (requires MediaMTX + reachable ES + local FFmpeg):
# Ensure .env.worker has LIVE_SOURCE_FIXTURE_URL (never commit).
READY_SPAWN=1 READY_WINDOWS=2 yarn live-app-path-e2e
```

Smoke mode still allows `NOT RUN` / `PASS_WITH_NOTES` (historical Phase 9
“PASS WITH NOTES” behavior). Strict mode refuses them.

---

## Residual risks

1. **No clean committed revision** — worktree remains dirty on file-video HEAD
   `78d7e56…`; evidence is `content_hash`-scoped until an explicit live commit.
2. **Elastic Cloud DNS/proxy from this host** — blocks live indexing E2E and soak
   until network/DNS is restored.
3. **Playwright** — still absent; UI covered by unit helpers + API path only.
4. **A-08** — codec/PTS discontinuity probing still fixture-limited.
5. **A-20** — forever retention; age-delete + protect ranges still future work.

---

## Phase 10 stance

**Remain closed.** Batch 3 hygiene is in place, but application-ready acceptance
still needs one green `live-app-path-e2e` + honest soak (and preferably a clean
commit) after ES connectivity returns. Next choices: restore network and re-run
app-path/soak, or implement **A-20** retention APIs (Batch 4) without opening
Phase 10 adapters.
