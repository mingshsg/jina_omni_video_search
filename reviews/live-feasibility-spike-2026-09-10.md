# Live feasibility spike — 2026-09-10

Status: **PASS (with latency-budget note)**

Gate before Phase 3: ≥50 windows through MediaMTX → HLS `temp_file` fragments →
4-fragment MP4 remux → live proxy → EIS inference → scratch data stream
`refresh=wait_for` on `.env` Elasticsearch.

## Commands

```bash
docker compose -f docker-compose.live.yml up -d
yarn live-feasibility-spike          # SPIKE_WINDOW_COUNT=50
# smoke: SPIKE_WINDOW_COUNT=2 yarn live-feasibility-spike
```

## Full run (n=50) — PASS

JSON: [`reviews/live-feasibility-spike-spikemtvq3itg.json`](./live-feasibility-spike-spikemtvq3itg.json)

| Metric | p50 | p95 | p99 |
| --- | ---: | ---: | ---: |
| Fragment duration (ms) | 2000 | 2000 | 2000 |
| Drift from 2000 ms | 0 | 0 | 0 |
| Remux (ms) | 398 | 1261 | 7261 |
| Proxy (ms) | 2296 | 6022 | 10410 |
| Inference (ms) | 601 | 695 | 776 |
| Index+`wait_for` (ms) | 2649 | 4733 | 4945 |
| Close-to-searchable (ms) | — | **12200** | — |

- Capture wall time: ~344 s for 151 fragments
- RTSP flags: `-rtsp_transport tcp`, `-timeout 15000000`, protocol whitelist
  `file,crypto,data,rtsp,tcp,udp,rtp,http,https,tls`
- Scratch stream created and **deleted** after the run
- Exit code: **0**, `"ok": true`

## Smoke (n=2)

JSON: [`reviews/live-feasibility-spike-spikemtvpysng.json`](./live-feasibility-spike-spikemtvpysng.json) — also OK.

## Fixes discovered during spike

1. Host FFmpeg 8.1.1 rejects `-rw_timeout` on RTSP (`Option rw_timeout not found`).
   Capture uses `-timeout` (µs) only.
2. Long-running capture must set ProcessSupervisor `disableConnectTimeout`
   (warning/info banners are not reliable connect signals).
3. Receive-anchor: sample worker discovery time per playlist entry; do not batch
   stamp all fragments at parse end.

## Receive-anchor uncertainty

Reported PDT-vs-discovery deltas remain large on this fixture run (p50 ~48 s).
MediaMTX rewrites timestamps; PDT alone is insufficient. **Phase 3 watcher must
persist `process.hrtime.bigint()` + `Date.now()` at finalize** and treat
`uncertainty_ms` as spread vs that sample (target ≤ one fragment / 2000 ms).
This does **not** block fragment-aligned assembly.

## Architecture adjustments before / during Phase 3

| Topic | Decision |
| --- | --- |
| Window rule | **Keep fragment-aligned 4 fragments / step 3** — drift evidence excellent |
| 10 s close-to-searchable budget | **Not met at p95 (~12.2 s)**; dominated by proxy + single-doc `refresh=wait_for`. Phase 4 micro-batch indexing and live proxy ladder tuning required; do not change 4/3 assembly |
| Retention / spool | Unchanged: forever until delete; unlimited spool |

## Phase 3 code landed alongside the gate

Assembler, JSONL manifest reducer, HLS `temp_file` capture argv, remux, spool
paths/accounting, fragment watcher, and unit tests (see `todo/01-live-video-search-todo.md`).
