# Live Video Planning Review

Date: **2026-09-10**  
Path: **comprehensive coaching path**  
Scope: requirements, canonical spec, architecture spine, API contract, data
model, data flow, operations, implementation plan, and TODO  
Implementation reviewed: **none**

## Verdict

**PLANNING COMPLETE; READY TO START PHASE 1.**

The package now specifies the RTSP MVP deeply enough for independent
implementation of configuration, storage, source validation, session control,
capture, recovery, indexing, SSE, search, and retained media. All review-found
planning blockers have a binding disposition in the canonical documents.

This verdict does not claim that live-video code exists or that any runtime gate
passes. Worker-image capability, target Elasticsearch compatibility, protocol,
latency, recovery, security, playback, and regression evidence remain
implementation gates.

## Review Method

The review used four lenses:

- adversarial review of cross-component contracts and contradictory ownership;
- exhaustive edge-path tracing across concurrency, crash, retention, SSE, and
  protocol boundaries;
- structural review of implementation order and decision placement;
- prose review for ambiguous implementation instructions.

Prior architecture review rounds are preserved under
[`archive/2026-09-10-live-video-planning/`](./archive/2026-09-10-live-video-planning/).

## Resolved Findings

| Finding | Planning resolution | Canonical location |
| --- | --- | --- |
| Web secret-access contradiction | API validates only the reference name; worker resolves a structured secret and writes safe provenance | `docs/live-video-state-recovery.md`, source validation |
| Credential URL/userinfo conflict | Structured secret separates a base URL without userinfo from credentials | state/recovery contract, source validation |
| Active-session creation race | Required idempotency key, deterministic session ID, source CAS claim, and reconciliation sequence | state/recovery contract, session creation |
| Dormant-session ambiguity | Session creation always requests running; terminal sessions cannot restart | API contract and transition table |
| Worker-unavailable ambiguity | Singleton heartbeat and a deterministic 503 response are required before claiming a session | data model and API contract |
| Visible chunk without searchable event | Generic event intent and reserved revision precede indexing; event publication precedes terminal acknowledgment | state/recovery contract, searchable outbox |
| Revision-gap recovery ambiguity | One serialized per-session event writer and manifest-backed intent recovery are required | state/recovery contract |
| Strict event payload conflict | Event payload is stored with `enabled: false`; queryable fields remain top-level | data model |
| Sequence allocation crash | Allocation precedes publication; abandoned allocations are durable and never reused | state/recovery contract, manifest publication |
| Stopped-session pending work | Recovery scans every nonterminal manifest before polling new running work | architecture and state/recovery contract |
| Recovery-versus-drop contradiction | A durable drop is the only exception to replay eligibility | requirements and state/recovery contract |
| Hidden refresh backlog | Indexing acknowledgments have a separate bounded queue and in-flight limit | architecture, operations, Phase 4/5 plan |
| Follow-search ambiguity | `variant_id` and explicit session IDs are required; cursors advance only after successful output | API and state/recovery contracts |
| Process-local handle routing | One web replica is an MVP invariant; scaling requires sticky routing or shared state | architecture spine |
| Session state divergence | Allowed transitions, terminal states, and stable reasons are normative | state/recovery contract |
| Source disable ambiguity | Disable blocks future sessions and does not implicitly stop an active one | API and state/recovery contracts |
| Short epoch tail | Full windows only; incomplete tails receive their own terminal record and count treatment | state/recovery contract |
| Configurable template collision | Templates match exact configured stream names and setup must preflight drift | data model and Phase 1 plan |
| Retention dependency | Event retention is strictly greater than vector retention; clip retention cannot exceed vector retention while lookup uses chunk IDs | operations and data model |
| DNS validation race | Actual connection must be bound by safe literal-address handling or network egress controls | requirements, operations, Phase 2 gate |
| Receive-anchor precision | Phase 2 must prove the capture mechanism and persist uncertainty; fallback precision cannot be fabricated | architecture spine |
| Plan sequencing | RTSP readiness now precedes optional HLS, SRT, and WHIP expansion | implementation plan |
| Final outbox review | Split media finalization from processed chunk draft; generalized event intents; defined pre-retrieval follow baselines and no-change cursor checkpoints | data model and state/recovery contract |
| Cross-restart timing | Persist worker boot identity and UTC/monotonic pairs; mark cross-boot latency and include uncertainty | state/recovery contract and architecture spine |
| Cross-rollover duplicate IDs | Recovery queries the full data stream before create; retrieval collapses by `chunk_id` | state/recovery and data-model contracts |
| Window alignment ambiguity | RTSP MVP uses four finalized HLS fragments advanced by three; stored PTS is authoritative | requirements and architecture spine |
| Processing capacity gap | Added processing concurrency, per-window deadline, live retry limits, fixed proxy ladder, and a measurable service-time margin | operations and Phase 5 plan |
| Brownfield reuse mismatch | Limited IP reuse to classification, required a new capture supervisor, and treated pipeline extraction as a protected refactor | implementation plan |
| EIS follow-query mismatch | Live search calls inference once and passes the cached vector into all kNN/RRF branches | Phase 7 plan |
| Cross-process event tail | Defined Elasticsearch polling, event refresh policy, poll interval, and latency ownership | state/recovery and operations contracts |
| Deployment secret isolation | Required separate web/worker environments in Phase 2, web startup rejection, and a separate FFmpeg fixture publisher | operations and Phase 2 plan |
| Early feasibility evidence | Added a disposable 50-window media/latency spike before Phase 3 | planning prerequisite |
| Elastic deployment boundary | Prohibited local Elasticsearch installation/containers; all setup and tests use the external `.env` endpoint | spec, architecture, operations, plan, and TODO |
| Optional manifest sequencing | Recorded a minimum recovery-critical record set that may be implemented before expiry/audit/compaction records without reducing the final contract | Phase 3/4 plan |
| Final consistency pass | Added processed-window records, generic event intents, explicit follow baselines/full top-K semantics, retention snapshot fields, and an independently bounded indexing-ack queue | data model, API, state/recovery, and operations contracts |

## Accepted Implementation Gates

These are not planning defects and remain open until code and runtime evidence
exist:

| Gate | Required evidence |
| --- | --- |
| Worker runtime | Digest-pinned Node/FFmpeg image, non-root execution, startup capability manifest |
| Elasticsearch client | Tested 9.x-compatible client or isolated raw REST path; live template/lifecycle create and read-back on the target cluster |
| Capture clock | Measured receive-anchor mechanism and uncertainty on the actual FFmpeg process |
| Destination binding | DNS-rebinding test plus literal-address or egress-control proof |
| Storage setup | Strict mappings, exact data-stream patterns, lifecycle, second-run no-op, and unchanged file indices |
| Recovery | Fault injection at every row of the recovery matrix |
| Performance | Ten-minute one-stream run with p50/p95/p99 stage timings and bounded queues |
| Search and playback | Text/image relevance, cached follow query, timestamp alignment, Range, expiry, and symlink/traversal tests |
| Compatibility | Existing file-search tests, build, routes, and selected E2E remain green |

## Deferred Decisions

The following decisions do not block Phase 1 or the controlled one-stream RTSP
slice. They block production sizing, policy claims, or optional protocol work:

- target simultaneous stream count, assumed one;
- pending-spool and retained-media byte budgets for the target machine;
- vector retention, assumed seven days;
- clip and thumbnail retention, assumed 24 hours and no longer than vector retention;
- production source host/CIDR and port allowlist;
- whether WHIP is required in the first release;
- externally exposed MediaMTX ports and the WHIP TLS/CORS/ICE/STUN/TURN profile.

## Review Closure

The planning package is internally consistent for the RTSP MVP. Implementation
must proceed phase by phase and may not mark a gate complete from unit tests or
document review alone when the gate explicitly requires a container, target
Elasticsearch, MediaMTX, or timed end-to-end run.

The independent development-readiness review was incorporated and archived as
[`archive/2026-09-10-live-video-planning/development-readiness-review.md`](./archive/2026-09-10-live-video-planning/development-readiness-review.md).
Its findings F-1 through F-8 and recommendation R-1 were accepted. R-2 remains
an optional minimum-first manifest sequencing choice and does not reduce the
final manifest contract.
