# Adversarial Architecture Review — Live Video Search

Date: **2026-09-10**  
Review type: **independent-implementation compatibility**  
Subject: [`ARCHITECTURE-SPINE.md`](../../../plan/architecture/architecture-live-video-search-2026-09-10/ARCHITECTURE-SPINE.md) and its canonical
companions  
Implementation status: **planning only; no live implementation reviewed**

## Verdict

**NOT IMPLEMENTATION-READY.** The decomposition and high-level invariants are a
good foundation, but the current contract still permits independently built
components to obey every architecture decision and nevertheless disagree about
the durable source snapshot, event/revision model, per-window searchable
metadata, worker fencing, timeline derivation, recovery/drop transitions, and
protocol security behavior.

Resolve findings A-01 through A-07 before Phase 1 contracts are frozen. A-08
through A-10 may be resolved while building the RTSP vertical slice, but must be
closed before its acceptance run. This is a document-readiness verdict, not a
claim about code or runtime behavior.

## Review method

The review treated these as separately implemented units:

1. source/session API and Elasticsearch repositories;
2. worker supervisor and lease claimant;
3. RTSP/HLS/SRT source adapters and FFmpeg process wrapper;
4. fragment writer, window assembler, queue, and manifest reducer;
5. proxy/inference processor and live-chunk indexer;
6. session SSE, follow-search service, and query-vector cache;
7. search response assembler, media server, and retention worker.

For each seam, the test was: can two reasonable implementations satisfy every
stated AD yet produce incompatible state or observable behavior? A finding is
recorded where the answer is yes.

## Findings

### A-01 — Blocker: immutable chunk shape cannot produce its required search response

The live chunk is create-only and deliberately omits `searchable_at`; the data
model says that value lives in a session/event acknowledgment
([data model](../../../docs/live-video-data-model.md#L115-L120)). Its
`processing_lag_ms` is nevertheless placed in the document before the
`refresh=wait_for` response exists
([data model](../../../docs/live-video-data-model.md#L162-L168)). The API then
requires every later hit to contain both `searchable_at` and
`processing_lag_ms`
([API contract](../../../docs/live-video-api-contract.md#L233-L249)), while
AD-13 also requires `indexed` and `searchable` timestamps that are absent from
the chunk schema
([spine](../../../plan/architecture/architecture-live-video-search-2026-09-10/ARCHITECTURE-SPINE.md#L126-L130)).

Conforming divergence:

- the indexer records request-start time as processing completion;
- another records the refresh response time only in the local manifest;
- the search API estimates `searchable_at` from `event_ingested`;
- another attempts a nonexistent event-store join and omits the fields after
  spool expiry.

All can claim AD-7 compliance, but their hit shapes and latency percentiles are
not equivalent.

Required decision: define one durable per-window acknowledgment model. Either
(a) permit one idempotent post-refresh finalization update to the chunk and wait
for that update before emitting `searchable`, or (b) define a durable searchable
event store keyed by `chunk_id` and specify how search joins it. Add canonical
definitions for `index_requested_at`, `indexed_at`, `searchable_at`, and the
precise lag formula. Do not leave required hit fields solely in an expiring local
manifest or an overwritten session summary.

### A-02 — Blocker: resumable SSE and follow search have no durable event contract

The storage inventory contains sources, sessions, chunks, and the local spool,
but no event log ([data model](../../../docs/live-video-data-model.md#L9-L16)).
The session document contains only current aggregate state. The API nonetheless
promises resume from a persisted revision and lists window-level events
([API contract](../../../docs/live-video-api-contract.md#L173-L195)). A single
session revision increments for every externally observable worker mutation,
not only searchable windows
([data model](../../../docs/live-video-data-model.md#L106-L113)), while follow
search is said to rerun on searchable revisions. `max_session_revision` is one
scalar even when the query spans sessions whose revision counters are unrelated.

Conforming divergence:

- one SSE implementation emits only a current snapshot after reconnect;
- another tails JSONL files unavailable to a separately deployed web process;
- a third stores in-memory events and loses them on web restart;
- follow search reruns on every health mutation in one implementation but only
  on chunk creation in another;
- two sessions can both be at revision 42, making a scalar maximum an invalid
  cursor.

Required decision: add a typed durable event record and retention rule, or
explicitly weaken the contract to snapshot-only recovery. For durable events,
define `(session_id, revision)` identity, payload schemas, atomic ordering with
session mutation, replay bounds, and gap behavior. Follow search needs a cursor
map per session or a truly global searchable checkpoint, not
`max_session_revision`. State whether query handles/cache are single-web-process
memory with session affinity or durable shared state, and define web-restart
behavior.

### A-03 — Blocker: a source is neither reconnectable nor immutable for an active session

The source document persists only `endpoint_redacted` and a fingerprint
([data model](../../../docs/live-video-data-model.md#L21-L37)). The API accepts a
connectable endpoint and may strip sensitive query parameters
([API contract](../../../docs/live-video-api-contract.md#L37-L45)). A fingerprint
cannot reconstruct stripped connection material. Separately, PATCH promises
that connection changes do not mutate an active session, but says restart may
create either a session or epoch without choosing one
([API contract](../../../docs/live-video-api-contract.md#L74-L78)). The session
stores only `source_id`, not a source revision or connection snapshot.

Conforming divergence:

- one worker reconnects with the latest patched source;
- another caches the creation-time source in memory and loses it on restart;
- another treats the redacted URL as connectable and fails for tokenized HLS;
- start creates a new session in one API but resumes the old session in another.

Required decision: separate a safe, durable connection descriptor from display
provenance, and define how credential refs materialize protocol-specific secrets.
Snapshot `source_revision`, protocol, transport, endpoint/connection ref,
credential ref, and variant-affecting settings into the session. Reconnect must
use that immutable snapshot while re-resolving DNS and reapplying policy. Choose
one session rule: because the requirements define a session as one start-to-stop
run, the least surprising rule is a new `session_id` for every restart after
`stopped`; reserve epochs for discontinuities inside that run.

### A-04 — Blocker: a timestamp lease does not fence media and index side effects

The session has `worker_id` and `worker_lease_until`, and Phase 4 asks workers to
claim and renew it, but the spine defers multi-host leasing as a later update
([spine](../../../plan/architecture/architecture-live-video-search-2026-09-10/ARCHITECTURE-SPINE.md#L186-L193)). Optimistic concurrency protects a
session-document update; it does not stop an old worker whose lease expired from
continuing to append JSONL, write clips, allocate sequence numbers, or send
provider/index requests. Deterministic IDs prevent duplicate documents, but do
not prevent two encoders from corrupting the same spool or emitting inconsistent
events and counters.

Required decision: either enforce exactly one configured worker process and
remove leasing from the MVP contract, or define a real claim protocol with a
monotonic fencing generation. Claim/renew/release preconditions, lease duration,
clock-skew assumption, loss-of-lease shutdown deadline, and stale-owner rejection
must be explicit. Epoch creation and sequence allocation must be durably owned by
the fenced generation before capture starts; every state/event/manifest write
must carry it. Add a split-brain fixture, not only a clean worker-restart fixture.

### A-05 — High: epoch and sequence allocation are not crash deterministic

AD-4 defines the identity tuple but not initial epoch/sequence values, the
durable allocation point, or behavior on worker restart
([spine](../../../plan/architecture/architecture-live-video-search-2026-09-10/ARCHITECTURE-SPINE.md#L72-L76)). `last_sequence_no` is unscoped even
though sequence is only monotonic within an epoch. The disconnect flow increments
the epoch only after media resumes
([data flow](../../../docs/live-video-data-flow.md#L67-L78)); a crash may occur
after a finalized window manifest entry but before the session counter update.

Conforming divergence:

- implementations begin epoch/sequence at 0 or 1;
- one resets sequence on each epoch while another continues globally;
- one resumes the same epoch after worker restart while another always opens a
  new epoch;
- a recovered worker trusts the stale session summary while another reduces the
  manifest, producing different next IDs.

Required decision: specify an `epoch_started` manifest record and a single
source of truth for `next_sequence_no`. Define initial values, whether worker
restart always opens a new epoch, recovery precedence between manifest and
session summary, and the crash points around allocate/finalize/publish. Prefer
storing `last_sequence_no` with its epoch or naming it
`last_sequence_no_in_current_epoch`.

### A-06 — High: event-time and processing-time calculations are not reproducible

The only timeline rule is “best available UTC event-time derived from source
timestamps and session wall clock”
([data flow](../../../docs/live-video-data-flow.md#L90-L102)). RTSP PTS is often
relative; arrival time, RTP/RTCP time, sender wall clock, and worker wall clock
can disagree or jump. The requirements define close-to-searchable as
`searchable_at - window_end_at` and say this excludes capture duration
([requirements](../../../requirements/02-live-video-search-requirements.md#L13-L24)),
but the value can include an unknown network/source-clock offset. Keyframe-aligned
“2-second” fragments can also vary in duration, making “four fragments” and an
8-second time window different rules.

Required decision: define a timeline policy and quality marker. At minimum,
persist epoch PTS origin, UTC anchor, anchor source (`rtcp_ntp`, source absolute,
or arrival-anchored), clock-discontinuity tolerance, and actual fragment/window
durations. Use monotonic worker timestamps for stage durations. Separate
`window_closed_at - window_end_at` capture lag from
`searchable_at - window_closed_at` processing lag; if the product retains the
current combined formula, name and budget it accordingly. Define whether the
assembler uses fragment count or PTS intervals when durations exceed tolerance.

### A-07 — High: the recovery manifest is too small to be authoritative

The example `window_finalized` record has only chunk ID, sequence, clip ref,
checksum, and window end time
([data model](../../../docs/live-video-data-model.md#L205-L218)). It lacks the
fields needed to reconstruct the strict chunk document: source/session/variant,
epoch, start time/PTS, duration, discontinuity, proxy inputs, media refs, and
provider identity. There is no fragment record schema, schema version, checksum
coverage, atomic finalize convention, or retry/error/drop union. The stop flow
also leaves work recoverable after marking the session stopped
([data flow](../../../docs/live-video-data-flow.md#L81-L88)) without saying which
worker processes that backlog while desired state remains stopped.

Conforming divergence:

- one recovery process re-runs proxies using current provider/config;
- another cannot reconstruct the document and marks the window failed;
- a third processes stopped-session backlog immediately, while another waits for
  a future start;
- partial files may appear finalized depending on rename and fsync behavior.

Required decision: publish a versioned discriminated-union manifest schema for
epoch, fragment, window, attempt, acknowledgment, failure, drop, expiry, and
recovery records. A finalized-window record must be sufficient to reproduce the
same model input and immutable document independent of current configuration.
Define atomic file publication, checksum target, reducer precedence, bounded
retry state, corrupt/truncated-line handling, and stopped-session backlog policy.

### A-08 — High: drop policy conflicts with the recovery and retention guarantees

AD-6 says finalized media remains until indexing acknowledgment; AD-12 allows a
configured drop at finite queue/spool limits
([spine](../../../plan/architecture/architecture-live-video-search-2026-09-10/ARCHITECTURE-SPINE.md#L84-L88),
[spine](../../../plan/architecture/architecture-live-video-search-2026-09-10/ARCHITECTURE-SPINE.md#L120-L124)). Operations combines queue and
spool hard limits and drops the “oldest non-processing window”
([operations](../../../docs/live-video-operations.md#L90-L100)). The spool also
contains acknowledged clips retained for 24 hours, so it may be full even after
all pending windows are dropped. “Oldest” is not defined, and no reserved space
exists to durably write the terminal drop record when already at the byte limit.

Required decision: define separate quotas for recoverable inputs, queued work,
and retained playback media. Publish the window state machine and exact eviction
order/tie-break. State explicitly that a durable terminal `window_dropped`
record is the sole exception to “retain until acknowledgment,” and reserve
manifest headroom. Define what frees bytes, how early clip eviction is reported,
and whether queue saturation drops the incoming window or the oldest queued
window. Reconcile `LIVE_QUEUE_SATURATED` as an internal event versus an HTTP 503.

### A-09 — High: partial-modality completion has no canonical outcome

The contract says absent audio omits `embedding_audio`, but does not decide what
happens when audio is present and its proxy or inference fails after video
succeeds ([requirements](../../../requirements/02-live-video-search-requirements.md#L73-L88)).
The implementation plan explicitly expects a partial-modality failure case, yet
the chunk schema has no modality status/error provenance.

Conforming divergence:

- one processor indexes a video-only searchable hit;
- another fails and retries the whole window;
- another indexes partial results and later tries to mutate the create-only
  document;
- `modality=both` either means intersection, union/RRF with available vectors,
  or a requirement that both vectors exist.

Required decision: choose the completion matrix for video proxy/embed, audio
absent, audio proxy/embed failure, and thumbnail failure. If degraded indexing
is allowed, persist `modalities_present`, `modalities_indexed`, per-modality
status, and failure code, then define `modality=both` and ranking behavior. If
both embeddings are atomic for media that contains audio, say so and treat a
partial success as a retryable/failed window with no document.

### A-10 — High: the adapter interface cannot enforce the protocol boundary it promises

AD-2 says credentials, retries, and timestamp behavior terminate at the adapter,
but `LiveSourceAdapter` exposes only validate, argument building, and exit
classification
([architecture](../../../docs/live-video-architecture.md#L81-L96)). It has no
contract for emitted fragment metadata/discontinuities, redirect decisions,
credential injection, reconnect state, nested protocol allowlists, or timebase.
HLS redirect revalidation cannot be guaranteed if redirects remain internal to
FFmpeg, and SRT listener mode has no pre-connection remote destination to check
under AD-11. `LIVE_ALLOWED_PROTOCOLS=hls` also names a media format while the URL
and FFmpeg nested protocols are HTTP/HTTPS/TCP/TLS.

Required decision: make the adapter output and security policy typed, including
canonical connect descriptor, allowed outer scheme and nested FFmpeg protocols,
credential materialization/redaction, connection attempt identity, normalized
fragment metadata, and discontinuity reasons. For HLS, choose a controlled
playlist/segment fetch path that can validate every redirect, or explicitly
disallow redirects. For SRT listener, define peer admission and how its push
semantics map to source/session control. If these require different contracts,
record Phase 9 as an architecture extension rather than asserting that it cannot
change the pipeline contract.

## Additional inconsistencies to reconcile

- A “session” is defined as one start-to-stop run, but the API allows a stopped
  session to resume. This must be resolved together with A-03.
- The API creates a session with `revision: 1`, while AD-5 says only the worker
  mutates revision. Define whether revision 1 is creation metadata, a command
  revision, or a worker-event revision.
- The state-machine requirement says every transition records timestamp and
  reason, but the session schema stores only selected timestamps and one current
  error. Historical transitions need the event model from A-02.
- `start_offset_ms` and `end_offset_ms` are described in the data flow but are
  absent from the live chunk schema. Add them or remove the promise.
- `media.clip_expires_at` covers only the clip although requirements ask for
  independently confirmable clip and thumbnail retention. Define distinct
  expiry or explicitly couple them.
- At a steady 600-second fixture, full 8-second windows advancing every 6
  seconds produce `floor((600 - 8) / 6) + 1 = 99` windows, not an exact 100,
  before start-up alignment or faults. Define expected-count calculation and
  epoch-tail policy in the acceptance runner.
- The requirements contain “recovers every acknowledged-spool gap”; recovery
  elsewhere consistently refers to **unacknowledged** finalized windows. Correct
  the acceptance wording before it becomes a test oracle.

## Minimum amendments before implementation

1. Add canonical TypeScript schemas for source snapshot, session command/runtime
   state, event records, fragments, windows, manifest records, searchable
   acknowledgment, and API DTOs; state which package owns each schema.
2. Add a sequence/crash table covering source create/patch, session create/start/
   stop, claim/fence, epoch start, fragment/window finalize, enqueue, drop,
   inference, index, refresh, acknowledgment, event publication, retention, and
   recovery.
3. Choose a durable event and searchable-metadata design that makes SSE replay,
   follow-search cursors, hit DTOs, and latency evidence derive from the same
   records.
4. Define the clock/epoch/sequence algorithms and make manifest reduction the
   deterministic recovery oracle.
5. Split queue, recoverable-spool, and retained-media capacity policies, then
   specify the state transitions and terminal records.
6. Freeze RTSP credential materialization, FFmpeg protocol whitelist, adapter
   event shape, and reconnect/discontinuity behavior before Phase 2.

Once these amendments are made, repeat the same independent-unit test: an API,
worker, adapter, indexer, SSE service, search service, and media server should be
implementable from the contracts without sharing undocumented assumptions.
