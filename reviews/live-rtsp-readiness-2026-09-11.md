# Live RTSP readiness — 2026-09-11

Status: **PASS WITH NOTES** (shortened protocol soak; Playwright NOT RUN)

Commit: `78d7e569edc3f975e1b96199d14bf0a87c93a15a`  
Branch: `live-video-search`

| Manifest | Role |
| --- | --- |
| [`live-rtsp-readiness-readymtx3xg5w.json`](./live-rtsp-readiness-readymtx3xg5w.json) | Primary protocol soak (`READY_WINDOWS=6`) + search/cache/playback/resilience + file smoke |
| [`live-rtsp-readiness-readymtxc7oky.json`](./live-rtsp-readiness-readymtxc7oky.json) | Offline follow-up: unit + security + **build PASS** (`READY_SKIP_PROTOCOL=1 READY_RUN_BUILD=1`) |

## Commands

```bash
docker compose -f docker-compose.live.yml up -d
# Digests pinned in docker-compose.live.yml (2026-09-11)
READY_WINDOWS=6 READY_INFER_SLOWDOWN_MS=2000 READY_RUN_FILE_SMOKE=1 yarn live-rtsp-readiness
# Build confirmation (after TypeScript fixes for live ES client / process supervisor / tsconfig):
READY_SKIP_PROTOCOL=1 READY_RUN_BUILD=1 node --import tsx scripts/live-rtsp-readiness.ts
# Full 10-minute protocol soak (optional / still outstanding):
# READY_DURATION_SEC=600 yarn live-rtsp-readiness
```

## Pinned containers

| Image | Digest |
| --- | --- |
| MediaMTX 1.21.0 | `bluenviron/mediamtx@sha256:19fddade8d6110a3d718ac0045681fbeba344ae563a066205fe5929a87f7582f` |
| FFmpeg publisher | `linuxserver/ffmpeg@sha256:2d1569b07dd249fd8a4eeff0afb3c7e4a2e83e6b37d97bf28837f6ccd57b23d8` |

## Gate table (`docs/live-video-operations.md`)

| Gate | Status | Evidence |
| --- | --- | --- |
| Unit | **PASS** | `yarn vitest run lib/live lib/es lib/media lib/ingest worker` exit 0 |
| Build | **PASS** | `yarn build` exit 0 (`readymtxc7oky`); fixes: `tsconfig` excludes `data/`/`tmp/`, `LiveHitCard` key handler, `LiveEsClient` unbound methods, `appendManifestRecord` type, `ProcessSupervisor` ChildProcess typing |
| Protocol | **PASS_WITH_NOTES** | 19 fragments / 6 windows indexed; capture ~40s (`readymtx3xg5w`). Not a full 10-minute soak — re-run with `READY_DURATION_SEC=600` |
| Resilience | **PASS** | Publisher bounce (`disconnect`) + `yarn live-rtsp-fixture-smoke` reconnect + mid-batch inference slowdown |
| Latency | **PASS** | close-to-searchable **p95=5030 ms** (budget 10000); warm knn **p95=51 ms** (budget 2000) |
| Search | **PASS** | Text+image query-vector cache: miss then hit; **one** text inference before TTL; knn hits=5 |
| Playback | **PASS** | Retained clip Range 0–3 → simulated **206** |
| Security | **PASS** | Web rejects `LIVE_SOURCE_*`; secret scan skips intentional `*.test.ts` fixtures |
| Regression | **PASS** | `smoke-phase8-search` exit 0 (file-video path) |
| Browser E2E | **NOT RUN** | No Playwright in repo; Phase 8 UI unit helpers only |

## Metrics (READY_WINDOWS=6)

| Metric | p50 | p95 | p99 |
| --- | ---: | ---: | ---: |
| Fragment duration (ms) | 2000 | 2000 | 2000 |
| Drift from 2000 ms | 0 | 0 | 0 |
| Remux (ms) | 136 | 356 | 356 |
| Proxy (ms) | 818 | 1228 | 1228 |
| Inference (ms) | 735 | 2746 | 2746 |
| Index+`wait_for` (ms) | 3120 | 3411 | 3411 |
| Close-to-searchable (ms) | 5018 | **5030** | 5030 |
| Warm search (ms) | 16 | **51** | 51 |

- Duplicates: 0 · Retries: 0 · Expected windows: 6 · Observed: 6
- Scratch stream created and deleted on the `.env` Elastic endpoint
- Faults: `disconnect=true`, `worker_restart=true`, `inference_slowdown=true`

## Notes / remaining production gates

1. **10-minute soak** not executed in this run (`READY_DURATION_SEC=600` still required for the strict Protocol gate wording).
2. **Playwright browser flow** (create → follow → play → disconnect/reconnect UI) remains **NOT RUN**.
3. Latency improved vs 2026-09-10 spike (p95 close-to-searchable 12.2s → **5.0s** on this short sample).
4. Do **not** treat this MVP evidence as multistream production readiness.
5. Runner: `yarn live-rtsp-readiness` (`scripts/live-rtsp-readiness.ts`).

## Product decisions (unchanged)

Forever retention · unlimited spool · localhost 554/8554 · single stream/worker/web · WHIP deferred · separate worker image.
