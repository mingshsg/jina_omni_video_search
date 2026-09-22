# Plan Review — Live Video Search

Date: **2026-09-10**  
Scope: current live-video spec, architecture spine, implementation plan,
requirements, API, data model, state/recovery contract, data flow, operations,
traceability matrix, and TODO  
Review type: **documents and planning contracts only**  
Implementation verification: **not performed by this review**

## Verdict

**REVISION REQUIRED BEFORE PHASE 2.**

The architecture direction is credible, and the searchable-event outbox,
manifest recovery matrix, source-secret isolation, worker/web separation, and
phase gates are unusually well specified for a planning package. However, the
current documents no longer provide one consistent implementation oracle. The
newly confirmed indefinite-retention and Phase 1 decisions conflict with the
canonical spec, requirements, API examples, traceability status, operations
language, and the prior “current” planning review.

The first correction should be a mechanical decision/status synchronization
pass. After that, the remaining behavioral gaps below should be closed before
RTSP adapter work is accepted.

## Review Method

This review used the BMad Adversarial, Edge-Case Hunter, Editorial Structure,
and Editorial Prose lenses. The package contains **16,783 words** across the ten
staged planning documents. The inferred audience is the engineering team that
will implement and accept the one-stream RTSP MVP.

## Adversarial Findings

### A-01 — Retention has mutually exclusive canonical answers

- **Location:** `plan/01-live-video-search-implementation-plan.md:7-16`;
  `plan/specs/spec-live-video-search/SPEC.md:98-114`;
  `requirements/02-live-video-search-requirements.md:194-203`;
  `docs/live-video-data-model.md:382-397`
- **Trigger condition:** The implementation follows a document other than the
  plan/TODO when configuring retention.
- **Guard snippet:** Replace every 7-day/24-hour assumption and open question
  with the confirmed indefinite-retention decision, or designate one decision
  register and make all other files reference it.
- **Potential consequence:** Different components implement timed deletion and
  indefinite retention simultaneously.

### A-02 — Implementation status is contradictory

- **Location:** `plan/01-live-video-search-implementation-plan.md:3`;
  `requirements/02-live-video-search-requirements.md:3`;
  `plan/02-live-video-traceability.md:3`;
  `todo/01-live-video-search-todo.md:4,48-73`;
  `reviews/live-video-planning-review-2026-09-10.md`
- **Trigger condition:** A reader uses a status banner or current review to
  decide whether Phase 1 exists and has passed.
- **Guard snippet:** Establish one current status/evidence artifact, update the
  plan and traceability headers from it, and archive the superseded review.
- **Potential consequence:** Work is repeated, skipped, or represented as
  unimplemented after live Elasticsearch mutations have occurred.

### A-03 — Unlimited disk growth contradicts bounded-resource requirements

- **Location:** `plan/01-live-video-search-implementation-plan.md:11-13`;
  `requirements/02-live-video-search-requirements.md:140-145,166-167`;
  `docs/live-video-operations.md:64-70,149-162`
- **Trigger condition:** Spool byte caps remain unset, as the confirmed MVP
  decision permits.
- **Guard snippet:** Define the guarantee as queue-bounded but disk-unbounded,
  or require a minimum free-space watermark even when byte caps are disabled.
- **Potential consequence:** The plan claims bounded behavior while media grows
  until filesystem exhaustion.

### A-04 — “Until explicit delete” has no delete capability

- **Location:** `docs/live-video-data-model.md:382-397`;
  `docs/live-video-operations.md:68-70,89-92`;
  `plan/01-live-video-search-implementation-plan.md:62-110,217-430`
- **Trigger condition:** An operator needs to reclaim disk or remove retained
  source/session data.
- **Guard snippet:** Add a scoped administrative deletion phase and contract
  covering vectors, events, manifests, clips, thumbnails, active-work guards,
  audit records, and partial-failure recovery.
- **Potential consequence:** “Explicit delete” is an unavailable retention
  mechanism and the only recovery path is manual filesystem/index surgery.

### A-05 — The loopback security test has the opposite MVP expectation

- **Location:** `plan/01-live-video-search-implementation-plan.md:203-215`;
  `docs/live-video-operations.md:44-46,164-177`
- **Trigger condition:** The Phase 2 suite runs against the confirmed localhost
  MediaMTX fixture.
- **Guard snippet:** Split fixtures into “reject loopback by default” and “allow
  loopback only when an exact explicit rule names it.”
- **Potential consequence:** The same localhost input is required to pass and
  fail the gate.

### A-06 — Two serial refresh waits are not represented in the latency budget

- **Location:** `docs/live-video-state-recovery.md:125-150,215-222`;
  `docs/live-video-operations.md:112-128`
- **Trigger condition:** Chunk visibility and the subsequent event write each
  wait for a Serverless refresh interval.
- **Guard snippet:** Budget and measure chunk refresh and event refresh as
  separate stages, or redesign event visibility so one refresh boundary covers
  the externally measured acknowledgment.
- **Potential consequence:** The 10-second p95 target can fail even when every
  listed component meets its individual budget.

### A-07 — Rollover duplicate defense is not atomic or ranking-safe

- **Location:** `docs/live-video-data-model.md:337-343`;
  `docs/live-video-state-recovery.md:134-145,211-213`
- **Trigger condition:** A data-stream rollover occurs between logical-ID lookup
  and create, or a timed-out create is retried into a new backing index.
- **Guard snippet:** Use an identity authority with cross-rollover uniqueness,
  route each logical document to one stable write index, or prove deduplication
  before candidate ranking rather than only before response attribution.
- **Potential consequence:** Duplicate documents consume the RRF candidate
  window and distort rank even if the final response collapses IDs.

### A-08 — Source validation lacks stale-revision rejection

- **Location:** `docs/live-video-api-contract.md:76-83`;
  `docs/live-video-state-recovery.md:10-39`;
  `docs/live-video-data-model.md:150-159`
- **Trigger condition:** A source is patched while the worker validates an older
  `connection_ref`.
- **Guard snippet:** Require the worker’s ready/invalid write to compare-and-set
  the exact `source_revision` it resolved; discard stale validation results.
- **Potential consequence:** Old safe provenance can mark a newly patched
  connection as ready.

### A-09 — `force_new` and idempotency identity do not compose

- **Location:** `docs/live-video-api-contract.md:127-144`;
  `docs/live-video-state-recovery.md:41-59`
- **Trigger condition:** A caller retries `force_new` with the same key, or two
  callers request replacement with different keys.
- **Guard snippet:** Define whether replacement requires a new key, which
  pending replacement owns the source claim, and the response returned after
  the old session becomes terminal.
- **Potential consequence:** Replacement can recreate the old deterministic ID
  or allow competing replacement sessions.

### A-10 — `capture_lag_ms` depends on an undefined sample

- **Location:** `docs/live-video-data-flow.md:111-127`;
  `docs/live-video-data-model.md:215-300`
- **Trigger condition:** The worker computes the documented capture-lag metric.
- **Guard snippet:** Add `window_end_receive` as a persisted `StageClockSample`
  with acquisition semantics, or redefine capture lag using fields that exist.
- **Potential consequence:** Implementations calculate incompatible values or
  omit a required health metric.

### A-11 — Fragment drift has no admissible range or failure action

- **Location:** `requirements/02-live-video-search-requirements.md:70-86`;
  `plan/01-live-video-search-implementation-plan.md:217-244`
- **Trigger condition:** Four finalized fragments cover materially less or more
  than the nominal eight-second window.
- **Guard snippet:** Define duration/PTS gap tolerances, whether to trim, reject,
  or open a new epoch, and the exact terminal record and counter.
- **Potential consequence:** Model inputs and overlap semantics vary by camera
  while all still satisfy “four fragments.”

### A-12 — Worker runtime pinning is both a prerequisite and optional scaffold

- **Location:** `plan/01-live-video-search-implementation-plan.md:7-16,146-180`;
  `todo/01-live-video-search-todo.md:48-73`;
  `plan/architecture/architecture-live-video-search-2026-09-10/ARCHITECTURE-SPINE.md`, Stack
- **Trigger condition:** Phase 2 begins with the worker manifest scaffold but no
  resolved image digest or verified FFmpeg capability set.
- **Guard snippet:** Make exact runtime evidence a Phase 2 entry gate, or relax
  the architecture wording consistently and state which capture tests may run
  on the floating Bookworm package.
- **Potential consequence:** Protocol and fragmentation evidence is produced by
  a runtime different from the eventual worker.

## Edge-Case Hunter Findings

### E-01

- **Location:** `docs/live-video-state-recovery.md:10-39`
- **Trigger condition:** Source changes while old validation is in flight.
- **Guard snippet:** `writeValidation(result, ifSourceRevision)`
- **Potential consequence:** Stale validation authorizes the wrong connection.

### E-02

- **Location:** `docs/live-video-api-contract.md:139-144`
- **Trigger condition:** Worker heartbeat expires after precheck but before session claim.
- **Guard snippet:** `created session remains pending; worker availability is rechecked asynchronously`
- **Potential consequence:** A 202 response can strand an unowned session indefinitely.

### E-03

- **Location:** `docs/live-video-state-recovery.md:41-59`
- **Trigger condition:** Same idempotency key is reused after terminal replacement.
- **Guard snippet:** `require a new replacement key or version deterministic identity by run`
- **Potential consequence:** New-run creation resolves to immutable old history.

### E-04

- **Location:** `docs/live-video-state-recovery.md:56-59`
- **Trigger condition:** Concurrent callers request `force_new` with different keys.
- **Guard snippet:** `CAS one pending_replacement_id and return it to all contenders`
- **Potential consequence:** Multiple successor sessions race after drain.

### E-05

- **Location:** `docs/live-video-operations.md:64-70,149-162`
- **Trigger condition:** Unlimited spool consumes manifest reserve and filesystem metadata space.
- **Guard snippet:** `stop before min_free_bytes; persist terminal state to Elasticsearch if manifest append fails`
- **Potential consequence:** Failure cannot be durably recorded at disk exhaustion.

### E-06

- **Location:** `docs/live-video-data-model.md:337-343`
- **Trigger condition:** Rollover occurs between absence query and create.
- **Guard snippet:** `serialize rollover/write or use a stable identity index`
- **Potential consequence:** Two logical copies survive in separate backing indices.

### E-07

- **Location:** `requirements/02-live-video-search-requirements.md:76-86`
- **Trigger condition:** Fragment durations exceed the unrecorded tolerance.
- **Guard snippet:** `if coverage outside range, terminally reject or split epoch`
- **Potential consequence:** Window duration and overlap drift without a fault signal.

### E-08

- **Location:** `docs/live-video-state-recovery.md:125-150`
- **Trigger condition:** Event refresh stalls after chunk refresh succeeds.
- **Guard snippet:** `bound event deadline and define queue-pressure transition`
- **Potential consequence:** Searchable chunks accumulate behind unpublished events.

### E-09

- **Location:** `docs/live-video-data-model.md:382-397`
- **Trigger condition:** Future explicit delete overlaps recovery or an active media response.
- **Guard snippet:** `delete only terminal unreferenced records through a durable deletion state machine`
- **Potential consequence:** Recovery resurrects deleted data or playback reads partial files.

### E-10

- **Location:** `docs/live-video-api-contract.md:299-313`
- **Trigger condition:** Follow handle expires during retrieval or provider inference.
- **Guard snippet:** `pin handle through operation, then expire before committing cursor/output`
- **Potential consequence:** Work completes against a removed handle or advances no cursor.

## Editorial Findings

This package exists to help an engineering team implement and accept the
one-stream RTSP MVP. The closest structure model is **Strategic/Context
(Pyramid)** for the package, with the implementation plan acting as a linear
guide.

| Pass | Original Text | Revised Text | Changes |
| --- | --- | --- | --- |
| structure | Confirmed decisions repeated in the plan, TODO, data model, operations, spec assumptions, requirements assumptions, and old review | **MERGE** into one normative decision register; retain short links elsewhere | Removes the source of current drift and saves about 250 words |
| structure | Status banners and Phase 1 evidence spread across plan, requirements, traceability, TODO, operations, and current review | **MOVE** mutable status/evidence to TODO plus one dated current-run review; keep canonical contracts status-neutral | Prevents stale readiness claims and saves about 150 words |
| structure | `SPEC.md` claims its companion list is the complete contract but excludes `docs/live-video-architecture.md`, `docs/live-video-data-flow.md`, and TODO | **QUESTION:** mark excluded files explanatory/tracking, or add every normative file to the companion list | Establishes a clear authority boundary; approximately word-neutral |
| structure | Timed expiry, 410, and retention-race behavior remains interleaved with an indefinite-retention MVP | **MOVE** future timed-retention behavior to Deferred Retention; keep only explicit-delete behavior in the MVP contract | Keeps current behavior scannable and saves about 180 words from the active path |
| structure | Phase 1 implementation evidence appears in TODO while `reviews/live-video-planning-review-2026-09-10.md` still says no implementation was reviewed | **MOVE** the old review to the dated archive and create one current Phase 1 evidence report | Restores the review index as a trustworthy entry point; small word increase |
| prose | “metadata and an indirect credential reference” | “metadata and an indirect connection reference” | Uses the canonical `connection_ref` term |
| prose | “passphrase by credential ref” | “passphrase supplied through `connection_ref`” | Removes a second term for the same contract |
| prose | “fencing design stays multi-stream-compatible” | “the MVP state model leaves room for a later fenced multi-stream design” | Avoids claiming a fencing design that the spine explicitly defers |
| prose | “immediate EIS indexing” | “continuous per-window EIS indexing” | Avoids implying zero indexing latency |
| prose | Configuration table heading “Assumed default” | “MVP default” | Matches the newly confirmed decisions |
| prose | “forever until explicit delete” | “retained indefinitely; removal requires the planned administrative delete operation” | Names the operational condition instead of using an absolute colloquialism |

If all structural recommendations are accepted, the estimated reduction is
about **580 words (3.5%)**. The larger benefit is not brevity; it is eliminating
multiple competing sources of truth. The diagrams, recovery matrix, API
examples, and phase gates should be preserved.

## Canonical JSON Findings

```json
[
  {"lens":"adversarial","location":"plan/01-live-video-search-implementation-plan.md:7-16; SPEC.md:98-114; requirements:194-203; data-model:382-397","trigger_condition":"Retention has mutually exclusive canonical answers","guard_snippet":"Centralize the confirmed retention decision and replace stale assumptions","potential_consequence":"Components implement timed and indefinite retention simultaneously"},
  {"lens":"adversarial","location":"plan:3; requirements:3; traceability:3; todo:4,48-73; current planning review","trigger_condition":"Implementation status differs across current documents","guard_snippet":"Use one current status and evidence artifact","potential_consequence":"Completed work is repeated or skipped"},
  {"lens":"adversarial","location":"plan:11-13; requirements:140-145,166-167; operations:64-70","trigger_condition":"Unlimited spool conflicts with bounded-resource guarantees","guard_snippet":"Require free-space watermark or narrow the guarantee","potential_consequence":"Filesystem exhaustion violates the stated NFR"},
  {"lens":"adversarial","location":"data-model:382-397; operations:68-70; implementation plan","trigger_condition":"Explicit deletion is the only retention mechanism but is unplanned","guard_snippet":"Add an administrative deletion contract and phase","potential_consequence":"Operators cannot reclaim retained data safely"},
  {"lens":"adversarial","location":"plan:203-215; operations:44-46,164-177","trigger_condition":"Loopback is both rejected and explicitly allowed","guard_snippet":"Test default rejection and explicit localhost allowance separately","potential_consequence":"The RTSP fixture has contradictory pass criteria"},
  {"lens":"adversarial","location":"state-recovery:125-150,215-222; operations:112-128","trigger_condition":"Latency budget omits the second serial refresh wait","guard_snippet":"Budget both refresh stages or remove one visibility wait","potential_consequence":"The ten-second target fails under nominal refresh behavior"},
  {"lens":"adversarial","location":"data-model:337-343; state-recovery:134-145,211-213","trigger_condition":"Rollover duplicate prevention is non-atomic and post-ranking","guard_snippet":"Add a cross-rollover identity authority or stable write target","potential_consequence":"Duplicates distort RRF before response collapse"},
  {"lens":"adversarial","location":"api:76-83; state-recovery:10-39; data-model:150-159","trigger_condition":"Validation results are not fenced by source revision","guard_snippet":"CAS validation output against the resolved source revision","potential_consequence":"Stale provenance marks a changed source ready"},
  {"lens":"adversarial","location":"api:127-144; state-recovery:41-59","trigger_condition":"force_new has no deterministic idempotency interaction","guard_snippet":"Define replacement key ownership and successor identity","potential_consequence":"Replacement retries reuse history or race successors"},
  {"lens":"adversarial","location":"data-flow:111-127; data-model:215-300","trigger_condition":"capture_lag_ms uses an undefined timestamp sample","guard_snippet":"Persist window_end_receive or redefine the metric","potential_consequence":"Health metrics differ across implementations"},
  {"lens":"adversarial","location":"requirements:70-86; plan:217-244","trigger_condition":"Fragment drift has no admissible range or action","guard_snippet":"Define drift thresholds and terminal behavior","potential_consequence":"Window semantics vary silently by camera"},
  {"lens":"adversarial","location":"plan:7-16,146-180; todo:48-73; spine Stack","trigger_condition":"Runtime pinning is prerequisite and optional scaffold","guard_snippet":"Make runtime evidence a Phase 2 entry gate","potential_consequence":"Acceptance uses a different FFmpeg runtime"},
  {"lens":"edge-case-hunter","location":"state-recovery:10-39","trigger_condition":"Source changes during validation","guard_snippet":"writeValidation(result, ifSourceRevision)","potential_consequence":"Old validation authorizes new source settings"},
  {"lens":"edge-case-hunter","location":"api:139-144","trigger_condition":"Worker disappears after heartbeat precheck","guard_snippet":"Define pending ownership and asynchronous availability recheck","potential_consequence":"Accepted session remains stranded"},
  {"lens":"edge-case-hunter","location":"state-recovery:41-59","trigger_condition":"Terminal run reuses the same idempotency key","guard_snippet":"Require a new key or version session identity","potential_consequence":"New run resolves to immutable history"},
  {"lens":"edge-case-hunter","location":"state-recovery:56-59","trigger_condition":"Concurrent force_new requests use different keys","guard_snippet":"CAS one pending replacement identifier","potential_consequence":"Multiple successors race after drain"},
  {"lens":"edge-case-hunter","location":"operations:64-70,149-162","trigger_condition":"Unlimited spool consumes terminal-record reserve","guard_snippet":"Enforce min_free_bytes and external failure persistence","potential_consequence":"Disk failure cannot be recorded durably"},
  {"lens":"edge-case-hunter","location":"data-model:337-343","trigger_condition":"Rollover occurs between lookup and create","guard_snippet":"Serialize rollover/write or use identity index","potential_consequence":"Duplicate documents enter separate backing indices"},
  {"lens":"edge-case-hunter","location":"requirements:76-86","trigger_condition":"Fragment coverage exceeds unrecorded tolerance","guard_snippet":"Reject, trim, or split epoch deterministically","potential_consequence":"Duration and overlap drift silently"},
  {"lens":"edge-case-hunter","location":"state-recovery:125-150","trigger_condition":"Event refresh stalls after chunk is visible","guard_snippet":"Bound event deadline and define pressure transition","potential_consequence":"Visible chunks accumulate without notifications"},
  {"lens":"edge-case-hunter","location":"data-model:382-397","trigger_condition":"Explicit deletion overlaps recovery or media response","guard_snippet":"Use a durable deletion state machine","potential_consequence":"Deleted data reappears or playback becomes partial"},
  {"lens":"edge-case-hunter","location":"api:299-313","trigger_condition":"Follow handle expires during active retrieval","guard_snippet":"Pin handle until operation completion then expire atomically","potential_consequence":"Output or cursor commits to a missing handle"}
]
```

## Recommended Next Action

Run a single consistency edit that resolves A-01, A-02, A-03, A-05, and A-12,
then re-run document link/term checks. Before Phase 2 is accepted, close A-06
through A-11 with contract tests or explicit feasibility-spike gates. Do not use
the existing `live-video-planning-review-2026-09-10.md` as the current verdict;
it predates the confirmed decisions and Phase 1 implementation claims.
