# Architecture Spine Rubric Review — Live Video Search

## Re-review addendum — amended canonical package

Re-reviewed: **2026-09-10**  
Scope: **closure of the prior critical/high findings and any remaining implementation blocker**  
Mechanical result: **PASS — 0 findings**

### Current verdict

**REVISION REQUIRED — substantially improved, with two high-severity
cross-process inconsistencies remaining.** The original critical field/storage
contradiction is closed. Three of the four original high findings are closed;
the durable-event finding is only partially closed because one crash boundary
can still make a searchable chunk permanently invisible to follow/SSE.

### Prior critical/high closure

| Prior finding | Status | Evidence |
| --- | --- | --- |
| C-1: per-hit `searchable_at` had no source of truth | **CLOSED** | Search hits no longer claim it; the durable matching event owns `searchable_at` and final lag (`docs/live-video-api-contract.md:243-263`, `docs/live-video-data-model.md:165-171`). |
| H-1: cross-process event/replay authority undefined | **PARTIAL** | `live-video-events`, per-session revisions/cursors, retention expiry, and gap behavior now exist (AD-8, AD-9, AD-15), but R-H2 below leaves an unobservable crash gap. |
| H-2: worker ownership/fencing undefined | **CLOSED for MVP** | AD-5 binds the one-stream deployment to one worker process, an exclusive spool-root lock, and one Compose replica; distributed fencing is explicitly deferred. |
| H-3: UTC event-time derivation ambiguous | **CLOSED** | AD-16 defines receive-anchor UTC and monotonic duration semantics, with persisted uncertainty and explicit limits. |
| H-4: partial modality failure undefined | **CLOSED** | AD-7 makes present modalities atomic; absent audio is valid, while video or present-audio failure fails the whole window. |

The prior active-session cardinality, overload policy, and runtime-version
findings are also reconciled well enough to begin their planned phases. The
stale memlog remains a non-implementation process issue: its AD-3 through AD-13
entries do not yet reflect the amended rules, and it has no AD-14 through AD-16.

### Remaining high findings

#### R-H1 — Source registration requires a secret the web process is forbidden to receive

**Evidence:**:** `docs/live-video-api-contract.md:36-43` requires the API to resolve
`connection_ref` so it can validate the destination and calculate the redacted
endpoint/fingerprint. The source response and data model require those derived
values immediately (`docs/live-video-api-contract.md:45-60`,
`docs/live-video-data-model.md:22-40`). But the deployment contract says only
`live-worker` receives stream credential variables
(`docs/live-video-architecture.md:241-246`). AD-14 also says reconnect uses the
session snapshot containing already-derived endpoint/destination fields while
the worker resolves the connection reference.

**Impact:** Implementers must either give the web process secrets in violation
of the deployment/security boundary, return fields it cannot calculate, or add
an undocumented asynchronous validation state owned by the worker. Phase 1
source persistence and Phase 2 security cannot implement the current contracts
together.

**Required decision:** Choose one owner and bind it. Prefer preserving least
privilege: the API stores a strictly allowlisted `LIVE_SOURCE_*_URL` reference
in `pending_validation`; the worker resolves and validates it, then writes only
safe provenance/destination fields and transitions the source to `ready` or
`invalid`. The create/start API and field-ownership rules must reflect that
asynchrony. Alternatively, explicitly authorize the web service to receive and
resolve the connection-secret namespace and amend the deployment rule.

#### R-H2 — Crash after chunk acknowledgment but before event reservation is not detectable

**Evidence:** AD-7 and the data flow order successful bulk indexing, manifest
`index_ack`, and only then the durable `searchable` event
(`ARCHITECTURE-SPINE.md:90-95`, `docs/live-video-data-flow.md:53-58`,
`plan/01-live-video-search-implementation-plan.md:192-196`). AD-15 detects a
missing event only after a revision has been reserved
(`ARCHITECTURE-SPINE.md:138-142`). If the worker crashes after writing
`index_ack` but before reserving the event revision, recovery sees an
acknowledged window, no revision gap exists, and the plan replays only
unacknowledged windows (`plan/01-live-video-search-implementation-plan.md:167-180`).

**Impact:** The chunk is searchable by direct queries but follow search never
receives its trigger; its per-window `searchable_at`/lag evidence and session
counters may be absent permanently. This reopens part of the original H-1 and
breaks CAP-3/CAP-4/CAP-5 at a normal crash boundary.

**Required decision:** Make visibility-to-event publication an idempotent
outbox state machine. One enforceable ordering is: persist an event intent with
the window; reserve its session revision **before** a chunk can become visible;
bulk create/verify the chunk; create or fingerprint-verify the event at that
reserved revision; then append the terminal manifest acknowledgment. Recovery
must reconcile every reserved intent and every indexed-but-not-terminal window,
including stopped sessions. Add crash fixtures at each boundary.

### Re-review conclusion

No other implementation-blocking contradiction was found in the amended
canonical package. Once R-H1 and R-H2 are reconciled in the memlog, spine, API,
data model, data flow, implementation plan, and TODO, the architecture can pass
this reviewer lens. The singleton lock should be implemented as a
process-lifetime OS/advisory lock rather than a stale-file sentinel, but that is
an enforceability cleanup rather than a separate blocker.

---

## Initial review — superseded where the addendum says closed

Date: **2026-09-10**  
Intent: **Validate only; no deliverable changes made**  
Reviewer lens: **BMad good-spine checklist**

## Initial gate verdict

**REVISION REQUIRED.** The spine is strong at the component, security,
recovery, storage-isolation, and operational-envelope levels, and it passes the
deterministic architecture lint. It is not yet a safe build substrate because
one canonical response field is not derivable from the declared storage model,
and four cross-process seams still allow incompatible implementations.

Finding count: **1 critical, 4 high, 3 medium, 2 low**.

## Evidence reviewed

- `ARCHITECTURE-SPINE.md`
- `.memlog.md`
- `plan/specs/spec-live-video-search/SPEC.md`
- `requirements/02-live-video-search-requirements.md`
- `docs/live-video-api-contract.md`
- `docs/live-video-architecture.md`
- `docs/live-video-data-flow.md`
- `docs/live-video-data-model.md`
- `docs/live-video-operations.md`
- `plan/01-live-video-search-implementation-plan.md`
- Current repository seams in `lib/ingest/pipeline.ts`,
  `lib/ingest/job-store.ts`, `lib/es/index-chunks.ts`, `lib/es/search.ts`,
  `lib/embed/concurrency.ts`, `lib/ingest/variant.ts`, `Dockerfile`,
  `docker-compose.yml`, and `package.json`

Mechanical command:

```text
UV_CACHE_DIR=/tmp/codex-uv-cache uv run \
  /Users/ming.shen/.agents/skills/bmad-architecture/scripts/lint_spine.py \
  --workspace plan/architecture/architecture-live-video-search-2026-09-10
```

Result: **PASS — 0 findings**.

Current-version checks:

- Repository packages confirm Next.js `14.2.35`, React `18.3.1`, and EUI
  `119.1.0`; the local executable confirms FFmpeg `8.1.1`.
- MediaMTX `1.21.0` is the current release as of this review:
  <https://github.com/bluenviron/mediamtx/releases/tag/v1.21.0>.
- WHIP is correctly identified as RFC 9725:
  <https://www.rfc-editor.org/info/rfc9725/>.
- FFmpeg `8.1.2` is available upstream, so `8.1.1` is a valid brownfield
  baseline, not the latest upstream patch:
  <https://ffmpeg.org/releases/>.

## Checklist result

| Good-spine criterion | Result | Assessment |
| --- | --- | --- |
| Fixes the real divergence points for the level below | **FAIL** | Event transport/persistence, worker fencing, UTC event-time derivation, and partial-modality behavior are not fixed. |
| Every AD Rule is enforceable and prevents its stated divergence | **PARTIAL** | Most are testable; AD-4, AD-5, AD-7, AD-9, and AD-12 leave key mechanics or outcomes ambiguous. |
| Deferred contains no implementation divergence | **PASS with caveat** | Deferred items have usable MVP assumptions, but worker leasing is partly deferred while the data model and plan already require it. |
| Named technology is verified-current | **PARTIAL** | Major versions are evidenced, but the runtime/container does not reproducibly enforce the stated Node/FFmpeg baseline. |
| Ratifies rather than contradicts the brownfield codebase | **PASS** | Provider isolation, vector dimensions, RRF, proxy preparation, security, and bilingual UI align with current code; live state is appropriately separated from the in-memory file-job store. |
| Covers the driving spec capabilities | **PARTIAL** | All CAP-1 through CAP-8 are mapped, but CAP-4/CAP-5 response and event guarantees are not implementable from the declared persistence contract. |
| Does not weaken inherited parent decisions | **PASS** | No formal parent spine exists; the listed brownfield invariants are preserved. |
| Owns or explicitly defers every structural dimension | **PARTIAL** | Deployment, protocols, storage, security, operations, and UI are present; cross-process event ownership and clock semantics are materially silent. |

## Critical finding

### C-1 — Per-hit `searchable_at` has no durable source of truth

**Evidence:** AD-7 says a chunk is created with `refresh=wait_for` and only then
is `searchable` emitted (`ARCHITECTURE-SPINE.md:90-95`). The data model explicitly
excludes `searchable_at` from the immutable create-only chunk and says it exists
only in the session/event acknowledgment (`docs/live-video-data-model.md:115-120,
188-203`). The API nevertheless requires every search hit to contain that
chunk-specific field and its close-to-searchable lag
(`docs/live-video-api-contract.md:233-249`). The sole session document retains
only `last_searchable_at`, which cannot reconstruct values for older hits.

**Why it matters:** CAP-4, LVR-FR-18, the latency gate, and the search response
cannot all be satisfied by querying `live-video-chunks`. Two implementers would
either fabricate the timestamp, mutate an allegedly immutable document, add an
undeclared join/event index, or omit a required field.

**Disposition:** **Discuss, then amend the spine and companions before Phase 1.**
Choose one enforceable contract: (a) make chunk finalization a two-step
write/update and define when it becomes visible; (b) persist per-chunk
acknowledgments in an event data stream and define the read join; or (c) remove
`searchable_at` from hit storage and redefine the measurable/returned lag. Add a
crash-boundary test for index-visible-before-ack.

## High findings

### H-1 — The cross-process event channel and replay authority are undefined

**Evidence:** AD-1 separates the worker from Next.js and AD-5 gives the worker
runtime-state ownership, but the structural seed has only source, session, and
chunk storage. The API promises resumable SSE with `Last-Event-ID` and detailed
`window_failed`, `window_dropped`, and `searchable` events
(`docs/live-video-api-contract.md:173-195`); the session snapshot stores only
latest state, counters, and current error. CAP-5 requires each fault's code,
timestamp, affected sequence, and recovery state. AD-9 additionally says follow
search reruns on searchable revisions, while the API exposes one
`max_session_revision` for a query that may span many sessions
(`docs/live-video-api-contract.md:221-256`).

**Why it matters:** There is no shared owner from which the web process can
replay lost per-window events, and a scalar maximum cannot be used as a correct
multi-session cursor. Implementations could poll latest snapshots, keep
process-local listeners, or invent an event index, with different loss and
ordering behavior.

**Disposition:** **Autofix architecture after choosing the mechanism.** Add an
AD that selects a durable event log/change-feed or explicitly narrows SSE to
snapshot-only semantics. Define event identity, ordering scope, retention,
replay gap behavior, and a per-session revision vector or global cursor for
multi-session follow queries.

### H-2 — “The worker alone” is not an ownership/fencing rule

**Evidence:** AD-5 declares one writer but does not distinguish concurrent
worker instances (`ARCHITECTURE-SPINE.md:78-83`). The data model already includes
`worker_id` and `worker_lease_until` (`docs/live-video-data-model.md:56-66`), and
Phase 4 requires polling, claiming, lease renewal, and one-worker ownership
(`plan/01-live-video-search-implementation-plan.md:158-176`). Yet Deferred says
multi-host worker leasing waits for a higher stream target
(`ARCHITECTURE-SPINE.md:186-193`).

**Why it matters:** A restart, delayed process, duplicate Compose service, or
lease expiry can leave two workers capturing, incrementing revisions, mutating
the same spool, and indexing overlapping sequences. Optimistic concurrency on a
session update does not fence the stale process from media and indexing side
effects.

**Disposition:** **Discuss.** Either bind MVP deployment to an enforced singleton
worker and remove lease/claim language, or adopt a lease plus monotonically
increasing fencing token that every session mutation, manifest writer, and
chunk create validates. Keep distributed queues deferred, not basic exclusive
ownership.

### H-3 — Absolute event-time derivation is not deterministic

**Evidence:** AD-4 specifies epoch and identity behavior but not how transport
timestamps become UTC (`ARCHITECTURE-SPINE.md:72-76`). The data-flow companion
uses “best available UTC event-time derived from source timestamps and session
wall clock” (`docs/live-video-data-flow.md`, Time semantics), while LVR-FR-6,
LVR-FR-18, and LVR-NFR-6 require derived UTC time, absolute-range search, and
playback alignment. RTSP PTS commonly has no absolute UTC meaning.

**Why it matters:** Different adapters can anchor PTS at first packet, fragment
close, RTCP-derived time, or receive wall clock. Reconnects, clock drift, and
jitter would produce incompatible search filters and displayed timestamps while
still satisfying the current words.

**Disposition:** **Discuss.** Add a time-model AD defining source-time priority,
wall-clock fallback anchor, reconnect anchoring, clock source, discontinuity and
drift thresholds, rounding, and which timestamp drives `@timestamp`. Require the
run manifest to record the time-source mode.

### H-4 — Partial modality failure has no semantic outcome

**Evidence:** AD-7 requires concurrent visual/audio inference, the inherited
invariants retain dual vectors and RRF, and the implementation plan says partial
modality failures will be covered (`plan/01-live-video-search-implementation-plan.md:178-198`).
No rule says whether present-audio failure fails/retries the entire window,
indexes a video-only degraded window, or emits a searchable record with a
modality status. The current file pipeline is effectively all-or-nothing for an
individual window (`lib/ingest/pipeline.ts:322-370`).

**Why it matters:** Index content, retry behavior, RRF eligibility, operator
counters, and recovery acknowledgments will diverge across worker, repository,
and search implementations.

**Disposition:** **Discuss.** Ratify all-or-nothing per present modality for the
MVP, or define partial-success fields and search semantics. Encode the choice in
AD-7, the manifest terminal states, chunk mapping, error catalog, and tests.

## Medium findings

### M-1 — Active-session cardinality and `force_new` behavior are unbound

**Evidence:** LVR-FR-2 says start is idempotent for an active source unless
`force_new` is requested (`requirements/02-live-video-search-requirements.md:47-48`).
The API contract documents session creation and session restart, but not
`force_new` conflict/drain semantics. Neither the spine nor state ownership says
whether one source may have multiple active sessions.

**Why it matters:** API and worker teams can independently choose “one active
session per source,” “parallel sessions,” or “force-stop then replace,” creating
duplicate capture and ambiguous operator state.

**Disposition:** **Autofix after confirming product intent.** For the one-stream
MVP, the simplest invariant is at most one nonterminal session per source;
define the atomic create/start conflict and explicit replacement transition.

### M-2 — AD-12 dropped the selected overload policy from its memlog decision

**Evidence:** The memlog records a configurable `drop_oldest` decision; the
operations guide and implementation plan select the oldest non-processing
window. AD-12 only says “any configured drop” is recorded
(`ARCHITECTURE-SPINE.md:120-124`).

**Why it matters:** Queue, manifest reducer, counters, and recovery tests could
implement newest-drop, oldest-drop, or session-fail behavior and all claim spine
compliance.

**Disposition:** **Autofix.** Restore the chosen MVP rule to AD-12, including the
eligible set (“oldest queued, not processing”) and failure behavior if the
terminal drop record cannot be persisted.

### M-3 — Runtime versions are descriptive, not reproducibly bound

**Evidence:** The stack lists Node `22.x` and FFmpeg `8.1.1`, while the existing
Dockerfile uses floating `node:22-bookworm-slim` and installs FFmpeg from the
distribution repository. The local FFmpeg is `8.1.1`, but upstream already
publishes `8.1.2`.

**Why it matters:** Live fragmentation, RTSP timeout, and protocol-whitelist
behavior can differ across FFmpeg builds even when the document claims one
baseline. Independent environments can satisfy the Dockerfile yet run a
different binary.

**Disposition:** **Defer to Phase 2 at the latest.** Define the supported/runtime
version rule and record the actual container digest plus `ffmpeg -version` in
acceptance. Exact pinning is preferable for the deterministic fixture.

## Low findings

### L-1 — Duplicate acknowledgment wording is weaker than its companion

AD-7 permits a “duplicate-ID acknowledgment,” while the data model correctly
requires retrieving the existing document and verifying source/session/epoch/
sequence before accepting a 409. Add “verified” to the AD rule so an implementer
cannot treat every conflict as success.

**Disposition:** **Autofix.**

### L-2 — The spine's event timestamp name differs from the memlog

AD-13 requires `window_ready`, while the memlog lists `fragment_closed` then
inference timestamps and omits `window_ready`; the spine also includes both
`fragment_closed` and `window_ready`. The rendered spine is more complete, but
the memlog is supposed to be the authority.

**Disposition:** **Autofix the memlog on the architecture update** so future
redistillation does not regress the measurement contract.

## What is already strong

- The named ports-and-adapters streaming paradigm is appropriate and concise.
- Protocol termination, long-running worker separation, immutable windowing,
  deterministic identity, live/file storage separation, spool recovery,
  deny-by-default remote input, and bounded backpressure are real divergence
  points and are expressed as enforceable rules.
- Every CAP is mapped to components and ADs; no capability is silently absent.
- The spine does not overclaim implementation or readiness, and the operations
  companion keeps all live gates at NOT RUN.
- Deferred protocol extensions, alerts, production authorization, and scaling
  are legitimate scope boundaries; default assumptions allow the RTSP MVP to
  proceed once the findings above are resolved.

## Recommended revision order

1. Resolve C-1 together with H-1 because one durable per-chunk event/ack design
   can close both gaps.
2. Resolve H-2 before implementing repositories or the worker supervisor.
3. Resolve H-3 before implementing fragments, epochs, mappings, or time filters.
4. Resolve H-4 and M-1 before freezing API and manifest state contracts.
5. Apply M-2, M-3, and the low cleanups, then rerun lint plus this rubric.

The spine should remain `status: final` only after the critical/high findings
are reconciled into the memlog, redistilled into stable ADs, and reflected in
the canonical companion contracts.
