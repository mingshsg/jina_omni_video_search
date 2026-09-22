# Live Video Operations and Acceptance

Status: **planned; targets are not measured live results**

## Verified technology baseline

| Component | Baseline | Evidence |
| --- | --- | --- |
| Existing application | Next.js 14.2.35, React 18.3.1, Node 22 | Current repository and passing production build |
| Elasticsearch client | repository resolves 8.19.2; server observed 9.6.0 | Phase 1 must prove compatibility or move lifecycle/template calls to a tested 9.x path |
| Media processing | host-observed FFmpeg/ffprobe 8.1.1 | Local evidence only; worker image must be pinned and probed before Phase 2 |
| Embedding | `jina-embeddings-v5-omni-small`, 1024 dims | Existing EIS probe and file-video E2E |
| Remote pull | RTSP over TCP | FFmpeg documents RTSP demuxing and TCP interleaving: https://ffmpeg.org/ffmpeg-protocols.html#rtsp |
| Browser ingest | WHIP | IETF Standards Track RFC 9725: https://www.rfc-editor.org/rfc/rfc9725.html |
| Protocol gateway/test server | MediaMTX 1.21.0 | Current release verified 2026-09-10: https://github.com/bluenviron/mediamtx/releases/tag/v1.21.0 |
| Live-vector retention | Elasticsearch Data Stream Lifecycle | Elastic Serverless guidance: https://www.elastic.co/docs/manage-data/lifecycle/data-stream/tutorial-data-stream-retention |

MediaMTX is a seed, not an unbounded floating dependency. Docker uses an exact
image tag and records the resolved digest in acceptance evidence.

The current application image installs Debian Bookworm FFmpeg rather than the
host-observed 8.1.1 build. Phase 1 must create a dedicated worker image, pin its
Node/FFmpeg image digest, and record `ffmpeg -version`, `-buildconf`, protocols,
demuxers, and encoders. SRT stays disabled unless that probe reports `srt`.

## Configuration contract

Secrets belong in `.env`, which is never committed.

Elasticsearch is external infrastructure. Development and acceptance must not
install, download, start, or add a local Elasticsearch container/service. The
web process, worker, setup script, feasibility spike, and E2E runner all use only
`ELASTICSEARCH_URL` and `ELASTICSEARCH_API_KEY` supplied through the repository
`.env` file. MediaMTX and FFmpeg test containers are
allowed and do not alter this Elastic boundary.

| Variable | Assumed default | Purpose |
| --- | --- | --- |
| `ES_INDEX_LIVE_SOURCES` | `live-video-sources` | source control index |
| `ES_INDEX_LIVE_SESSIONS` | `live-video-sessions` | session control index |
| `ES_INDEX_LIVE_WORKERS` | `live-video-workers` | singleton worker heartbeat and capabilities |
| `ES_DATA_STREAM_LIVE_CHUNKS` | `live-video-chunks` | append-only searchable windows |
| `ES_DATA_STREAM_LIVE_EVENTS` | `live-video-events` | durable SSE/follow event log |
| `LIVE_ALLOWED_PROTOCOLS` | `rtsp` | deny-by-default source protocols (`rtsp\|hls\|srt\|whip`); extensions are opt-in |
| `LIVE_ALLOWED_HOSTS` | `localhost,127.0.0.1` | MVP allowlist (exact hosts / suffixes / CIDRs); required non-empty |
| `LIVE_ALLOWED_PORTS` | `554,8554` | allowed remote ports (MediaMTX fixture uses `8554`; add `80,443,8888,8890` only when enabling HLS/SRT) |
| `LIVE_RTSP_TRANSPORT` | `tcp` | RTSP MVP transport |
| `LIVE_SRT_PEER_ALLOWLIST` | empty | SRT **listener** fail-closed gate: must be non-empty before listener bind is allowed. Connected-peer admission is **not** enforced inside the worker (FFmpeg has no peer callback here); configure MediaMTX/firewall for real peer allowlisting. Empty denies listener. |
| `LIVE_CONNECT_TIMEOUT_MS` | `10000` | initial/reconnect connect timeout (cleared once FFmpeg reports media) |
| `LIVE_READ_TIMEOUT_MS` | `15000` | RTSP socket I/O timeout (`ffconcat option timeout`, microseconds = ms × 1000) |
| `LIVE_RECONNECT_MAX_MS` | `10000` | capped backoff |
| `LIVE_FRAGMENT_MS` | `2000` | normalized fragment duration |
| `LIVE_WINDOW_MS` | `8000` | embedding window |
| `LIVE_OVERLAP_MS` | `2000` | semantic overlap |
| `LIVE_QUEUE_MAX_WINDOWS` | `12` | bounded work queue |
| `LIVE_INDEX_ACK_QUEUE_MAX_WINDOWS` | `12` | completed windows awaiting a batch slot |
| `LIVE_INDEX_MAX_IN_FLIGHT_BATCHES` | `2` | bounded refresh-wait queue |
| `LIVE_PROCESSING_CONCURRENCY` | `2` | simultaneous live window processors |
| `LIVE_WINDOW_DEADLINE_MS` | `15000` | total proxy/inference attempt deadline |
| `LIVE_EMBED_MAX_ATTEMPTS` | `3` | live-specific provider attempt cap |
| `LIVE_EMBED_RETRY_MAX_MS` | `5000` | live-specific total retry-backoff cap |
| `LIVE_INDEX_MAX_ATTEMPTS` | `3` | persisted cross-restart index-attempt cap |
| `LIVE_PROXY_MAX_LONG_EDGE` | `720` | first live video-proxy resolution rung |
| `LIVE_PROXY_MAX_ATTEMPTS` | `3` | maximum live encode/probe ladder attempts |
| `LIVE_PENDING_SPOOL_MAX_BYTES` | unset/`0` = unlimited | optional pending-spool byte cap |
| `LIVE_RETAINED_MEDIA_MAX_BYTES` | unset/`0` = unlimited | optional retained clip/thumb byte cap |
| `LIVE_SPOOL_MIN_FREE_BYTES` | `53687091200` (50 GiB) | soft free-space floor; `0` disables; pause capture with `LIVE_DISK_FREE_LOW` |
| `LIVE_MANIFEST_RESERVE_BYTES` | `1048576` | refuse manifest append when free disk < reserve (terminal-record headroom) |
| `LIVE_DROP_POLICY` | `oldest` | explicit action after hard limit (only when a finite spool/queue cap is set) |
| `LIVE_VECTOR_RETENTION` | `forever` | **no age-based purge**; DSL lifecycle without `data_retention` |
| `LIVE_EVENT_RETENTION` | `forever` | **no age-based purge**; same indefinite DSL policy |
| `LIVE_CLIP_RETENTION` | `forever` | local clip/thumb until explicit delete (replaces assumed 24h) |
| `LIVE_QUERY_CACHE_TTL_MS` | `300000` | follow-search query-vector reuse |
| `LIVE_EVENT_POLL_MS` | `500` | Elasticsearch event polling interval |
| `LIVE_SEARCH_MAX_RANGE` | `24h` | maximum ad hoc live-search interval |
| `LIVE_API_MAX_BODY_BYTES` | `65536` | JSON mutation request ceiling |
| `LIVE_IMAGE_QUERY_MAX_BYTES` | `5242880` | decoded image-query ceiling |
| `LIVE_MUTATION_RATE_PER_MINUTE` | `30` | per-client source/session mutation limit |
| `LIVE_WORKER_ID` | generated | diagnostic worker identity |
| `LIVE_WORKER_STALE_MS` | `15000` | API heartbeat freshness threshold |
| `LIVE_SPOOL_DIR` | `./data/live-spool` | writable root containing the singleton lock |
| `LIVE_STOP_DRAIN_TIMEOUT_MS` | `30000` | default stop/drain deadline |
| `LIVE_SOURCE_<NAME>_URL` | none | worker-only; put in `.env.worker`, never in web `.env` |

Each connection variable contains a JSON object matching the structured secret
in [`live-video-state-recovery.md`](./live-video-state-recovery.md), not a URL
with userinfo. Configuration validation fails startup if live mode is enabled
without allowed hosts, both queue limits, a decoded image-query limit, positive
safe-integer durations, valid windowing, distinct live storage names, or an
exclusive worker lock. Spool byte caps are optional (`0`/unset = unlimited
retained growth). Soft free-space floor defaults to 50 GiB
(`LIVE_SPOOL_MIN_FREE_BYTES`; `0` disables). The fragment target must divide
both the window and its step. Age-based vector / event / clip retention is
**not** applied automatically; forever is the default. Ops-triggered age-delete
plus protect/keep ranges (A-20 redesign) are the planned reclaim path.

The stop API may request a lower `drain_timeout_ms` than the configured default,
but may not exceed `LIVE_STOP_DRAIN_TIMEOUT_MS`. Omitting it uses the default.

## Latency budget

Existing measurements provide only a planning baseline: EIS video inference was
about 2.2 seconds and audio about 0.45 seconds for one sample. Live video and
audio will run concurrently, but encode, queue, network, and refresh must be
measured again.

Before Phase 3, run the disposable media/latency spike defined in the
implementation plan. It must sample at least 50 windows through MediaMTX,
fragmenting, remux, proxy creation, parallel inference, and scratch-stream
`refresh=wait_for` on the `.env`-configured external Elastic instance. The spike
must use uniquely prefixed scratch names and delete only those resources after
the run. It can change queue sizes and latency targets before
durable pipeline work begins; it is not production code.

| Stage after window close | Initial p95 budget |
| --- | ---: |
| Fragment finalization and assembly | 500 ms |
| Proxy encode and thumbnail | 1,500 ms |
| Parallel video/audio inference | 3,000 ms |
| Index create and refresh | 4,500 ms planning budget; Serverless distribution must be measured |
| Event and overhead | 500 ms |
| **Total close-to-searchable** | **10,000 ms planning target**; readiness acceptance budget **12,000 ms** p95 (`READY_CLOSE_P95_BUDGET_MS`) |

At the configured fragment target, a four-fragment window advances every three
fragments, nominally every 6 seconds or 10 windows/minute. Actual cadence follows
finalized fragment arrival. The file-video E2E measured about 19.9 fine windows/minute, so
one stream appears feasible but two streams have no proven headroom. Serverless
refresh can dominate this budget, so indexing runs asynchronously from capture
through a bounded acknowledgment queue and groups ready documents into a small
bulk with one `refresh=wait_for`. This
is a planning inference, not a live capacity result.

## Worker health

The worker exposes or persists:

- process uptime and worker ID;
- heartbeat freshness, capability hash, and image digest;
- desired/observed session state, event revision, and singleton-lock status;
- last packet, fragment, window, inference, index, and searchable timestamps;
- capture and processing lag histograms;
- active FFmpeg PID count;
- queue depth/high-water mark and spool bytes;
- reconnect attempts and current backoff;
- searchable, failed, retried, duplicate-acknowledged, dropped, and expired
  window counters;
- per-stage duration and provider status/error code.

No metric or log label contains the raw endpoint, credential value, media bytes,
or absolute spool path.

## Backpressure runbook

1. At queue warning threshold, set `observed_state=degraded` and emit
   `LIVE_QUEUE_LAGGING`.
2. Continue capture while the bounded spool has capacity.
3. At the hard queue or pending-spool limit, atomically claim the oldest queued,
   non-processing window ordered by epoch and sequence, persist a terminal drop
   record, and only then delete its media. If no window is eligible, stop capture.
4. Return to `live` only after queue depth and processing lag remain below the
   recovery threshold for a configured interval.
5. Retained media is evicted only under its separate retention/quota policy and
   produces `media_expired`; index acknowledgment alone never deletes it.
6. If reserved headroom cannot record a terminal entry, stop capture and fail
   the session rather than claim continued complete indexing.

## Security checks

- Only schemes in `LIVE_ALLOWED_PROTOCOLS` are accepted.
- Host entries are exact hostnames, exact IP literals, CIDRs, or a leading-dot
  DNS suffix that matches subdomains only. Empty and bare suffix tokens fail
  configuration validation.
- Parse URLs structurally; reject userinfo and control characters.
- Resolve all addresses and reject loopback, link-local, multicast, metadata,
  Unix socket, file, pipe, and unapproved private ranges unless an explicit
  deployment allow rule names them.
- Repeat resolution checks on reconnect and HLS redirects (playlist, segment,
  and encryption-key URIs are revalidated against the same allow policy).
- SRT is refused unless the worker capability manifest reports `srt`, and
  listener mode additionally requires `LIVE_SRT_PEER_ALLOWLIST`.
- WHIP publish credentials and ICE/STUN/TURN live in the MediaMTX gateway
  profile; the worker only validates the internal RTSP subscribe URL.
- Require every address returned for a hostname to pass policy, then bind the
  actual FFmpeg connection with literal-address rewriting where safe and worker
  network egress controls. Preflight DNS validation alone is insufficient.
- Pass `-protocol_whitelist` to FFmpeg and disable nested protocols not required
  by the selected adapter.
- Spawn FFmpeg without a shell. Do not log command arguments until credential-
  bearing values are redacted. Prefer a mode-0600 private ffconcat input script
  so RTSP userinfo never appears in FFmpeg argv (`ps`); residual risk is
  same-UID readers of the script file while capture is running — treat the
  worker host as trusted.
- Limit output path to the resolved session spool directory.
- Run worker and gateway as non-root with read-only application filesystem and a
  bounded writable media volume.

Docker Compose reads the shared repository `.env` for Elastic and public live
configuration. The **web** service mounts only `.env`. The **live-worker** service
mounts `.env` plus `.env.worker` (see `.env.worker.example`) so `LIVE_SOURCE_*`
secrets never enter the web process. Web startup fails if a `LIVE_SOURCE_*`
secret is present. Host `yarn live-worker` loads the same pair via
`loadWorkerDotenv()`. The MediaMTX fixture uses a separate publisher image
containing FFmpeg because the official MediaMTX image does not include it.

### Local webcam (macOS) → MediaMTX RTSP

For demos with the system camera, publish into the existing fixture on an
**additive** path `/webcam` (default e2e `/fixture` publisher is unchanged):

1. Start MediaMTX: `docker compose -f docker-compose.live.yml up -d mediamtx`
   (recreate after `mediamtx.yml` changes:
   `docker compose -f docker-compose.live.yml up -d --force-recreate mediamtx`).
2. On the host: `yarn live-webcam-publish --list`, then
   `yarn live-webcam-publish` (or `bash scripts/live-webcam-publish.sh`).
   Optional mic: `--with-audio --audio-device <n>`. Smoke: `--smoke`.
   Host publish target stays `rtsp://127.0.0.1:8554/webcam` (ffmpeg runs on the Mac).
3. Put in **`.env.worker` only** — URL is what the **worker** dials:
   - **Docker `live-worker` (this repo’s usual setup):**
     `LIVE_SOURCE_WEBCAM_URL={"url":"rtsp://host.docker.internal:8554/webcam"}`
     Ensure `.env` allowlist includes `host.docker.internal` (default/example does).
     Compose maps `host.docker.internal` → host gateway for the worker.
   - **Host `yarn live-worker`:**
     `LIVE_SOURCE_WEBCAM_URL={"url":"rtsp://127.0.0.1:8554/webcam"}`
   Do **not** use `127.0.0.1` inside a Docker worker — that is the container loopback,
   not MediaMTX on the host / other compose project.
4. Restart `live-worker`, then open `/live` → create source with
   `connection_ref` `LIVE_SOURCE_WEBCAM_URL` → wait **ready** → Start session
   (app often on `:3001`).

Requires host FFmpeg with AVFoundation (`brew install ffmpeg`). Grant macOS
**Privacy & Security → Camera** (and **Microphone** if using audio) to the
terminal app that launches ffmpeg. Prefer Terminal.app / iTerm: Cursor agent
shells can list AVFoundation devices but often cannot open the camera. Do not
use `--path fixture` while `live-publisher` owns that path. Default protocol
allowlist stays RTSP-only.

### Deleting leftover sources

`DELETE /api/live/sources/{sourceId}` removes the source registry entry. The
`/live` UI exposes **Delete** (with confirm), optionally hides `app-e2e-*`
names, and offers **Delete all e2e sources**. If a non-terminal session still
holds the claim, stop that session first (`409 LIVE_SESSION_CONFLICT`). Indexed
windows are not cascade-deleted — use age-delete for retention reclaim.
If the app runs in Docker on `:3001`, rebuild the `app` image after pulling
these UI/API changes.

Spool byte caps remain optional (unset/`0` = unlimited retained growth). Separately,
`LIVE_SPOOL_MIN_FREE_BYTES` defaults to **50 GiB**: when free space on the spool
filesystem falls below that floor, capture pauses with `LIVE_DISK_FREE_LOW` /
`degraded`→`failed` rather than filling the disk. Set `0` to disable the soft
floor. Age-based reclaim (A-20: ops age-delete + protect/keep ranges) is available
as an **explicit** ops path (`POST /api/live/ops/age-delete`, protect-range CRUD
under `/api/live/ops/protect-ranges`) and does **not** run automatically. Default
`dry_run: true` on age-delete; forever retention remains until operators execute.

### A-08 known limitation (fixture MVP)

For the controlled MediaMTX RTSP fixture, capture still records a constant
media signature `h264_aac_live` and does not yet probe finalized fragments for
codec/audio/PTS discontinuities. Real multi-codec sources may need epoch opens
that this MVP does not detect — tracked as deferred A-08 (not a Batch 4 gate).

The live media processor passes explicit live retry options rather than the
file pipeline defaults. Its fixed video proxy ladder starts at 720 px and has at
most three CRF attempts. Audio retains the existing Opus proxy bytes and request
content-type behavior; record the codec honestly and do not change only the live
path. The per-window deadline covers proxy, thumbnail, and provider work and
produces a retryable attempt record before the persisted attempt budget is
exhausted.

## Deterministic acceptance fixture

Use a small checked-in or reproducibly generated non-confidential video fixture.
In Docker Compose, MediaMTX receives a real-time loop and exposes RTSP. The
fixture sets `LIVE_ALLOWED_PORTS=8554` to match MediaMTX's default listener. The
runner records a manifest containing:

- git commit and branch;
- dependency/container versions and MediaMTX digest;
- source fixture checksum;
- source/session/variant IDs and all live configuration;
- expected and observed window identities;
- one forced disconnect and one worker restart;
- per-stage timestamps and percentile calculations;
- failures, retries, duplicate acknowledgments, drops, and queue high-water;
- text/image fixture queries, expected time ranges, result IDs, and playback
  HTTP status.

For a fault-free epoch with `F` finalized fragments, `K` fragments per window,
and advance `A`, the expected full-window count is
`max(0, floor((F - K) / A) + 1)`. The default uses `K=4` and `A=3`. Duration
targets alone do not determine the count because actual fragment duration can
drift.

## Gates

Current-run evidence:

- Batch 3 hygiene: [`reviews/live-video-batch3-verification-2026-09-12.md`](../reviews/live-video-batch3-verification-2026-09-12.md)
- Prior Phase 9 protocol probe: [`reviews/live-rtsp-readiness-2026-09-11.md`](../reviews/live-rtsp-readiness-2026-09-11.md)
  (commit `78d7e569…`, manifests `readymtx3xg5w` + `readymtxc7oky`).

| Gate | Command or evidence | Status now |
| --- | --- | --- |
| Unit | `yarn vitest run lib/live lib/es lib/media lib/ingest worker` | **PASS** (2026-09-12 Batch 3; 144 live+worker tests) |
| Build | `yarn build` including live routes and worker typecheck | **PASS** (prior 2026-09-11; re-run under `READY_STRICT` when claiming acceptance) |
| Protocol | RTSP/TCP MediaMTX fixture via `yarn live-rtsp-readiness` (`evidence_class=protocol_probe`) | **PASS** — full 10-min soak [`readymtzh2c5c`](../reviews/live-rtsp-readiness-readymtzh2c5c.json) (298 fragments / 99 windows) |
| Resilience | disconnect + fixture-smoke reconnect + inference slowdown (probe) / app-path reconnect (HTTP) | **PASS** (probe + app-path reconnect in `appe2emtza5afr`) |
| Latency | close-to-searchable p95 ≤ 12s acceptance (10s target); warm search p95 &lt; 2s | **PASS** — soak p95 **5028 ms**; warm **31 ms** (`readymtzh2c5c`) |
| Search | live text/image + query-cache one-inference assertion | **PASS** (probe + app-path text search `appe2emtza5afr`) |
| Playback | retained clip Range → 206 | **PASS** (probe `serveLiveSpoolFile` + HTTP media Range in app-path E2E) |
| Security | web rejects `LIVE_SOURCE_*`; secret scan; URL/policy unit fixtures | **PASS** |
| Regression | `smoke-phase8-search` file-video path | **PASS** (2026-09-11) |
| Worktree identity | dirty + `content_hash` in readiness manifest | **PASS WITH NOTES** (dirty worktree; `READY_STRICT` + `READY_ALLOW_DIRTY`) |
| Browser E2E | Playwright create→follow→play→reconnect | **NOT RUN** — no Playwright in repo |
| Strict aggregator | `READY_STRICT=1` refuses mandatory `NOT RUN` | **PASS** (unit + offline manifests `readymty5ji4z` / `readymty5jpsf`) |

Pinned digests and runner notes: `test/fixtures/live/README.md`,
`docker-compose.live.yml`. Application path: `yarn live-app-path-e2e`.
MVP evidence is **not** multistream production readiness.

The feature is not fully live-ready until every mandatory gate (including the
strict 10-minute Protocol soak, application-path E2E, and browser E2E) has
current-run PASS evidence under `READY_STRICT`. A green build alone is
insufficient.
