# Live Video State and Recovery Contract

Status: **Phase 4 implemented (worker recovery/queues); Phase 5 indexes next**  
Date: **2026-09-11**

This document defines the cross-process transitions and crash boundaries that
the API, worker, spool, and Elasticsearch repositories must implement. It is
normative for the RTSP MVP.

## Source Validation

The web process may read and write only a `connection_ref` name matching
`^LIVE_SOURCE_[A-Z0-9_]+_(URL|CONNECTION)$`. It does not receive the referenced
secret. Source creation and connection changes set `validation_state` to
`pending_validation` and clear previously derived endpoint fields.

The worker polls pending sources, resolves a structured secret, and validates
the destination. The secret shape is:

```ts
interface LiveConnectionSecret {
  url: string; // no URL userinfo
  username?: string;
  password?: string;
  passphrase?: string;
}
```

The selected adapter rejects unsupported fields. On success, the worker stores
only `endpoint_redacted`, `endpoint_fingerprint`, `allowed_host`, and
`allowed_port`, then sets the source to `ready`. On failure, it stores only a
stable sanitized error and sets the source to `invalid`. A source must be
`ready` and enabled before session creation.

An active session snapshots the source revision, reference name, endpoint
fingerprint, protocol, transport, and approved destination. Reconnect resolves
the reference again. If its endpoint fingerprint no longer matches the
snapshot, the session fails with `LIVE_SOURCE_CHANGED`; the operator must create
a new session. A source patch never changes an active session.

## Session Creation

The request supplies an idempotency key. The API derives a deterministic
`session_id` from the source ID and idempotency key, then performs this sequence:

1. Read a ready, enabled source and its Elasticsearch version.
2. Compare-and-set `active_session_id` to the deterministic ID if it is empty or
   already equal to that ID.
3. Create the session document with `op_type=create`, `desired_state=running`,
   `observed_state=created`, and the validated source snapshot.
4. If the session already exists, verify its source and idempotency key before
   treating the request as an idempotent success.
5. If the source claim exists but the session does not, retry step 3. If a
   terminal session still owns the claim, clear it with compare-and-set.

A different active session ID returns `LIVE_SESSION_CONFLICT`. `force_new`
requests stop of that session and returns `LIVE_SESSION_REPLACEMENT_PENDING`
until terminal cleanup clears its claim. No cross-document transaction is
assumed.

## Session Transitions

| From | Trigger | To | Reason code |
| --- | --- | --- | --- |
| `created` | worker accepts desired `running` | `connecting` | `start_requested` |
| `connecting` | first valid media arrives | `live` | `media_received` |
| `connecting` | retryable connection loss | `degraded` | `connection_lost` |
| `live` | connection loss, lag, or pressure | `degraded` | `connection_lost`, `queue_lagging`, or `spool_pressure` |
| `degraded` | media and health remain within recovery thresholds | `live` | `health_recovered` |
| `created`, `connecting`, `live`, `degraded` | desired state becomes `stopped` | `stopping` | `stop_requested` |
| `stopping` | drain finishes or recoverable work is recorded | `stopped` | `drain_complete` or `drain_timeout` |
| any nonterminal state | fatal validation, exhausted retry, unsafe capacity, or corrupt manifest | `failed` | stable error code |

`stopped` and `failed` are immutable terminal states. Starting again creates a
new session. A start request is idempotent only while `desired_state=running`
and observed state is `created`, `connecting`, `live`, or `degraded`. Once stop
is requested, including while `stopping`, start returns `LIVE_SESSION_CONFLICT`.
Disabling a source blocks new sessions but does not stop its active session; the
operator must issue stop explicitly.

Every externally visible worker transition uses the generic event outbox: append
`event_intent` with its type, reconstruction payload, seed fingerprint, and
expected revision; compare-and-set the session `reserved_revision` and state;
append
`event_ready` with the final event and fingerprint; create or verify the event;
then advance `published_revision` and append `event_published`. No later event
for that session can pass an unfinished intent. API responses and cursors expose
only the contiguous `published_revision`; reserved revisions are internal.
Snapshots and heartbeats do not consume a revision.

Normative transition reason codes are `start_requested`, `media_received`,
`connection_lost`, `queue_lagging`, `spool_pressure`, `health_recovered`,
`stop_requested`, `drain_complete`, `drain_timeout`, `retry_exhausted`,
`source_invalid`, `source_changed`, `queue_saturated`, `spool_saturated`,
`manifest_corrupt`, and `manifest_unwritable`. API error codes remain the
uppercase `LIVE_*` catalog and are not transition reasons.

## Manifest Publication

One worker process holds a process-lifetime OS lock on the spool root. One
serialized manifest writer exists per session. Every append is flushed before
the operation it authorizes, and a truncated final line is removed before any
new append. Corruption before the final line fails the session.

Window publication order:

1. Append `window_allocated` with epoch, sequence, and intended chunk ID.
2. Write and flush temporary media files.
3. Atomically rename files and flush the parent directory.
4. Append `window_finalized` with the complete immutable draft and checksums.
5. After proxy generation, thumbnail generation, and successful inference,
   append `window_processed` with the complete immutable chunk draft.
6. Append `window_abandoned` when an allocation cannot be finalized.

Only complete windows are indexed. A stop or epoch boundary with insufficient
coverage appends `window_incomplete`; it is neither a failed nor a dropped
window and is subtracted from expected full-window counts. It is manifest-only;
the worker may emit an aggregate session-state event, but there is no
`window_incomplete` durable event type.

Retries use persisted `index_attempt` records and a configured maximum across
process restarts. `window_failed` means that budget is exhausted and is a
replay-excluding terminal record. Retryable work has no `window_failed` record.

## Searchable Outbox

For each finalized window, one serialized session-event writer performs:

1. Read the current session `reserved_revision` and choose the next revision.
2. Append generic `event_intent` with that expected revision, event type,
   reconstruction payload, and a seed fingerprint over values already known.
3. Compare-and-set `reserved_revision` to the expected value.
4. On conflict, append `intent_abandoned` and retry from step 1.
5. During normal operation, submit the chunk in a bounded bulk create with
   `refresh=wait_for`.
6. Verify each bulk item independently. A 409 succeeds only when the existing
   immutable fingerprint matches. During recovery, first run a term query for
   `chunk_id` across the whole data stream and verify every matching fingerprint;
   create only when no match exists. Repeat the same full-stream lookup for
   `event_id`, because `_id` uniqueness does not span backing indices.
7. Observe visibility and compute `searchable_at`, final stage durations, and
   processing lag. Append `event_ready` with the complete event and fingerprint.
8. Create the event at `{session_id}_{revision}` or verify its event fingerprint.
9. Advance `published_revision` to this contiguous revision, append
   `event_published`, then terminal `index_ack`.

The reserved revision may temporarily be ahead of its event, but the preceding
manifest intent makes the gap recoverable. The externally visible published
revision never advances ahead of the durable event. No later event for that
session is published until the current intent reaches a terminal state.

## Recovery Matrix

| Crash boundary | Durable evidence | Recovery action |
| --- | --- | --- |
| after sequence allocation, before rename | allocation only | delete temporary files; append `window_abandoned`; never reuse sequence |
| after rename, before finalization record | final file plus allocation | validate checksums and append finalization, or quarantine and abandon |
| during final manifest append | truncated last line | truncate to last valid offset, then reconcile files |
| after event intent, before revision CAS | intent; old session revision | append `intent_abandoned` and reserve a new intent |
| after revision CAS, before chunk create | intent; reserved revision | resume chunk create for the same intent |
| after chunk create timeout | intent; uncertain write | query full data stream by `chunk_id`, fingerprint-verify any hit, then create only when absent |
| after visible chunk, before event-ready append | intent; chunk present | establish a recovery-time searchable observation, append complete event, and mark its timing as cross-boot when applicable |
| after event-ready append, before event create | complete event; no event | create or verify the reserved event |
| after event create, before terminal ack | event present; no terminal ack | verify event and append publication plus `index_ack` |
| after terminal ack | complete terminal state | do not replay indexing; retain media until expiry |
| after terminal window failure | exhausted retry record | do not replay; retain evidence until failure retention permits cleanup |
| stopped session with nonterminal work | manifest state | reconcile before polling new desired-running sessions |

Recovery scans every session manifest before accepting new capture. The
manifest, not the lagging session summary, determines epoch and sequence. It
also reconciles source claims whose session document is missing and clears only
claims owned by terminal sessions.

## Backpressure and Retention Races

- Work queue and indexing-ack queue entries use atomic states so a processor
  cannot dequeue a window concurrently selected for dropping.
- At a hard limit, drop only the oldest `queued` and non-processing window after
  its terminal record is durable. A durable drop is the sole exception to replay.
- If no window is droppable or terminal headroom is unavailable, stop capture
  and fail the session.
- Retention excludes unacknowledged, processing, and nonterminal-outbox media.
- Expiry opens the file before unlink races can affect a response, rejects
  symlinks, and verifies the opened file remains under the session spool.
- Manifest compaction writes a verified checkpoint and atomically replaces only
  records whose terminal state is already durable.

## SSE and Follow Cursors

Session SSE validates `Last-Event-ID` as a nonnegative revision no greater than
the current session `published_revision`. It queries durable events after the cursor,
attaches to the live tail, and repeats the durable query before declaring itself
caught up. Event expiry during pagination produces the documented cursor-expired
response rather than a silent gap. Slow clients have a bounded output buffer and
disconnect with the last successfully sent cursor.

Follow mode requires explicit session IDs and a required `variant_id`. It does
not automatically discover later sessions for a source. Before initial
retrieval, it records each selected session's baseline revision. It then runs
the full filtered retrieval, attaches the event tail, and replays every revision
after each baseline; already returned chunk IDs are deduplicated. Each event
triggers a new full filtered top-K retrieval, and each SSE `results` event
replaces the previous result set. Non-searchable revisions advance the cursor
without retrieval. Each handle owns one cursor per session and one cached query
vector; both expire together. A cursor advances after successful event
evaluation. When a searchable event produces no result change, the server emits
a cursor-only checkpoint so the event is not replayed forever. The
single-web-replica MVP avoids cross-process handle loss; horizontal web scaling
requires sticky routing or a shared handle store as an architecture change.

Every live retrieval collapses on `chunk_id` before returning or attributing RRF
results. This is defense in depth against a duplicate logical document across
data-stream backing indices.

## Event Visibility

The web process has no direct worker channel. The worker creates durable events
with `refresh=wait_for`. Session and follow SSE poll `live-video-events` every
`LIVE_EVENT_POLL_MS` using `session_id`, `revision > cursor`, ascending revision,
and a bounded page size. Poll delay affects UI-visible latency but is excluded
from worker-measured close-to-searchable latency, which ends after event
visibility is acknowledged.

## Clock Continuity

Every persisted stage sample contains `worker_boot_id`, monotonic nanoseconds,
and UTC. Durations within one worker boot use monotonic differences. When a
window closes before a restart and becomes searchable afterward, acceptance
uses conservative UTC elapsed time, includes both samples' uncertainty, and
marks the measurement `cross_boot`; monotonic values from different boots are
never subtracted.
