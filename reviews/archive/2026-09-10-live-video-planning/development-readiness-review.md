# Live Video Plan — Development Readiness Review

Date: **2026-09-10**  
Reviewer path: **independent second-opinion review before Phase 1**  
Scope: `plan/01-live-video-search-implementation-plan.md`, `plan/specs/…/SPEC.md`,
`plan/architecture/…/ARCHITECTURE-SPINE.md`, `plan/02-live-video-traceability.md`,
`requirements/02-live-video-search-requirements.md`, `docs/live-video-*.md`,
`todo/01-live-video-search-todo.md`, and the existing implementation the plan
intends to reuse (`lib/`, `app/api/`, `scripts/`, `Dockerfile`, `docker-compose.yml`).  
Implementation reviewed: **none exists for live video**; file-video code at
commit `78d7e56` was read to check the plan's reuse assumptions.  
Prior review: [`live-video-planning-review-2026-09-10.md`](../../live-video-planning-review-2026-09-10.md)
(verdict "planning complete; ready to start Phase 1").

## Verdict

**SOLID ENOUGH TO START PHASES 1–2, WITH THREE CONTRACT FIXES REQUIRED BEFORE
PHASE 3 AND ONE RECOMMENDED PHASE 0 SPIKE.**

The planning package is unusually complete for a demo-scale feature: ownership,
state machines, crash boundaries, SSRF policy, and acceptance gates are all
explicit and mutually consistent. Nothing in it prevents a developer from
starting the configuration, storage, and RTSP-adapter work today.

It is not yet safe to build Phase 3 (fragments/windows) or Phase 5
(indexing/outbox) as written, because:

1. the recovery guarantee "no duplicate logical hit" rests on an Elasticsearch
   behaviour (409 on duplicate `_id` in a data stream) that does **not** hold
   across a rollover;
2. the window-assembly rule is internally ambiguous ("actual PTS coverage" vs
   "advances 6,000 ms") in a way that changes the fragment/window contract;
3. the plan's throughput requirement has no processing-concurrency or
   per-window deadline parameter, and the existing retry/encode defaults it
   inherits can individually exceed the 6-second window cadence.

Separately, the plan's risk profile is inverted: most planning effort went into
durable-outbox correctness, while the components with the least evidence
(real-time transcode + segmenting, receive-clock anchoring, Serverless
index-to-visible latency) are first exercised end to end in Phase 9. A short
throwaway spike before Phase 3 would de-risk NFR-1 for a few days of effort.

Three reference documents were added under `reference/` to close the gaps this
review found in the offline library (data streams/DSL/Serverless, FFmpeg live
capture, MediaMTX fixture); see the last section.

## Method

- Read every live-video planning document and the traceability matrix.
- Read the existing modules the plan names for reuse (`lib/video/*`,
  `lib/embed/*`, `lib/ingest/pipeline.ts`, `lib/ingest/job-store.ts`,
  `lib/ingest/ip-guard.ts`, `lib/ingest/url-fetch.ts`, `lib/es/*`,
  `lib/media/serve-file.ts`, `app/api/jobs/[id]/stream/route.ts`,
  `scripts/setup-indices.ts`, `Dockerfile`, `docker-compose.yml`,
  `vitest.config.ts`) and compared them with the plan's stated assumptions.
- Checked the installed `@elastic/elasticsearch` 8.19.2 typings for the
  template/lifecycle/data-stream calls the plan needs.
- Verified external constraints against current Elastic documentation
  (data streams, DSL retention, Serverless differences), the FFmpeg protocol
  and format manuals, the local FFmpeg 8.1.1 capability probe, and the
  MediaMTX default configuration.
- Used the file-video E2E evidence in `data/uploads/phase10/` for throughput
  baselines (20 fine windows with audio in 65.2 s ≈ 3.3 s/window, sequential).

## Findings that must be resolved before the affected phase

### F-1 (HIGH, before Phase 5) — Data-stream `_id` conflicts are only detected in the write index

**Where:** `docs/live-video-data-model.md` ("Writes use `op_type=create` and the
deterministic `_id`. A chunk replay that receives HTTP 409 must retrieve the
existing document…"), `docs/live-video-state-recovery.md` Searchable Outbox step
6 and the recovery-matrix rows "after chunk create timeout" and "after visible
chunk…", AD-6/AD-7/AD-8, LVR-FR-14, LVR-NFR-4, CAP-7.

**Problem:** A data stream routes every `create` to its current write index,
and `_id` uniqueness is enforced per index. Elastic's own guidance is that data
streams fit when "indexing documents with an explicit `_id` you expect
first-write-wins behavior" — but that guarantee is scoped to the write index.
After Serverless rolls the stream over (timing is managed by Elastic), a
recovery replay of a finalized-but-unacknowledged window will **succeed**
instead of returning 409, producing two documents with the same `chunk_id` in
two backing indices, and two search hits. The same applies to
`live-video-events` (`{session_id}_{revision}`), which would make "create or
verify the event" silently create a duplicate.

The probability is low per window, but the plan makes "no duplicate logical
hits" a hard acceptance criterion and the failure is silent — exactly what the
plan says is prohibited.

**Required change:**

- Recovery replay must run a `term` query on `chunk_id` (and `event_id`)
  against the data stream **before** attempting `create`, and treat a
  fingerprint-matching hit exactly as it treats a fingerprint-matching 409.
  Update outbox step 6 and the recovery matrix accordingly.
- Add retrieval-time defense in depth: `collapse: { field: "chunk_id" }` on
  every live knn/RRF branch (or application-side dedupe by `chunk_id` before
  RRF attribution), so a rare duplicate can never surface as two logical hits.
  Add this to Phase 7 acceptance.
- Alternative if the team prefers exactness over DSL: use plain indices with an
  alias and application-driven `delete_by_query` on `@timestamp` for
  retention. This is a larger deviation from AD-8; the query-before-create
  approach is the smaller change.

Reference: `reference/elastic-data-streams-lifecycle-serverless.md` §1.

### F-2 (HIGH, before Phase 3) — Window assembly rule is ambiguous and probably unimplementable as written

**Where:** LVR-FR-7 ("selects finalized fragments by PTS coverage and advances
6,000 ms"), AD-3, API validation ("fragment divides both window and step"),
SPEC CAP-2 ("one complete 8-second window every 6 seconds").

**Problem:** Segmenting muxers cut only at keyframes, and a live encoder with
forced 2-second keyframes still produces fragments of *approximately* 2 s
(the cut lands on the first keyframe at or after t = 2n; VFR or non-integer fps
sources drift). Three readings of the rule are possible and they produce
different identities and timestamps:

1. **Fragment-aligned**: window = 4 consecutive finalized fragments, advance 3
   fragments. Duration ≈ 8 s, boundaries exact at fragment edges, `-c copy`
   remux works. `window_ms`/`overlap_ms` become targets, not exact values.
2. **PTS-exact**: window covers exactly [start, start + 8000 ms) in PTS, advance
   exactly 6000 ms. Requires cutting inside fragments → re-encode or imprecise
   TS cutting; breaks the "standalone MP4 via remux" assumption and the
   1.5-second encode budget.
3. **Hybrid**: PTS-exact selection of *which* fragments, but fragment-aligned
   edges. Over a 10-minute run with drift, the assembler will alternately pick
   3 or 5 fragments to cover 8 s, so window duration varies and the "99 full
   windows" expectation in `live-video-operations.md` becomes wrong.

**Required change:** State explicitly that the MVP is **fragment-aligned**
(reading 1): identity and sequence are counted in fragments; `duration_ms`,
`start_pts_ms`, `end_pts_ms` record actual coverage; the expected full-window
count formula uses fragment counts, not seconds; and an "incomplete tail" is a
window with fewer than 4 fragments. Keep `fragment_ms/window_ms/overlap_ms` as
encoder/assembler targets. Add a fixture with 2.03-second fragments to Phase 3
acceptance to prove drift handling. If reading 2 is genuinely wanted, the
encode budget and AD-3 need rewriting.

Also specify the **fragment finalization signal**. The `segment` muxer writes
directly to the final filename (no temp/rename), so "atomic publication" must
come from either the `hls` muxer's `temp_file` flag or from reading the segment
list. `reference/ffmpeg-live-capture-and-segmenting.md` §3 documents both.

### F-3 (HIGH, before Phase 4) — No processing-concurrency or deadline parameter; inherited defaults exceed the window cadence

**Where:** `docs/live-video-operations.md` configuration table and latency
budget; LVR-NFR-3 (≥ 10 windows/min with no growing backlog); Phase 4/5.

**Problem:**

- One stream produces a window every 6 s. Measured file-video processing is
  ~3.3 s/window with video and audio inference **sequential** and no index
  wait. The plan's budget for proxy + thumbnail + inference is 4.5 s. That is
  feasible with concurrency 1 only if every stage stays near budget; there is
  no parameter for how many windows may be in proxy/inference simultaneously,
  so the implementer cannot trade CPU for headroom, and NFR-3 has zero margin.
- `lib/embed/retry.ts` defaults to 5 attempts with full-jitter backoff up to
  30 s — a single 429/503 storm can stall one window for over a minute while
  capture continues. Live callers need tighter `RetryOptions` and a per-window
  deadline that converts to a retryable `index_attempt`.
- `lib/video/proxy-encode.ts` can run up to **75** encode+probe attempts per
  window before `PROXY_BUDGET_EXHAUSTED`. For an 8-second, 32-frame window the
  first rung almost always fits under 1 MB, but the worst case is unbounded in
  time. Live windows should use a shortened ladder (start at 720 px long edge,
  2–3 CRF rungs) and a time cap; the ladder is part of `variant_id`, so choose
  it once.
- Serverless adds a documented **200 ms write-batching baseline** per request
  and the refresh interval on top; the 4.5 s index budget is plausible but
  should be measured (see the Phase 0 recommendation).

**Required change:** Add `LIVE_PROCESSING_CONCURRENCY` (default 2),
`LIVE_WINDOW_DEADLINE_MS`, live-specific embed retry options, and a live proxy
ladder to the configuration contract and to Phase 4/5 acceptance
("slow-consumer fixture" should include a 429 storm). State NFR-3 with a
margin (for example, sustained service time ≤ 4.5 s p95 per window at
concurrency 2) so "no growing backlog" is testable.

## Findings that should be corrected in the plan text (MEDIUM)

### F-4 — Several "reuse/extend" statements do not match the existing code

The plan is right to keep file and live state separate, but its Phase 2/5/7
language implies more reuse than the code supports. Rewording avoids
implementers discovering this mid-phase.

| Plan statement | What the code actually is | Consequence |
| --- | --- | --- |
| "Extend the existing IP guard … support RTSP targets" (Phase 2) | `lib/ingest/ip-guard.ts` is a pure IP/hostname blocklist (reusable). `lib/ingest/url-fetch.ts` hard-rejects non-HTTP schemes and implements its real DNS-rebinding defence by connecting Node's HTTP client to the validated IP — a mechanism that does not exist for FFmpeg. `isBlockedIp` does **not** block multicast `224.0.0.0/4`, `240.0.0.0/4`, `198.18.0.0/15`, IPv6 `ff00::/8`, or NAT64 `64:ff9b::/96`. | New URL parser and new destination binding are required; the guard needs the missing ranges before LVR-FR-24's "multicast" claim is true. |
| Reuse of FFmpeg execution | `lib/video/run-ffmpeg.ts` is `execFile` with fully buffered output, no timeout, no signal handling, no protocol whitelist. | Capture needs a new `spawn` supervisor; the plan should say "new", not "reuse". |
| "Extract reusable finite-window preparation from the file pipeline" (Phase 5) | The per-window body in `lib/ingest/pipeline.ts` is inline (lines ≈288–368), interleaved with `updateJob`/`emitJobEvent`, hard-coded `MEDIA_ROOT/proxies/{videoId}/{variantId}` paths, and **sequential** video→audio inference. `probeVideo` calls `fs.statSync` and requires a finite duration. | This is a refactor with regression risk to file ingest, not an extraction. Budget for it and protect it with the existing tests plus a new `pipeline.test.ts` case. |
| "Refactor search assembly to accept a target index" (Phase 7) | `lib/es/search.ts` hard-codes `ES_INDEX_CHUNKS`, has no time filter, fixes `thumb_url`, and for `modality=both` issues **three** ES calls; for EIS it uses `query_vector_builder`, so **three server-side inferences per query** and no vector ever reaches the app. | Follow mode's "one inference per TTL" (LVR-FR-17, AD-9) is impossible on the current EIS path. Live search must call `/_inference` once app-side and pass `query_vector`. Say so explicitly in Phase 7 and isolate it from the file route. |
| SSE / job events | `lib/ingest/job-store.ts` is in-process memory; the SSE route closes itself on `complete`/`error` and heartbeats by broadcasting to all listeners. | Nothing here is reusable across the worker/web process boundary. Fine — but see F-5. |
| `setup-indices` for templates/lifecycle | Plain `indices.exists/create` only. | New code; however the installed 8.19.2 client already types `putIndexTemplate({ template: { lifecycle } })`, `createDataStream`, `getDataLifecycle`, `explainDataLifecycle`. The "upgrade or isolate the client" gate can be downgraded to a Phase 1 task with an integration test on the target project. Note that Serverless' root-API version ("9.6.0") is documented as not meaningful. |
| Test scope | `vitest.config.ts` includes only `lib/**/*.test.ts`; `pipeline.test.ts` hand-builds a full `AppConfig` literal. | Adding required `LIVE_*` fields to the existing `envSchema` breaks that test's typecheck. Use a **separate** `lib/live/config.ts` schema (also enforces "file contracts unchanged"), and extend `vitest.config.ts` to `worker/**`. |

### F-5 — The web↔worker "live tail" is unspecified

`docs/live-video-state-recovery.md` says session SSE "attaches to the live
tail" and follow search "attaches the event tail", but the web and worker are
separate processes with no channel other than Elasticsearch. The only
mechanism consistent with the architecture is **polling `live-video-events`**
(`session_id` term + `revision > cursor`, sorted) — which needs a polling
interval and a refresh policy for event creates. If the worker creates events
without `refresh=wait_for`, the web sees them only after the stream's refresh
interval. Specify: event creates use `refresh=wait_for` (or the events stream
sets a short `index.refresh_interval`, which Serverless permits); web polls at
a configured `LIVE_EVENT_POLL_MS`; and document that this contributes to
UI-visible latency but not to NFR-1 (which is measured at the worker).

### F-6 — Secret isolation is not enforced by the deployment shape

`docker-compose.yml` has a single `app` service that receives the whole `.env`
via `env_file`. Adding a worker service the same way gives the web container
every `LIVE_SOURCE_*` secret, contradicting AD-11/LVR-FR-25 ("available only to
the worker"). Specify separate env files (or explicit `environment:` mappings)
for web and worker, and add a cheap startup assertion in the web process that
refuses to boot if any `LIVE_SOURCE_*` variable is present. Also note that the
official MediaMTX image has no FFmpeg, so the fixture publisher needs its own
image or service.

### F-7 — Receive-anchor mechanism can be decided now

AD-16 defers the clock mechanism to "Phase 2 must prove". Two concrete,
zero-code options exist: the `hls` muxer's `program_date_time` flag stamps each
segment with wall time (giving anchor and empirical `uncertainty_ms` from the
spread), and `-use_wallclock_as_timestamps 1` replaces PTS with receive time.
MediaMTX rewrites timestamps by default (`useAbsoluteTimestamp: false`), so the
fixture cannot demonstrate camera-clock fidelity anyway — consistent with the
plan's receive-anchored definition. Recommend naming `program_date_time` +
worker `hrtime` as the mechanism in AD-16 and converting the Phase 2 gate into
"measured spread ≤ one fragment".

### F-8 — Document inconsistencies (small, but they will cause churn)

- `docs/live-video-data-model.md` manifest example uses
  `searchable_event_published`; the union below it defines `event_published`.
  Pick one.
- `LIVE_STOP_DRAIN_TIMEOUT_MS` is used in `docs/live-video-data-flow.md` but
  is absent from the configuration table in `docs/live-video-operations.md`;
  the API accepts `drain_timeout_ms` per request. Define the precedence.
- `live-video-workers` is described as a "singleton `worker_id`" document but
  `LIVE_WORKER_ID` is "generated" per process, which yields one document per
  restart. Use a fixed `_id` (for example `singleton`) with `worker_id` as a
  field so the API's staleness check reads one document.
- `LIVE_ALLOWED_PORTS` defaults to `554`; MediaMTX listens on `8554` by
  default. The fixture must set the port explicitly or the first Phase 2 run
  fails on policy.
- `LIVE_EVENT_RETENTION` "at least" `LIVE_VECTOR_RETENTION`: DSL retention is a
  minimum applied at backing-index granularity, so equality does not guarantee
  ordering. Require strictly greater (e.g. `8d` vs `7d`).
- Process-local follow handles, query-vector cache, and rate limiter are
  module-level singletons. In `next dev` these can be instantiated per route
  bundle and reset on HMR; anchor them on `globalThis` (as a note in Phase 7)
  to avoid confusing dev-time `410 LIVE_QUERY_EXPIRED`.
- Audio proxies are Opus but are sent to EIS as `audio/wav` (existing quirk in
  `lib/embed/eis.ts`). Live inherits it; record `audio_proxy.codec` honestly
  and do not "fix" the MIME in only one path, or the two variants diverge.

## Structural recommendation (not a blocker)

### R-1 — Add a Phase 0 media/latency spike before Phase 3

The plan validates NFR-1 (p95 close-to-searchable ≤ 10 s) only in Phase 9,
after the outbox, manifest, APIs, and UI exist. Every component of that budget
is currently an estimate: real-time libx264 transcode plus segmenting on the
developer machine, `-c copy` window remux, per-window proxy encode, concurrent
EIS video/audio inference, and Serverless bulk `create` + `refresh=wait_for`.

A throwaway script (2–3 days, no manifest, no recovery, no API) that runs
MediaMTX → FFmpeg `hls`+`temp_file` fragments → 4-fragment window → existing
`encodeVideoProxy`/`encodeAudioProxy`/`extractThumbnail` → concurrent
`embedVideo`/`embedAudio` → bulk create into a scratch data stream, logging
stage timestamps for ~50 windows, would:

- confirm or refute the 10-second budget and the 6-second service-time
  requirement before any durable machinery is built;
- settle F-2 (fragment drift) and F-7 (anchor spread) with data;
- surface the FFmpeg flag names (`-timeout` vs `-stimeout`, minimal
  `protocol_whitelist`) on the pinned worker build.

If the spike shows the budget is not achievable at concurrency 1, the plan's
queue sizing, degraded thresholds, and NFR-1 wording change before, not after,
Phase 4.

### R-2 — Consider trimming the manifest union for the MVP

The manifest defines roughly twenty record types plus reserved/published
revisions and two fingerprints. This is defensible as a contract, but it is a
lot to implement and test before the first end-to-end window is searchable.
The reducer can be introduced with the minimum set (`epoch_started`,
`window_allocated`, `window_finalized`, `window_processed`, `index_attempt`,
`event_intent`, `event_ready`, `event_published`, `index_ack`, `window_failed`,
`window_dropped`, `window_abandoned`, `window_incomplete`) and the recovery
matrix rows tested one by one; `intent_abandoned`, `media_expired`,
`recovery_event`, and compaction can land in Phase 4 without changing the
`schema_version`. This is a sequencing suggestion, not a contract change.

## Things the plan gets right (worth preserving)

- Separation of desired/observed state with a single writer per field, and the
  refusal to let the API touch FFmpeg.
- Reference-name-only secrets in the web tier; structured secret shape;
  fingerprinted reconnect.
- Fragment-aligned epochs on every discontinuity and deterministic window IDs.
- Explicit, durable drops as the only exception to replay.
- Separate work and indexing-ack queues (correct given Serverless write
  batching).
- Measuring lag by stage with monotonic/UTC pairs and refusing cross-boot
  monotonic subtraction.
- Keeping live storage separate from `video-chunks` (whose strict mapping has
  no `@timestamp` and would reject live documents).
- RTSP-first sequencing with HLS/SRT/WHIP behind the adapter boundary.

## Reference documents added

| File | Why it was missing |
| --- | --- |
| [`reference/elastic-data-streams-lifecycle-serverless.md`](../../../reference/elastic-data-streams-lifecycle-serverless.md) | The plan depends on data streams, DSL retention, `op_type=create` 409 semantics, optimistic concurrency, and Serverless write behaviour; none were in `reference/`. Documents F-1 with sources. |
| [`reference/ffmpeg-live-capture-and-segmenting.md`](../../../reference/ffmpeg-live-capture-and-segmenting.md) | RTSP demuxer options, `protocol_whitelist`, keyframe forcing, `segment` vs `hls`+`temp_file`, receive-anchor options, and spawn/stop supervision — the mechanics behind AD-2/3/4/11/16 and F-2/F-7. Includes the host FFmpeg 8.1.1 capability probe. |
| [`reference/mediamtx-fixture-and-gateway.md`](../../../reference/mediamtx-fixture-and-gateway.md) | Default ports (8554, not 554), TCP-only transport, internal auth, `runOnInit` publisher, `useAbsoluteTimestamp`, fault-injection hooks, and pinning notes for Phases 2/9/10. |

`reference/00-index.md` was updated with a live-video section. Not added, on
purpose: WHIP RFC 9725 and HLS/SRT specifics — they belong to Phase 10, which
is gated behind RTSP acceptance.

## Suggested disposition

| Item | Action | Owner document(s) |
| --- | --- | --- |
| F-1 | Add query-before-create to recovery; add `collapse`/dedupe to live retrieval; update recovery matrix | `docs/live-video-state-recovery.md`, `docs/live-video-data-model.md`, Phase 5/7 acceptance |
| F-2 | Declare fragment-aligned windows; define finalization signal; fix expected-count formula | LVR-FR-7, AD-3, `docs/live-video-operations.md`, Phase 3 acceptance |
| F-3 | Add processing concurrency, deadline, live retry options, live proxy ladder; state NFR-3 with margin | `docs/live-video-operations.md`, LVR-NFR-3, Phase 4/5 |
| F-4 | Reword reuse claims; add EIS `query_vector` requirement; separate live config schema; extend vitest include | Phases 2, 5, 7; TODO |
| F-5 | Specify event refresh policy and web polling interval | `docs/live-video-state-recovery.md`, config table |
| F-6 | Split env files; web startup assertion; fixture publisher image | `docs/live-video-operations.md`, compose plan |
| F-7 | Name the anchor mechanism; make the Phase 2 gate measurable | AD-16, Phase 2 acceptance |
| F-8 | Fix the listed inconsistencies | data model, operations, data flow |
| R-1 | Add Phase 0 spike to plan and TODO | `plan/01-…`, `todo/01-…` |
| R-2 | Optional sequencing note | `plan/01-…` |

Per the change-control rule in `plan/02-live-video-traceability.md`, F-1 and
F-2 touch window identity/event ordering and therefore require updating the
spec, spine, affected contracts, plan, TODO, and matrix before Phase 3 begins.
None of the findings changes the RTSP-first delivery strategy or the phase
order.
