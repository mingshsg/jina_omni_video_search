# Application implementation and Phase 10 readiness review — 2026-09-12

## Verdict

**NOT READY for Phase 10.**

The current worktree compiles and its unit suite is green, but the RTSP MVP has
not passed its own Phase 9 entry gate. The normal application workflow cannot
currently promote a newly created source out of `pending_validation`, and the
existing readiness runner bypasses the application control plane and worker
pipeline. The required 10-minute soak and browser E2E are also still not run.

Phase 10 should remain closed until the application-path failures below are
fixed and all mandatory Phase 9 gates pass from one clean, committed revision
and one current run manifest.

## Scope and repository identity

- Branch: `live-video-search`
- HEAD: `78d7e569edc3f975e1b96199d14bf0a87c93a15a`
- Review target: the complete dirty worktree, including untracked live-video
  implementation, routes, worker, tests, Compose, and readiness scripts.
- Identity problem: HEAD is still the preserved file-video baseline. The live
  implementation is not represented by the commit named in the prior Phase 9
  report, and the readiness script records only commit/branch, not dirty state
  or a worktree-content hash (`scripts/live-rtsp-readiness.ts:242-255`).

## Current-run checks

| Check | Result | Evidence |
| --- | --- | --- |
| Unit suite | **PASS** | `yarn test`: 40 files, 175 tests passed |
| Production build/type check | **PASS** | `yarn build`: Next.js production build completed; all live routes emitted |
| Diff whitespace | **PASS** | `git diff --check`: no findings |
| Lint | **FAIL / NOT CONFIGURED** | `yarn lint` opens the interactive Next.js ESLint setup prompt and exits 1 |
| Full RTSP application E2E | **NOT RUN** | Would require Docker, the configured external Elasticsearch/EIS services, and state-changing fixture execution |
| Required 10-minute soak | **NOT RUN** | Prior evidence used 6 windows / about 40 seconds |
| Browser E2E | **NOT RUN** | No Playwright dependency or test exists |

Local PASS results establish compilation and isolated behavior only. They do
not establish Phase 9 or Phase 10 readiness.

## Adversarial findings

### A-01 — Created sources never become runnable

- **Location:** `lib/live/control-service.ts:128-155`,
  `lib/live/adapters/rtsp.ts:230-259`, `lib/live/worker-loop.ts:94-132`
- **Trigger condition:** Create a source through `/api/live/sources`, then try to
  create a session through the UI/API.
- **Guard:** Add a worker-owned pending-source validation loop that resolves the
  `connection_ref`, applies protocol/destination policy, and atomically writes
  `ready` or `invalid` plus safe provenance. Test the full transition.
- **Consequence:** Every API-created source remains `pending_validation`, and
  session creation returns `LIVE_SOURCE_PENDING_VALIDATION` indefinitely.
- **Evidence:** Repository-wide symbol search finds `validateRtspSecret` only at
  its declaration; tests inject pre-built `ready` source documents.

### A-02 — Docker Compose sends worker-only source secrets to the web process

- **Location:** `docker-compose.yml:13-20`, `instrumentation.ts:5-10`,
  `lib/live/env-surfaces.ts:17-25`
- **Trigger condition:** Put the worker's required `LIVE_SOURCE_*_(URL|CONNECTION)`
  value in the shared `.env` and start both services with Compose.
- **Guard:** Use separate explicit environment files or explicit variable maps;
  never attach the worker secret file to `app`.
- **Consequence:** The web container receives the secret and its startup guard
  intentionally terminates the application. Removing the guard would instead
  expose the secret to the web process.

### A-03 — Phase 9 evidence bypasses the application being accepted

- **Location:** `scripts/live-rtsp-readiness.ts:395-418,572-700,713-817`
- **Trigger condition:** Treat `yarn live-rtsp-readiness` as proof of the normal
  source/session/worker/search/playback workflow.
- **Guard:** Drive the public APIs and real `LiveWorkerLoop`/`SessionRuntime`,
  assert target live documents/events, consume SSE, and request the actual media
  route.
- **Consequence:** The gate can pass while source validation, session claims,
  queue/indexer behavior, SSE, UI, and media routing are broken.

### A-04 — The readiness runner reports success with mandatory gates not run

- **Location:** `scripts/live-rtsp-readiness.ts:953-971`
- **Trigger condition:** Browser E2E, build, protocol, or another mandatory gate
  is `NOT RUN`, but no gate is `FAIL`.
- **Guard:** Define the mandatory gate set and require every member to be exactly
  `PASS`; treat `NOT RUN` and `PASS_WITH_NOTES` as non-acceptance.
- **Consequence:** `report.ok` and process exit 0 can falsely signal readiness.

### A-05 — The recorded Phase 9 gates did not pass in one run manifest

- **Location:** `reviews/live-rtsp-readiness-readymtx3xg5w.json:14-70`,
  `reviews/live-rtsp-readiness-2026-09-11.md:8-22`
- **Trigger condition:** Combine the protocol manifest with a separate
  protocol-skipped build/security manifest.
- **Guard:** Produce one manifest from one clean revision with every mandatory
  gate passing; record worktree cleanliness and artifact hashes.
- **Consequence:** The stated Phase 9 gate (`same commit and run manifest`) is
  not satisfied. The primary manifest itself has security `FAIL`, build `NOT
  RUN`, and browser E2E `NOT RUN`.

### A-06 — Disconnect, worker-restart, slowdown, search, and playback probes are substitutes

- **Location:** `scripts/live-rtsp-readiness.ts:426-480,637-700,713-817`
- **Trigger condition:** Rely on the runner's `Resilience`, `Search`, and
  `Playback` rows.
- **Guard:** Inject faults while the actual worker pipeline is active; restart
  the worker process/container; query through live API routes; verify an HTTP
  Range request against the media route.
- **Consequence:** Publisher bounce happens after capture is stopped, “worker
  restart” is a separate connect smoke, slowdown bypasses queues, search uses a
  scratch index directly, and playback merely slices a local buffer.

### A-07 — Reconnect can ingest old fragments into a new epoch

- **Location:** `lib/live/session-supervisor.ts:259-270,360-392`,
  `lib/live/fragment-capture.ts:63-77`, `lib/live/fragment-watcher.ts:20-48`
- **Trigger condition:** FFmpeg reconnects after an unexpected exit.
- **Guard:** Use epoch-specific fragment directories/playlist names or remove
  stale playlist state before spawn, and use a monotonic segment start number.
- **Consequence:** A fresh watcher sees the old unbounded playlist and same
  `frag_%06d.ts` names, so stale or overwritten files can be assigned to the new
  epoch and remuxed into incorrect windows.

### A-08 — Codec/audio discontinuities and actual PTS are not observed

- **Location:** `lib/live/session-supervisor.ts:451-489`,
  `lib/live/adapters/rtsp.ts:187-207`
- **Trigger condition:** Codec, resolution, audio presence, or source timestamps
  change without FFmpeg exiting.
- **Guard:** Probe finalized fragments, call `classifyFragment`, persist the real
  media signature and PTS, and open a new epoch when required.
- **Consequence:** The runtime uses cumulative declared duration and the constant
  `h264_aac_live`; it cannot detect the discontinuities required by the spec and
  may create corrupt cross-format windows.

### A-09 — Window UTC end time is the start of the last HLS fragment

- **Location:** `lib/live/window-assembler.ts:124-157`
- **Trigger condition:** `EXT-X-PROGRAM-DATE-TIME` is present, as it is in the
  canonical capture configuration.
- **Guard:** Anchor the first fragment start and add actual PTS/duration to
  calculate the window end; verify against ffprobe/PDT fixtures.
- **Consequence:** For four 2-second fragments, `window_end_at` is roughly two
  seconds early. Time-range search, capture lag, and event timestamp attribution
  are wrong.

### A-10 — Long-running capture grows CPU and memory without bound

- **Location:** `lib/live/fragment-capture.ts:70-73`,
  `lib/live/session-supervisor.ts:114-115,451-489`
- **Trigger condition:** Keep a source live for hours or days.
- **Guard:** Bound the HLS playlist, prune consumed fragments and emitted window
  IDs, and retain only the overlap needed for the next window.
- **Consequence:** FFmpeg writes an unbounded playlist; the worker repeatedly
  reads/sorts the entire history and retains all fragment metadata/window IDs,
  causing progressive latency and memory growth.

### A-11 — Index-ack queue pressure silently loses prepared windows

- **Location:** `lib/live/processor.ts:227-241`
- **Trigger condition:** The acknowledgment queue is full while embeddings
  complete.
- **Guard:** Check `accepted`, persist every returned drop, keep the work item
  durable until ack enqueue succeeds, and fail/degrade when no slot is available.
- **Consequence:** The work item is removed before enqueue; rejected or evicted
  acknowledgments are ignored, so a successfully embedded window may never be
  indexed or recorded as dropped.

### A-12 — Index failures retry forever and ignore the configured attempt budget

- **Location:** `lib/live/processor.ts:294-305`, `lib/live/config.ts:226`
- **Trigger condition:** Elasticsearch remains unavailable or rejects a batch.
- **Guard:** Persist and increment index attempts, apply bounded backoff, honor
  `LIVE_INDEX_MAX_ATTEMPTS`, and emit a terminal failure/drop record.
- **Consequence:** The same batch is requeued every loop iteration, potentially
  hammering Elasticsearch indefinitely while the queue backs up.

### A-13 — Searchable-event revision reservation is not crash-safe serialization

- **Location:** `lib/live/indexer.ts:118-148`
- **Trigger condition:** Concurrent index batches reserve a revision, or the
  process fails after appending `event_intent` but before the session update.
- **Guard:** Reserve revision/state with one optimistic-concurrency operation,
  then append an intent tied to that committed reservation; reconcile conflicts
  by durable identity.
- **Consequence:** Multiple chunks can select the same revision/event ID, or a
  failed reservation can be reused for a different chunk after restart.

### A-14 — Recovery reconstructs incomplete and incorrect chunk identity

- **Location:** `lib/live/fragment-manifest.ts:139-223`,
  `lib/live/session-supervisor.ts:209-233`, `lib/live/embed-window.ts:152-167`
- **Trigger condition:** Restart after `window_finalized`, prepared draft, chunk
  create, or event intent but before `index_ack`.
- **Guard:** Persist and restore complete finalized/processed window metadata and
  the immutable prepared draft; replay the exact remaining stage rather than
  re-creating timestamps and embeddings from partial state.
- **Consequence:** Recovery substitutes current time, default duration, missing
  PTS, and missing media hash; it can produce wrong event time or fingerprint
  conflicts instead of an idempotent replay.

### A-15 — Chunk fingerprint does not bind to retained media

- **Location:** `lib/live/live-chunk-builder.ts:69-91`,
  `lib/live/embed-window.ts:152-162`
- **Trigger condition:** Any live window is built by the real worker hook.
- **Guard:** Hash the finalized MP4 and pass the digest plus window PTS/signature
  into `buildLiveChunkDocument`; reject a missing digest.
- **Consequence:** Every real live chunk defaults to `sha256:unknown`, weakening
  immutable duplicate verification and allowing different media to share the
  same claimed identity inputs.

### A-16 — Configured storage pressure does not relieve storage pressure

- **Location:** `lib/live/session-supervisor.ts:559-590`,
  `lib/live/spool-accounting.ts:58-115`, `docs/live-video-operations.md:149-162`
- **Trigger condition:** A configured pending or retained-media byte cap is hit.
- **Guard:** Persist the terminal drop, delete/move the corresponding eligible
  media, remeasure usage, and use a separate retained-media eviction policy.
- **Consequence:** The code removes only a queue entry and leaves files on disk;
  a retained-media hard limit cannot be reduced at all, so the worker remains
  over quota until failure/disk exhaustion.

### A-17 — Capture and durability configuration values are misleading no-ops

- **Location:** `lib/live/session-supervisor.ts:283-288`,
  `lib/live/source-adapter.ts:92-110`, `lib/live/config.ts:211-233`
- **Trigger condition:** Operators change `LIVE_CONNECT_TIMEOUT_MS`,
  `LIVE_READ_TIMEOUT_MS`, or `LIVE_MANIFEST_RESERVE_BYTES`.
- **Guard:** Wire each setting to the actual process/manifest behavior and add a
  test proving a non-default value changes runtime behavior; otherwise remove it.
- **Consequence:** Connect timeout is explicitly disabled, read timeout stays at
  a hard-coded 15 seconds, and manifest reserve headroom is never enforced.

### A-18 — Embedding compatibility failures are deliberately ignored

- **Location:** `lib/live/control-service.ts:352-357`,
  `lib/live/embed-window.ts:49-71`
- **Trigger condition:** The configured provider/model/dimensions differ from
  the session/index contract.
- **Guard:** Derive dimensions from the probed provider/index contract and fail
  the session on `assertVariantEmbeddingStack` mismatch.
- **Consequence:** Sessions always claim 1024 dimensions, and the worker catches
  and discards validation failures; indexing can later fail or mix incompatible
  vectors.

### A-19 — Async polling is neither single-flight nor safely rejected

- **Location:** `lib/live/worker-loop.ts:84-99`,
  `lib/live/session-supervisor.ts:291-297`,
  `app/api/live/sessions/[sessionId]/events/route.ts:156-182`
- **Trigger condition:** Elasticsearch, remux, or polling takes longer than the
  configured interval or throws.
- **Guard:** Replace async `setInterval` callbacks with a serialized await/sleep
  loop, catch at the task boundary, and make shutdown wait for the active poll.
- **Consequence:** Worker polls can overlap and violate the one-runtime invariant;
  fragment polls can race; session SSE can duplicate/out-of-order events; some
  rejections are unhandled.

### A-20 — The retention contract has no explicit-delete implementation

- **Location:** `lib/live/spool-accounting.ts:118-126`, live API routes
- **Trigger condition:** An operator tries to enforce “retain until explicit
  delete” or reclaim disk.
- **Guard:** Add an authorized deletion workflow that coordinates session state,
  chunk/event records, clip/thumb/fragments/proxies, and auditable tombstones.
- **Consequence:** Retained media and vectors have no supported removal path and
  default unlimited storage grows until the filesystem fills.

### A-21 — The deployment is network-exposed without authentication

- **Location:** `docker-compose.yml:13-16`, `Dockerfile:31-34`, `app/api/live/**`
- **Trigger condition:** Run Compose on a host reachable by other users or a LAN.
- **Guard:** Bind the demo to loopback by default and/or require authentication
  and per-resource authorization before accepting mutations, searches, SSE, or
  media requests.
- **Consequence:** Unauthenticated callers can enumerate sources/sessions,
  control capture, consume search events, and retrieve retained media.

## Edge-case Hunter findings

| Location | Unhandled condition | Guard | Consequence |
| --- | --- | --- | --- |
| `lib/live/control-service.ts:128-155` | Source remains pending after creation | Worker validates every pending source | UI can never start its new source |
| `lib/live/control-service.ts:266-298` | Terminal idempotency retry reclaims before conflict | Clear the just-acquired claim before throwing | Source retains a stale terminal claim |
| `lib/live/session-supervisor.ts:259-270` | Reconnect sees prior playlist and segment names | Use epoch-specific capture paths | Old media enters a new epoch |
| `lib/live/processor.ts:227-241` | Ack enqueue rejects or evicts an item | Persist/drop or retry before completing work | Prepared window disappears silently |
| `lib/live/processor.ts:294-305` | Elasticsearch rejects forever | Bounded persisted attempts plus backoff | Tight retry and unbounded backlog |
| `lib/live/session-supervisor.ts:559-590` | Retained-media cap is exceeded | Evict eligible retained media and remeasure | Cap never recovers |
| `lib/live/window-assembler.ts:154-155` | PDT marks segment start, not window end | Add last-fragment duration/PTS | Event time is early |
| `lib/live/worker-loop.ts:84-99` | One poll exceeds its interval | Single-flight poll loop | More than one runtime may start |
| `app/api/live/sessions/[sessionId]/events/route.ts:106-193` | Initial async setup rejects after response creation | Catch, emit stable error, close timers/stream | Open stream hangs without diagnostics |
| `docker-compose.yml:15-20` | Shared `.env` contains required worker secret | Split service env surfaces | Web fails at startup |

## Verification Gap findings

### V-01 — Source validation adoption gap

- **Location:** `lib/live/adapters/rtsp.ts:230-259`
- **Gap shape:** missing-adoption-gap
- **Consumer:** Source creation/start flow in `app/live/page.tsx:126-188`
- **Missing check:** Create a source through the route, wait for worker
  validation to reach `ready`, then create a session without seeding ES.
- **Consequence:** Tests pass although the actual UI flow is permanently blocked.
- **Evidence:** `rg validateRtspSecret` finds only the declaration; control tests
  assert `pending_validation` or insert a `readySource()` fixture.

### V-02 — Readiness manifest does not verify worktree identity

- **Location:** `scripts/live-rtsp-readiness.ts:242-255`
- **Gap shape:** broken-verification-gap
- **Consumer:** Phase 9 same-revision gate in `todo/01-live-video-search-todo.md:223-224`
- **Missing check:** Fail if dirty, or record a deterministic diff/content hash
  and require the tested revision to contain the implementation.
- **Consequence:** Evidence names `78d7e56`, even though that commit predates all
  untracked live implementation.
- **Evidence:** Current `git status --short` lists the live routes, `lib/live`,
  worker, tests, Compose, and readiness scripts as untracked.

### V-03 — Resilience checks do not exercise resilience paths

- **Location:** `scripts/live-rtsp-readiness.ts:426-480,637-660`
- **Gap shape:** broken-verification-gap
- **Consumer:** `SessionRuntime`, `LiveWorkerLoop`, and bounded queues
- **Missing check:** Disconnect and restart the active real worker mid-stream and
  assert epochs, gaps, retries, drops, revisions, and resumed searchability.
- **Consequence:** Reconnect/queue/recovery regressions can ship behind a green
  `Resilience` row.
- **Evidence:** Capture is stopped before the publisher bounce; “worker restart”
  invokes a separate smoke script; slowdown occurs in a manual for-loop.

### V-04 — Playback gate does not call playback code

- **Location:** `scripts/live-rtsp-readiness.ts:804-817`
- **Gap shape:** broken-verification-gap
- **Consumer:** `app/api/live/chunks/[chunkId]/media/route.ts`
- **Missing check:** Send real authenticated/authorized HTTP full and Range
  requests, asserting bytes, headers, 206, 416, 410, and traversal behavior.
- **Consequence:** Route lookup, ES-to-spool resolution, range parsing, and stream
  failures remain undetected.
- **Evidence:** The apparent gate reads a local file and slices four bytes, then
  assigns status 206 without issuing a request.

### V-05 — Recovery tests do not verify replayed document equivalence

- **Location:** `lib/live/recovery.test.ts`, `lib/live/session-supervisor.ts:209-233`
- **Gap shape:** regression-gap
- **Consumer:** Replayed `LiveChunkDocument` and searchable event
- **Missing check:** Crash at every durable boundary, restart, and assert the
  recovered chunk/event is byte-for-byte contract-equivalent to uninterrupted
  processing with the same fingerprint, timestamps, and revision.
- **Consequence:** Partial metadata replay passes tests while producing wrong or
  conflicting indexed documents.
- **Evidence:** Existing recovery tests assert replay ID/state selection; they do
  not run recovered items through embed/index and compare final documents.

### V-06 — Queue tests omit ack rejection/eviction

- **Location:** `lib/live/processor.test.ts:39-89`
- **Gap shape:** regression-gap
- **Consumer:** `LiveWindowProcessor.runOne` at `lib/live/processor.ts:227-241`
- **Missing check:** Fill the ack queue with processing entries and assert that a
  newly prepared window is durably retried or recorded as dropped.
- **Consequence:** Silent prepared-window loss is not caught by the 175-test suite.
- **Evidence:** The positive test sizes both queues to 24 for 20 windows and only
  asserts the no-pressure path.

### V-07 — Reconnect test omits filesystem continuity

- **Location:** `lib/live/session-supervisor.test.ts:87-167`
- **Gap shape:** regression-gap
- **Consumer:** Reconnected fragment watcher/window assembly
- **Missing check:** Run two captures against the same session spool and assert
  the second epoch cannot observe first-epoch playlist entries/files.
- **Consequence:** The test proves only that a second supervisor starts and the
  epoch number increments; stale-fragment ingestion remains invisible.

### V-08 — Mandatory-gate status is not tested

- **Location:** `scripts/live-rtsp-readiness.ts:953-971`
- **Gap shape:** broken-verification-gap
- **Consumer:** CI/operator exit status and `report.ok`
- **Missing check:** Unit-test the aggregator with each mandatory gate set to
  `NOT RUN`, `PASS_WITH_NOTES`, and `FAIL`.
- **Consequence:** Incomplete acceptance runs can exit successfully and be cited
  as readiness evidence.

## Phase 10 entry conditions

Keep Phase 10 closed until all of the following are true:

1. The source validator and split web/worker environment work through the real
   Compose deployment.
2. Reconnect, timestamps/PTS/signature, index-ack pressure, bounded index retry,
   event revision reservation, recovery, and storage-pressure behavior are fixed
   and covered at their observable boundaries.
3. The readiness runner drives the application, rejects any mandatory non-PASS
   gate, and records clean worktree identity.
4. One clean committed revision passes unit, configured lint, build, security,
   file-search regression, full RTSP application E2E, the 10-minute fault soak,
   and browser create → validate → start → follow → play → reconnect → stop.
5. Only after the RTSP MVP is accepted should HLS/LL-HLS or SRT adapters begin.

## Canonical findings JSON

The human findings above are canonical. This compact JSON index preserves the
BMad lens output shape without repeating the full evidence text.

```json
[
  {"lens":"adversarial","location":"lib/live/control-service.ts:128-155","trigger_condition":"API-created sources have no production path from pending_validation to ready","guard_snippet":"Add worker pending-source validation and an application-path transition test","potential_consequence":"The UI cannot create a runnable live session"},
  {"lens":"adversarial","location":"docker-compose.yml:13-20","trigger_condition":"Shared .env contains a worker-only LIVE_SOURCE secret","guard_snippet":"Split app and worker environment surfaces","potential_consequence":"Web startup fails or receives capture credentials"},
  {"lens":"adversarial","location":"scripts/live-rtsp-readiness.ts:395-817","trigger_condition":"Scratch-pipeline checks are treated as application E2E evidence","guard_snippet":"Drive public APIs, worker runtime, SSE, search, and media routes","potential_consequence":"Broken application integration is accepted"},
  {"lens":"adversarial","location":"scripts/live-rtsp-readiness.ts:953-971","trigger_condition":"Mandatory gates are NOT RUN without any FAIL row","guard_snippet":"Require every mandatory gate to equal PASS","potential_consequence":"Incomplete runs report ok and exit zero"},
  {"lens":"adversarial","location":"reviews/live-rtsp-readiness-readymtx3xg5w.json:14-70","trigger_condition":"Separate incomplete manifests are combined as one acceptance","guard_snippet":"Emit one all-PASS manifest from one clean revision","potential_consequence":"The Phase 9 same-run gate is unsatisfied"},
  {"lens":"adversarial","location":"lib/live/session-supervisor.ts:259-392","trigger_condition":"Reconnect reuses playlist and segment paths","guard_snippet":"Use epoch-specific paths and monotonic segment numbering","potential_consequence":"Old fragments can enter a new epoch"},
  {"lens":"adversarial","location":"lib/live/session-supervisor.ts:451-489","trigger_condition":"Runtime assumes constant media signature and synthesized PTS","guard_snippet":"Probe fragments and open epochs on signature or PTS changes","potential_consequence":"Cross-format or discontinuous windows are emitted"},
  {"lens":"adversarial","location":"lib/live/window-assembler.ts:124-157","trigger_condition":"PDT is used as the end of the last fragment","guard_snippet":"Calculate end UTC from actual PTS and duration","potential_consequence":"Time search and lag attribution are wrong"},
  {"lens":"adversarial","location":"lib/live/fragment-capture.ts:70-73","trigger_condition":"A long-running stream retains and rescans all capture history","guard_snippet":"Bound playlist and prune processed fragment/window state","potential_consequence":"CPU and memory grow over stream lifetime"},
  {"lens":"adversarial","location":"lib/live/processor.ts:227-241","trigger_condition":"Index-ack enqueue rejects or evicts under pressure","guard_snippet":"Check acceptance and persist every drop before completing work","potential_consequence":"Prepared windows disappear without indexing or audit"},
  {"lens":"adversarial","location":"lib/live/processor.ts:294-305","trigger_condition":"Elasticsearch keeps rejecting an index batch","guard_snippet":"Honor persisted LIVE_INDEX_MAX_ATTEMPTS with backoff","potential_consequence":"Infinite hot retry and queue growth"},
  {"lens":"adversarial","location":"lib/live/indexer.ts:118-148","trigger_condition":"Reservation update conflicts or crashes after intent append","guard_snippet":"Serialize reservation with optimistic concurrency before durable intent","potential_consequence":"Revision and event IDs collide"},
  {"lens":"adversarial","location":"lib/live/session-supervisor.ts:209-233","trigger_condition":"A finalized or processed window is replayed after restart","guard_snippet":"Persist and restore exact window and prepared-draft metadata","potential_consequence":"Recovery changes timestamps and fingerprints"},
  {"lens":"adversarial","location":"lib/live/live-chunk-builder.ts:69-91","trigger_condition":"Real worker builds a chunk without passing media_sha256","guard_snippet":"Hash finalized MP4 and reject missing digest","potential_consequence":"Immutable identity does not bind to media"},
  {"lens":"adversarial","location":"lib/live/session-supervisor.ts:559-590","trigger_condition":"Configured spool cap is exceeded","guard_snippet":"Delete or evict eligible files after durable drop and remeasure","potential_consequence":"Storage remains over cap until disk exhaustion"},
  {"lens":"adversarial","location":"lib/live/config.ts:211-233","trigger_condition":"Operators set timeout, index-attempt, or reserve values","guard_snippet":"Wire settings to runtime behavior and test non-default values","potential_consequence":"Documented safety controls do nothing"},
  {"lens":"adversarial","location":"lib/live/embed-window.ts:49-71","trigger_condition":"Runtime embedding stack mismatches the session contract","guard_snippet":"Fail on compatibility assertion and derive real dimensions","potential_consequence":"Incompatible vectors reach indexing"},
  {"lens":"adversarial","location":"lib/live/worker-loop.ts:84-99","trigger_condition":"An async poll exceeds its interval or rejects","guard_snippet":"Use a caught single-flight polling loop","potential_consequence":"Concurrent runtimes or unhandled rejections occur"},
  {"lens":"adversarial","location":"lib/live/spool-accounting.ts:118-126","trigger_condition":"Operator requests explicit retention deletion","guard_snippet":"Implement authorized coordinated deletion with tombstones","potential_consequence":"There is no supported way to reclaim retained data"},
  {"lens":"adversarial","location":"docker-compose.yml:13-16","trigger_condition":"Compose host is reachable by untrusted users","guard_snippet":"Bind loopback and require resource authorization","potential_consequence":"Unauthenticated control and retained-media access"},
  {"lens":"edge-case-hunter","location":"lib/live/control-service.ts:266-298","trigger_condition":"Terminal idempotency retry reclaims before conflict","guard_snippet":"Clear just-acquired claim before throwing","potential_consequence":"A stale terminal claim remains"},
  {"lens":"edge-case-hunter","location":"lib/live/processor.ts:227-241","trigger_condition":"Ack queue has no droppable slot","guard_snippet":"Keep work durable until ack enqueue succeeds","potential_consequence":"Successful work is lost"},
  {"lens":"edge-case-hunter","location":"lib/live/processor.ts:294-305","trigger_condition":"Index failure persists beyond configured attempts","guard_snippet":"Persist attempts and terminate after budget","potential_consequence":"Retry never terminates"},
  {"lens":"edge-case-hunter","location":"lib/live/worker-loop.ts:84-99","trigger_condition":"Two pollOnce calls overlap","guard_snippet":"Guard active poll promise","potential_consequence":"One-stream invariant can be violated"},
  {"lens":"edge-case-hunter","location":"app/api/live/sessions/[sessionId]/events/route.ts:106-193","trigger_condition":"Initial SSE setup rejects","guard_snippet":"Catch setup, emit error, clear timers, close stream","potential_consequence":"Client hangs on a silent stream"},
  {"lens":"verification-gap","location":"lib/live/adapters/rtsp.ts:230-259","trigger_condition":"No test drives pending source through worker validation","guard_snippet":"Route-create then await ready then route-create session","potential_consequence":"Blocked UI workflow ships undetected","gap_shape":"missing-adoption-gap","consumer":"app/live/page.tsx:126-188","evidence":"Symbol search finds no production caller; tests seed ready source documents"},
  {"lens":"verification-gap","location":"scripts/live-rtsp-readiness.ts:242-255","trigger_condition":"Manifest records HEAD without dirty worktree identity","guard_snippet":"Require clean tree or record deterministic content hash","potential_consequence":"Evidence points to code that was not tested","gap_shape":"broken-verification-gap","consumer":"todo/01-live-video-search-todo.md:223-224","evidence":"Current live implementation is untracked while manifest names 78d7e56"},
  {"lens":"verification-gap","location":"scripts/live-rtsp-readiness.ts:426-480","trigger_condition":"Fault probes bypass active SessionRuntime and LiveWorkerLoop","guard_snippet":"Inject faults into actual running application worker","potential_consequence":"Recovery and backpressure bugs do not fail readiness","gap_shape":"broken-verification-gap","consumer":"SessionRuntime and LiveWorkerLoop","evidence":"Capture stops before bounce; restart is a separate connect smoke"},
  {"lens":"verification-gap","location":"scripts/live-rtsp-readiness.ts:804-817","trigger_condition":"Playback gate never invokes the media route","guard_snippet":"Issue real HTTP full and Range requests","potential_consequence":"Playback routing regressions remain green","gap_shape":"broken-verification-gap","consumer":"app/api/live/chunks/[chunkId]/media/route.ts","evidence":"Gate slices a local buffer and assigns 206"},
  {"lens":"verification-gap","location":"lib/live/recovery.test.ts","trigger_condition":"Recovery tests stop before final document equivalence","guard_snippet":"Crash/restart and compare final chunk and event to uninterrupted output","potential_consequence":"Non-idempotent recovery ships","gap_shape":"regression-gap","consumer":"LiveChunkDocument and LiveEventDocument","evidence":"Tests assert replay IDs and states, not indexed payload equivalence"},
  {"lens":"verification-gap","location":"lib/live/processor.test.ts:39-89","trigger_condition":"Processor tests keep ack queue below capacity","guard_snippet":"Test ack rejection and eviction under pressure","potential_consequence":"Silent ack loss is not detected","gap_shape":"regression-gap","consumer":"lib/live/processor.ts:227-241","evidence":"Positive test uses capacity 24 for 20 windows"},
  {"lens":"verification-gap","location":"lib/live/session-supervisor.test.ts:87-167","trigger_condition":"Reconnect test does not reuse a populated capture directory","guard_snippet":"Assert second epoch excludes first-epoch files","potential_consequence":"Stale fragment replay remains untested","gap_shape":"regression-gap","consumer":"HlsFragmentWatcher and window assembler","evidence":"Test only counts supervisor starts and epoch bump"},
  {"lens":"verification-gap","location":"scripts/live-rtsp-readiness.ts:953-971","trigger_condition":"No test rejects mandatory NOT RUN status","guard_snippet":"Unit-test gate aggregation for every non-PASS state","potential_consequence":"Incomplete acceptance exits successfully","gap_shape":"broken-verification-gap","consumer":"CI and operator report.ok","evidence":"Implementation checks only whether any row equals FAIL"}
]
```
