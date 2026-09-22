# Live Video Search TODO

Status legend: `[ ]` not started, `[~]` in progress, `[x]` done, `[-]` cancelled.
Last updated: **2026-09-13 — Source delete API/UI + host webcam path**.

Authoritative inputs:

- [Canonical spec](../plan/specs/spec-live-video-search/SPEC.md)
- [Architecture spine](../plan/architecture/architecture-live-video-search-2026-09-10/ARCHITECTURE-SPINE.md)
- [Implementation plan](../plan/01-live-video-search-implementation-plan.md)
- [Traceability matrix](../plan/02-live-video-traceability.md)
- [Requirements](../requirements/02-live-video-search-requirements.md)
- [API contract](../docs/live-video-api-contract.md)
- [Data model](../docs/live-video-data-model.md)
- [State and recovery](../docs/live-video-state-recovery.md)
- [Operations and gates](../docs/live-video-operations.md)
- [Current planning review](../reviews/live-video-planning-review-2026-09-10.md)

## Confirmed product decisions (2026-09-10 / updated 2026-09-12)

- [x] Retention: forever until explicit ops cleanup (no 7d/8d/24h auto-expiry)
- [x] Spool path default `./data/live-spool`; byte caps unlimited by default (`0`/unset)
- [x] Soft free-space floor: **50 GiB** (`LIVE_SPOOL_MIN_FREE_BYTES`; `0` disables)
- [x] A-20 reclaim: ops **age-delete** + **protect/keep** ranges (queued; not silent DSL)
- [x] MVP allowlist: localhost / 127.0.0.1; ports 554 and 8554
- [x] Scale: single stream + single worker + single web for MVP
- [x] WHIP: deferred (RTSP first)
- [x] Worker image: separate Dockerfile OK; Phase 1 may scaffold only
- [x] No auth for localhost demo MVP (M8/A-21 deferred)

## Planning prerequisite — documents and review hygiene

- [x] Create live-video canonical spec and explicit assumptions/open questions
- [x] Create architecture spine and implementation plan
- [x] Define live API, data model, data flow, operations, security, and gates
- [x] Keep file-video implementation and contracts intact
- [x] Archive prior reviews under dated `reviews/archive/`
- [x] Add archive index and repair current-document links
- [x] Run architecture mechanical/reviewer gate and reconcile clear findings
- [x] Run comprehensive adversarial, edge-case, structure, and prose review
- [x] Resolve source secret ownership and asynchronous validation
- [x] Define deterministic session claims and claim reconciliation
- [x] Define searchable outbox ordering and crash recovery matrix
- [x] Define normative session transitions and reason codes
- [x] Bound indexing acknowledgments and follow-search cursor behavior
- [x] Archive superseded live planning reviews under dated `reviews/archive/`
- [x] Record that Elasticsearch is external and must come only from `.env`
**Acceptance:** documents agree; archive is discoverable; live status is
`planned, not implemented`; current worktree passes documentation/link checks.

## Phase 1 — Configuration and persistence

- [x] Add `.env.example` placeholders for live indices, allow policy, timeouts,
      fragment/window settings, work/index queues, spool limits, retention,
      worker heartbeat, and connection-ref pattern
- [x] Add zod live configuration validation with cross-field duration checks
- [x] Keep live config in `lib/live/config.ts`; do not add required live fields to file `AppConfig`
- [x] Define source/session/worker/chunk/event TypeScript contracts
- [x] Pin worker image; capture Node/FFmpeg/image digest and capability manifest
      (`worker/Dockerfile` + `yarn probe-live-worker`; set `LIVE_WORKER_IMAGE_DIGEST` when image built)
- [x] Prove installed client template/data-stream/lifecycle APIs against the
      `.env` Elastic endpoint; add raw REST only for a demonstrated unsupported call
      (typed client APIs succeeded 2026-09-10; no raw REST fallback needed)
- [x] Implement strict source/session/worker mappings and live chunk/event data-stream templates
- [x] Configure and read back configured/effective DSL retention and its source (indefinite / no age delete)
- [x] Add `yarn setup-live-indices`; prove second-run no-op (indices/streams skipped; templates refreshed)
- [x] Verify setup targets only `ELASTICSEARCH_URL` from `.env`; do not install or
      start local Elasticsearch
- [x] Add repositories with optimistic concurrency, deterministic source claims,
      claim reconciliation, and field-ownership tests
- [x] Extend Vitest discovery to `worker/**/*.test.ts`

**Gate:** mappings/read-back pass on target Elastic; existing indices unchanged.
Verified 2026-09-10 against `.env` external ES: indefinite DSL lifecycle
(`effective_retention=null`), live control indices + chunk/event streams created;
second run skipped streams/indices. File indices not touched by this script.

## Phase 2 — Safe RTSP source adapter

- [x] Implement source URL parser and sanitized provenance
- [x] Implement explicit host/port allow policy and reconnect DNS re-validation
- [x] Extend IP classification for multicast, reserved, IPv6 multicast, and NAT64 ranges
- [x] Implement worker-only structured `connection_ref` resolver and redaction
- [x] Define `LiveSourceAdapter` and RTSP/TCP implementation
- [x] Spawn FFmpeg without shell and with protocol whitelist
- [x] Implement a new spawn-based supervisor with timeout, bounded stderr,
      signal handling, process-group cleanup, and capped reconnect
- [x] Add security fixtures for SSRF/protocol smuggling/userinfo/secret leakage
- [x] Prove validated DNS destinations are bound to FFmpeg through literal-address
      handling or worker egress controls
- [x] Run disposable 50-window MediaMTX/FFmpeg/EIS/Elasticsearch feasibility spike
      against the `.env` Elastic endpoint before Phase 3; use unique scratch
      names, clean them up, and record latency, fragment drift, and anchor uncertainty
      (PASS 2026-09-10 — see `reviews/live-feasibility-spike-2026-09-10.md`; p95 close-to-searchable ~12.2s)
- [x] Use separate web/worker secret environments; make web startup reject `LIVE_SOURCE_*`
- [x] Run the MediaMTX fixture publisher in an FFmpeg-capable service

**Gate:** MediaMTX RTSP fixture connects and reconnects; all negative fixtures pass.
Verified 2026-09-10: unit security suite green; MediaMTX 1.21.0 + separate FFmpeg
publisher; adapter+supervisor connect/reconnect smoke passed.

Fixture: `docker-compose.live.yml` + `yarn live-rtsp-fixture-smoke`.

## Phase 3 — Fragment and window pipeline

- [x] Produce atomic canonical MPEG-TS fragments and standalone MP4 windows
- [x] Implement versioned session manifest union with allocation, media-finalized,
      processed-draft, generic event-outbox, terminal-state, checksum, and fingerprint records
- [x] Implement fragment-aligned four-fragment/three-fragment-step assembler
      with actual PTS metadata
- [x] Use four-fragment windows with a three-fragment step and test 2.03-second drift
- [x] Use HLS `temp_file` plus playlist publication as the finalization signal
- [x] Prevent cross-epoch windows on reconnect/PTS regression/codec change
- [x] Add opaque clip/thumb refs and validated spool paths
- [x] Implement spool accounting and retention interface
- [x] Add boundary, overlap, discontinuity, incomplete-write, and manifest-reducer tests
- [x] Add every crash boundary from `docs/live-video-state-recovery.md`

**Gate:** deterministic fixtures produce exact expected window identities and timestamps.
Verified 2026-09-10: unit assembler/manifest/watcher tests green; 50-window spike PASS;
fragment drift p95=0; keep 4/3 alignment; latency budget follow-up in Phase 4.

## Phase 4 — Worker, queue, and recovery

- [x] Add `worker/live-worker.ts` and yarn start command
- [x] Enforce one worker with the exclusive spool-root lock and Compose replica
- [x] Publish worker heartbeat/capabilities and enforce one web replica for local handles
- [x] Implement bounded work/indexing queues and warning/hard thresholds
- [x] Add live processing concurrency, per-window deadline, bounded retries, and
      fixed live proxy ladder
- [x] Persist live/degraded/recovered/failed state and counters
- [x] Record explicit oldest-window drops after hard limit
- [x] Implement graceful drain, source-claim reconciliation, and global startup recovery
- [x] Prove web restart independence and one-worker ownership

**Gate:** restart and slow-consumer tests show bounded resources, recovery, and no silent loss.
Verified 2026-09-11: unit suite for lock/queue/recovery/processor/worker-loop green
(76 live+worker tests). Normal-load processor fixture: service-time p95 ≪ 4.5s at
concurrency 2 (prepare hook). Provider 429 storm exhausts retry budget and clears
queue. Full EIS micro-batch indexing remains Phase 5 (closes spike 12.2s gap).

## Phase 5 — Embedding and immediate indexing

- [x] Refactor inline finite-window preparation behind a shared function with a
      focused file-pipeline regression
- [x] Run live visual/audio preparation and inference concurrently within provider gate
- [x] Reserve generic event outbox intent/revision before indexing
- [x] Create deterministic live chunk documents with `refresh=wait_for`
- [x] Micro-batch indexing through a bounded acknowledgment queue
- [x] Verify immutable fingerprint before treating 409 as acknowledgment
- [x] Query full data streams by logical ID before recovery create across rollover
- [x] Create/verify the durable `searchable` event before terminal acknowledgment
- [x] Enforce atomic present-modality success; no partial chunk document
- [x] Cover no-audio, retry, budget failure, duplicate replay, and modality failure
- [x] Run all existing file-ingest tests

**Gate:** every emitted searchable ID is queryable and provider/variant metadata matches.
Verified 2026-09-11: `prepareFiniteMedia` shared by file pipeline + live; live
concurrent embed; `LiveIndexer` reserves revision → bulk chunk create (one
`refresh=wait_for`) → searchable event → `index_ack`; fingerprint-safe duplicate
ack. Unit: media+live+ingest **120 passed**.

## Phase 6 — Control APIs and SSE

- [x] Implement source CRUD routes
- [x] Implement session create/start/stop/status routes with idempotency key,
      deterministic claim, worker-heartbeat, and transition rules
- [x] Implement generic event outbox and replay with separate reserved/published
      revisions, gap/expiry, snapshot, and heartbeat
- [x] Poll Elasticsearch events at the configured interval with event writes
      using `refresh=wait_for`
- [x] Add stable live error catalog and bilingual messages
- [x] Add mutation rate/payload limits and secret/path response tests

**Gate:** contract suite passes across web restart and worker-unavailable scenarios.
Verified 2026-09-11: `/api/live/sources`, `/api/live/sessions` (+ start/stop/status),
SSE `/events` with `Last-Event-ID`, bilingual `LIVE_*` catalog, mutation rate +
body limits, `instrumentation.ts` rejects `LIVE_SOURCE_*` on web. Commands persist
desired state only (worker owns capture). Unit: control-service / errors / events-poll.

## Phase 7 — Live search and media

- [x] Refactor shared search core with file-response regression tests
- [x] Add live source/session/time filters to every knn/RRF branch
- [x] Add live image search filters
- [x] Implement bounded TTL/LRU query-vector cache
- [x] Call EIS inference once per cache miss and pass `query_vector` to all live branches
- [x] Implement follow-search handle/SSE with required variant, explicit sessions,
      one cursor per session, and vector/handle co-expiry
- [x] Add retained clip/thumb routes, traversal protection, Range, and 410 expiry
- [x] Collapse or deduplicate all live results by `chunk_id` before attribution

**Gate:** follow search observes new hits with one query-inference call before TTL.
Verified 2026-09-11: shared `executeChunkSearch` + file field regression; live
text/image routes with filters on every knn/RRF child; `globalThis` TTL/LRU
query-vector cache; follow handle + SSE; clip/thumb/playback routes; unit
`lib/es`+`lib/live`+`lib/media`+`lib/ingest`+`worker` **161 passed**.

## Phase 8 — UI

- [x] Add live navigation and bilingual source/session operations UI
- [x] Show observed state, lag, queue, spool, counters, reconnects, and safe errors
- [x] Add text/image follow search and freshness indicators
- [x] Reuse scores, modality badges, results, and timeline
- [x] Add retained clip player and optional MediaMTX live player
- [x] Add browser accessibility and state-transition tests

**Gate:** browser flow covers create/start/live/search/play/disconnect/reconnect/stop.
Verified 2026-09-11: `/live` source registry + `/live/[sessionId]` ops/search/playback;
nav + ZH/EN copy; follow SSE; clip + optional gateway; `lib/live/ui-state` tests for
state/follow/searchable claims. Unit suite **166 passed**. Full browser E2E against
MediaMTX remains Phase 9.

## Phase 9 — RTSP end-to-end readiness

- [x] Pin MediaMTX tag and record image digest
- [x] Add reproducible live fixture publisher and 10-minute runner
- [x] Inject disconnect, worker restart, and inference slowdown
- [x] Record expected/observed windows, gaps, drops, retries, duplicates, and queue high-water
- [x] Calculate p50/p95/p99 stage and end-to-end lag
- [x] Validate text/image time-range relevance and retained media alignment
- [x] Run secret scan, live security fixtures, unit tests, build, and file-search regression
- [x] Write dated current-run implementation review under `reviews/`
- [x] Update README with exact verified scope and remaining production gates

**Gate:** all mandatory RTSP gates in `docs/live-video-operations.md` pass on the
same commit and run manifest.

Verified 2026-09-11: **PASS WITH NOTES** —
[`reviews/live-rtsp-readiness-2026-09-11.md`](../reviews/live-rtsp-readiness-2026-09-11.md).
Pinned MediaMTX/FFmpeg digests; `yarn live-rtsp-readiness` runner; short protocol
soak (`READY_WINDOWS=6`) met latency/search/playback/resilience; build + secret
scan + file smoke PASS. Remaining notes: full **10-minute** soak
(`READY_DURATION_SEC=600`) and Playwright browser E2E **NOT RUN**.

## Phase 10 — Additional protocols

> **Opened 2026-09-13 (additive).** RTSP MVP defaults unchanged. HLS / SRT / WHIP
> adapters ship behind `LIVE_ALLOWED_PROTOCOLS` (fail closed when unused). See
> [`docs/live-video-architecture.md`](../docs/live-video-architecture.md) and
> [`test/fixtures/live/mediamtx-phase10.example.yml`](../test/fixtures/live/mediamtx-phase10.example.yml).

- [x] HLS/LL-HLS adapter with redirect, playlist, segment, and key re-validation
- [x] SRT caller/listener adapter with peer admission and passphrase ref
- [x] Decide whether first release includes WHIP browser publishing — **yes as opt-in adapter** (MediaMTX terminates WHIP; worker pulls internal RTSP)
- [x] If adopted, add pinned MediaMTX WHIP endpoint profile (example fixture), one-time publisher auth notes, TLS/CORS/ICE/STUN/TURN/codec profile placeholders in ops docs
- [ ] Remote-network WHIP/HLS/SRT soak evidence (not required to keep RTSP green)
- [-] RTMP(S) — deferred until a concrete source requires it

**Gate:** the RTSP MVP remains the default path; each additional adapter passes
the shared contract plus protocol-specific security and failure fixtures
(`lib/live/protocol-extensions.test.ts`). Unit: `yarn vitest run lib/live worker`
**162 passed** (2026-09-13).

## Code / readiness review follow-ups (2026-09-12)

Canonical triage: [`reviews/live-video-review-triage-2026-09-12.md`](../reviews/live-video-review-triage-2026-09-12.md).

- [x] **H1** Capture disconnect auto-reconnect (`session-supervisor` + backoff)
- [x] **H2** `publishHealth` no longer clobbers indexer `windows_searchable`
- [x] **H3** RTSP credentials via 0600 ffconcat (not FFmpeg argv userinfo)
- [x] **H4** Terminal stop clears source claim; same idempotency key conflicts
- [x] M10 API contract retention example synced to `until_explicit_delete`
- [x] **Batch 0** A-01 worker source validation + A-02 Compose env split + H4 claim-on-conflict residual + V-01 unit adoption + soft free-space floor (50 GiB)
- [x] **Batch 1** A-09 window end, A-07 epoch capture paths, A-11/A-12 ack+index attempts, M1/A-13 CAS, M3/A-15 media_sha256, M7/A-18 dims+assert; M2/A-14 + V-05 recovery metadata restore (Batch 3)
- [x] **Batch 2** A-10 working-set bound, A-19 single-flight polls, M4 thumbs, A-17 config wiring
- [x] **Batch 3** READY_STRICT + worktree hash (A-04/A-05/V-02/V-08); protocol probe demotion (A-03); `live-app-path-e2e` driver; A-14/V-05 recovery metadata restore — evidence [`reviews/live-video-batch3-verification-2026-09-12.md`](../reviews/live-video-batch3-verification-2026-09-12.md). Residual: app E2E + 10-min soak blocked by ES DNS; Playwright NOT RUN; no live commit
- [x] **Batch 4** A-20 age-delete + protect ranges; E2E unblockers (`seq_no_primary_term`, connect-timeout retryable, even proxy scale, waiter `windows.searchable`, RRF rank_window≥fetchSize). Evidence [`reviews/live-video-batch4-residuals-2026-09-12.md`](../reviews/live-video-batch4-residuals-2026-09-12.md).
- [x] **Batch 4 residual** Full-green `live-app-path-e2e` ([`appe2emtza5afr`](../reviews/live-app-path-e2e-appe2emtza5afr.json)) + strict 10-min soak ([`readymtzh2c5c`](../reviews/live-rtsp-readiness-readymtzh2c5c.json)); soak fixes: HLS fragment accumulation, build dims/timestamps types, latency budget/fault exclusion. Playwright still NOT RUN; Phase 10 remains closed.
- [x] **Batch 5** Completion-review actionable bugs: age-delete pagination + ES-before-media + dry-run planned counters; protect-range paging; RTSP-only create; app-path mandatory gates + cleanup; worktree untracked hash; Compose loopback; L2/L3. Evidence [`reviews/live-video-batch5-residuals-2026-09-13.md`](../reviews/live-video-batch5-residuals-2026-09-13.md). Unit: `lib/live`+`worker` **154 passed**.
- [x] **Batch 6** Program-correctness actionable bugs after Phase 10: PATCH transport validation; age-delete partial-DBQ + truncated refuse; query preserve; HLS capability + auth preflight; SRT passphrase/ffconcat + honest listener gate; Phase 10 fixture lockdown. Evidence [`reviews/live-video-batch6-residuals-2026-09-13.md`](../reviews/live-video-batch6-residuals-2026-09-13.md). Unit: `lib/live`+`worker` **170 passed**.
- [x] **Live UI visibility (2026-09-13):** worktree already had `/live` + AppShell「Live/直播」; user-facing Docker app (port **3001**, image ~9d old) returned `/live` **404** and no Live nav. Rebuilt `APP_PORT=3001 docker compose up -d --build app` — `/live` **200**, nav present. Note: live pages still untracked vs git HEAD; `:3000` may be unrelated (e.g. Elastic APM).
- [x] **Host webcam publish (2026-09-13):** `scripts/live-webcam-publish.sh` + `yarn live-webcam-publish`; additive MediaMTX path `/webcam`; docs in `docs/live-video-operations.md` / `test/fixtures/live/README.md`; sample `LIVE_SOURCE_WEBCAM_URL` in `.env.worker.example`. Default allowlist stays RTSP-only; `/fixture` e2e unchanged.
- [x] **Source delete (2026-09-13):** `DELETE /api/live/sources/{sourceId}` refuses while active non-terminal session; `/live` Delete + confirm, hide `app-e2e-*`, bulk delete e2e helper; control-service unit tests.
- [x] **Source delete Docker refresh (2026-09-13):** Browser reload alone was insufficient (compose app image on `:3001` lagged source). Rebuilt `APP_PORT=3001 docker compose up -d --build app live-worker`; Delete is danger+trash filled; verified bundle + i18n EN/中文; cleaned 6/7 `app-e2e-*` via API (1 orphan `stopping` session force-terminalled).
- [ ] **Defer** M8/A-21 auth (Compose loopback done); A-16/A-12 caps eviction (unlimited default); A-08 PTS/signature probe; Playwright; standalone tsc/lint; clean live commit; Phase 10 remote soak; continuous HLS FFmpeg mediation; hostname TLS/SNI pin
- [x] **A-20 retention APIs** (redesigned): ops age-delete older-than-threshold + protect/keep UTC ranges (exclude from age-delete); forever default; not silent DSL
  - [x] Age-delete function (ES chunks/events + spool clip/thumb; honor protect ranges)
  - [x] Protect/keep range CRUD (absolute UTC; optional session filter; keyed by `window_end_at`)
  - [x] Ops docs / dry-run + audit counters
  - [x] Pagination + ES-before-media ordering (Batch 5)

## Decisions required from user

- [x] Vector metadata retention: **forever until explicit delete** (no 7d auto-expiry)
- [x] Clip/thumbnail retention: **forever until explicit delete** (no 24h auto-expiry)
- [x] Simultaneous stream target: **1** (MVP)
- [x] Pending-spool and retained-media byte budgets: **unlimited** retained growth; **soft free-space floor 50 GiB** (`LIVE_SPOOL_MIN_FREE_BYTES`; 0 disables)
- [x] WHIP browser camera in first release: **deferred past RTSP MVP**; Phase 10 ships **opt-in** WHIP→MediaMTX→internal RTSP adapter (default allowlist still RTSP-only)
- [x] Allowed source hosts/CIDRs and ports for MVP: **localhost / 127.0.0.1; ports 554, 8554**
- [x] A-20 reclaim model: **age-delete + protect ranges** (ops-triggered); not only single-resource DELETE

These decisions are encoded in `lib/live/config.ts`, `.env.example`, `.env.worker.example`, and live
ops/data-model docs. Production sizing/compliance claims remain out of scope
for the controlled RTSP fixture.
