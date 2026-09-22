# Live Video Data Model

Status: **design contract; mappings not yet applied**

Live data is isolated from the existing `video-assets` and `video-chunks`
indices. File assets are finite and mutable by variant; live windows are
append-only time events with independent retention.

## Storage objects

| Name | Type | Identity | Owner |
| --- | --- | --- | --- |
| `live-video-sources` | index | `source_id` | API metadata; worker validation fields |
| `live-video-sessions` | index | `session_id` | API desired state; worker observed state |
| `live-video-workers` | index | fixed `_id=singleton` | live worker heartbeat/capabilities |
| `live-video-chunks` | data stream | `{session_id}_{stream_epoch}_{sequence_no}` | live worker, create-only |
| `live-video-events` | data stream | `{session_id}_{revision}` | live worker, create-only replay log |
| local live spool | files + JSONL manifest | same window identity | live worker |

The index names are defaults exposed through configuration. Mapping setup must
be idempotent and must not alter existing file-video mappings.

## Worker document

The one-worker MVP publishes a heartbeat so the API can reject commands that no
worker can accept. This document is diagnostics, not a distributed lease.

```ts
interface LiveWorkerDocument {
  worker_id: string; // generated per worker process; not the document ID
  started_at: string;
  heartbeat_at: string;
  spool_lock_held: boolean;
  version: string;
  image_digest: string;
  capabilities_hash: string;
}
```

`POST /api/live/sessions` requires a heartbeat no older than
`LIVE_WORKER_STALE_MS`. Loss of a heartbeat does not let the API rewrite a
session's observed state; status reports worker availability separately.

## Source document

```ts
interface LiveSourceDocument {
  source_id: string;
  name: string;
  protocol: 'rtsp' | 'hls' | 'srt';
  source_revision: number;
  connection_ref: string;
  transport?: 'tcp' | 'udp' | 'caller' | 'listener';
  enabled: boolean;
  validation_state: 'pending_validation' | 'ready' | 'invalid';
  endpoint_redacted?: string;
  endpoint_fingerprint?: string;
  allowed_host?: string;
  allowed_port?: number;
  validation_error?: { code: string; message: string; at: string } | null;
  active_session_id?: string;
  created_at: string;
  updated_at: string;
}
```

Forbidden fields include raw passwords, tokens, passphrases, URL userinfo,
signed query strings, and locally resolved secret material.

## Session document

```ts
type LiveDesiredState = 'running' | 'stopped';
type LiveObservedState =
  | 'created'
  | 'connecting'
  | 'live'
  | 'degraded'
  | 'stopping'
  | 'stopped'
  | 'failed';

interface LiveSessionDocument {
  session_id: string;
  source_id: string;
  idempotency_key: string;
  desired_state: LiveDesiredState;
  observed_state: LiveObservedState;
  reserved_revision: number;
  published_revision: number;
  worker_id?: string;
  stream_epoch: number;
  last_sequence_no_in_current_epoch: number;
  source_snapshot: {
    source_revision: number;
    protocol: 'rtsp' | 'hls' | 'srt';
    transport?: 'tcp' | 'udp' | 'caller' | 'listener';
    connection_ref: string;
    endpoint_fingerprint: string;
    allowed_host: string;
    allowed_port: number;
  };
  variant_id: string;
  retention: {
    /** Product decision 2026-09-10: keep until explicit delete (no 24h/7d auto-expiry). */
    mode: 'until_explicit_delete';
  };
  window: {
    fragment_ms: number;
    window_ms: number;
    overlap_ms: number;
  };
  embedding: {
    provider: string;
    model: string;
    task: string;
    dims: 1024;
    normalized_by: string;
  };
  timestamps: {
    created_at: string;
    command_requested_at: string;
    connect_started_at?: string;
    live_at?: string;
    last_media_at?: string;
    last_searchable_at?: string;
    stopped_at?: string;
    updated_at: string;
  };
  health: {
    capture_lag_ms?: number;
    processing_lag_ms?: number;
    queue_depth: number;
    queue_high_water: number;
    indexing_batches_in_flight: number;
    spool_bytes: number;
    reconnect_count: number;
    windows_searchable: number;
    windows_failed: number;
    windows_dropped: number;
  };
  current_error?: {
    code: string;
    message: string;
    at: string;
  } | null;
}
```

Mutation rules:

- API updates source name, connection-reference name, transport, enabled state,
  and revision. The worker alone updates source validation state and derived safe
  provenance. A connection-field change atomically clears the derived fields.
- API updates only `desired_state` and operator-controlled settings.
- Worker updates only observed state, revision, epoch, counters, health,
  runtime timestamps, and runtime error.
- Updates use optimistic concurrency (`if_seq_no` and `if_primary_term`) and
  retry a bounded number of read/merge/write conflicts.
- `reserved_revision` increments when the worker claims an event intent.
  `published_revision` advances only after that event is durable and contiguous;
  API cursors expose `published_revision` as `revision`.
- At most one nonterminal session exists per source. The API first compare-and-
  sets a deterministic session ID derived from the source and idempotency key
  into `active_session_id`, then create-indexes the session. Retries reconcile a
  claim whose session document is missing. Terminal-session cleanup clears only
  a matching claim. Source settings are snapshotted per run.
- The MVP worker holds an exclusive spool-root process lock. Session leases do
  not appear until a real multi-host fencing design is introduced.

## Durable event document

The event data stream is the cross-process replay source for session SSE and
follow search. Events are ordered only within a session by `revision`; clients
tracking multiple sessions carry a revision map.

```ts
interface LiveEventDocument {
  '@timestamp': string;
  event_id: string; // session_id + '_' + revision
  session_id: string;
  source_id: string;
  revision: number;
  type:
    | 'session_state'
    | 'window_ready'
    | 'window_failed'
    | 'window_dropped'
    | 'searchable'
    | 'recovery_gap'
    | 'error';
  chunk_id?: string;
  manifest_record_id?: string;
  event_fingerprint: string;
  searchable_at?: string;
  processing_lag_ms?: number;
  index_duration_ms?: number;
  payload: Record<string, unknown>; // stored with enabled:false
}
```

Before any externally visible worker mutation, the writer appends a generic
`event_intent` and then reserves its revision with an optimistic session update.
For a searchable event, it then create-indexes the chunk, waits for visibility,
persists the complete event with final timing, create-indexes that deterministic
event, and appends terminal `index_ack`. Recovery rebuilds any missing event
from the intent and subsequent records and verifies existing chunks/events by
fingerprint. A revision gap is never silently skipped: recovery reconstructs
the event when possible or emits `recovery_gap` and a current snapshot.
With indefinite retention there is no age-based cursor expiry; future timed
retention would restore `410 LIVE_EVENT_CURSOR_EXPIRED` when a cursor falls
outside the retained window. The mapping stores `payload` with `enabled: false`;
fields needed for filtering stay at the event root.

## Live chunk document

`@timestamp` is `window_end_at`, the receive-anchored event-time of the latest
media included in the window. `event_ingested` is when the worker first sends
the document to Elasticsearch. `searchable_at` and final processing lag live in
the matching durable `searchable` event because a create document cannot update
itself after it becomes searchable.

```ts
interface LiveChunkDocument {
  '@timestamp': string;
  event_ingested: string;
  chunk_id: string;
  source_id: string;
  session_id: string;
  stream_epoch: number;
  sequence_no: number;
  variant_id: string;
  window_start_at: string;
  window_end_at: string;
  start_pts_ms: number;
  end_pts_ms: number;
  start_offset_ms: number;
  end_offset_ms: number;
  duration_ms: number;
  clock: {
    mode: 'receive_anchor';
    epoch_pts_origin_ms: number;
    epoch_anchor_utc: string;
    uncertainty_ms: number;
  };
  discontinuity_before: boolean;
  media_sha256: string;
  immutable_fingerprint: string;
  schema_version: number;
  embedding_video: number[];
  embedding_audio?: number[];
  provider: string;
  model: string;
  task: string;
  normalized_by: string;
  video_proxy: {
    bytes: number;
    width: number;
    height: number;
    frames: number;
    crf: number;
    strategy: string;
  };
  audio_proxy?: {
    bytes: number;
    bitrate: string;
    codec: string;
  };
  media: {
    clip_ref: string;
    thumb_ref: string;
    /** null = retained until explicit delete (no age-based expiry). */
    clip_expires_at: string | null;
    thumb_expires_at: string | null;
  };
  processing: {
    window_ready_at: string;
    inference_started_at: string;
    inference_finished_at: string;
    index_requested_at: string;
    worker_boot_id: string;
    attempt: number;
    queue_wait_ms: number;
    proxy_duration_ms: number;
    inference_duration_ms: number;
    stage_clock: {
      window_closed: StageClockSample;
      inference_started: StageClockSample;
      inference_finished: StageClockSample;
      index_requested: StageClockSample;
    };
  };
}

interface StageClockSample {
  worker_boot_id: string;
  monotonic_ns: number;
  utc: string;
  uncertainty_ms: number;
}
```

The API translates opaque `clip_ref` and `thumb_ref` values into media routes.
Absolute paths are never returned or indexed.

## Mapping rules

- All five mappings use `dynamic: strict`.
- Identifiers, state, protocol, provider, model, task, codecs, and opaque refs
  are `keyword`.
- All timestamps are `date`.
- PTS, durations, lag, byte counts, counters, epoch, sequence, and revision are
  numeric (`long` unless a smaller bound is proven).
- `embedding_video` and `embedding_audio` match the existing 1024-dimensional
  cosine `bbq_hnsw` mapping and normalization contract.
- Human-readable errors are `text` with `index: false`.
- No raw media or base64 data is stored in `_source`.

## Data stream template

The implementation creates a composable template whose `index_patterns`
contains only the configured `ES_DATA_STREAM_LIVE_CHUNKS` name, with no broad
wildcard, plus:

- `data_stream: {}`;
- the strict live chunk mapping;
- Data Stream Lifecycle **without** `data_retention` (indefinite retention /
  forever until explicit delete — product decision 2026-09-10; overrides the
  earlier assumed `7d`/`8d` defaults);
- `_meta` containing schema version and owner;
- no ILM configuration on Elastic Serverless.

A separate template matching only the configured
`ES_DATA_STREAM_LIVE_EVENTS` name uses the strict event mapping and the same
indefinite DSL policy (`LIVE_EVENT_RETENTION=forever`).

Writes use `op_type=create` and the deterministic `_id`. Because `_id`
uniqueness does not span data-stream backing indices, recovery first queries the
entire stream by `chunk_id` or `event_id`. A matching hit is acknowledged only
after its immutable or event fingerprint matches; a mismatch fails recovery.
When no hit exists, create proceeds, and an HTTP 409 receives the same
fingerprint check. Live retrieval collapses by `chunk_id` before RRF attribution
so a rare rollover race cannot surface duplicate logical hits.

## Spool manifest

One versioned append-only JSONL manifest exists per session. Sequence is
allocated by a manifest record before file publication. Files are written to a
temporary name, flushed, and atomically renamed before a publication record is
appended. A reserved amount of spool capacity is available only to terminal
manifest records. Entries are never edited in place:

```json
{"schema_version":1,"type":"epoch_started","record_id":"...","stream_epoch":1,"clock":{"mode":"receive_anchor","pts_origin_ms":0,"anchor_utc":"..."},"media_signature":"..."}
{"schema_version":1,"type":"window_allocated","record_id":"...","chunk_id":"..._1_19","stream_epoch":1,"sequence_no":19}
{"schema_version":1,"type":"window_finalized","record_id":"...","chunk_id":"..._1_19","source_id":"...","session_id":"...","stream_epoch":1,"sequence_no":19,"variant_id":"...","clip_ref":"...","media_sha256":"sha256:...","window_start_at":"...","window_end_at":"...","start_pts_ms":0,"end_pts_ms":8000,"window_closed":{"worker_boot_id":"...","monotonic_ns":123,"utc":"...","uncertainty_ms":20},"media_signature":"..."}
{"schema_version":1,"type":"window_processed","record_id":"...","chunk_id":"..._1_19","immutable_fingerprint":"sha256:...","chunk_draft":{"...":"complete immutable document"}}
{"type":"index_attempt","chunk_id":"..._1_19","attempt":1,"at":"..."}
{"type":"event_intent","chunk_id":"..._1_19","revision":42,"event_id":"..._42","event_type":"searchable","seed_fingerprint":"sha256:...","at":"..."}
{"type":"event_ready","chunk_id":"..._1_19","revision":42,"event_id":"..._42","event_fingerprint":"sha256:...","event":{"...":"complete event document"}}
{"type":"event_published","chunk_id":"..._1_19","revision":42,"at":"..."}
{"type":"index_ack","chunk_id":"..._1_19","result":"created","at":"..."}
```

The discriminated union also defines `fragment_finalized`, `window_abandoned`,
`window_incomplete`, `window_failed`, `window_dropped`, `intent_abandoned`,
`event_published`, `media_expired`, and `recovery_event` records. Each terminal
record includes reason, timestamp, and prior record ID. Recovery ignores only a
truncated final JSONL line; corruption before the final line fails the session.
`window_finalized` records the immutable source media and timing needed to retry
processing. After proxy, thumbnail, and inference work completes,
`window_processed` freezes the complete `LiveChunkDraft`, provider/proxy
settings, and both media checksums. The JSON above is only a shortened example.
It reduces the manifest by `chunk_id`: a finalized window without verified
`index_ack` is eligible for replay even if the session is stopped, unless a
durable `window_dropped` terminal record exists. An event intent without a
published event is always reconciled, even when its chunk already exists. The
manifest is authoritative over the lagging session summary for epoch/sequence
recovery. Startup also reconciles allocated sequences and published files that
were interrupted before their next manifest record.

## Retention boundaries

**Confirmed 2026-09-10 (overrides prior 7d / 8d / 24h assumptions):**

- Elasticsearch vector metadata and durable events: DSL enabled for stream
  management, **no `data_retention` / no age-based delete**. Data remains until
  explicit delete (or future admin delete APIs).
- Local clip and thumbnail media: retained until explicit delete; optional
  spool byte caps may be unset (unlimited retained growth). Soft free-space
  floor (`LIVE_SPOOL_MIN_FREE_BYTES`, default 50 GiB) pauses capture under disk
  pressure; it does not auto-delete. Ops age-delete + protect/keep ranges (A-20)
  reclaim via `POST /api/live/ops/age-delete` and `/api/live/ops/protect-ranges`
  (absolute UTC; keyed by chunk `window_end_at` / event `@timestamp`). Forever
  retention remains the default; no silent DSL expiry.
- Session control documents: retained for operational history; future policy is
  an operator decision.
- Source definitions: retained until explicitly archived/disabled; no automatic
  deletion in the MVP.
- Protect-range control documents (`live-video-protect-ranges`): retained until
  explicitly deleted by ops.

Age-based `410 LIVE_MEDIA_EXPIRED` applies only if timed local retention is
reintroduced later; MVP media routes do not auto-expire by wall clock.
