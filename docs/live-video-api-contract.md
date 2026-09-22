# Live Video API Contract

Status: **Phase 6 implemented (control APIs + session SSE)**  
Base path: **`/api/live`**

All errors use:

```json
{
  "error": {
    "code": "LIVE_SOURCE_FORBIDDEN",
    "message": "Source destination is not allowed"
  }
}
```

Messages are sanitized. They never echo credentials, signed query parameters,
resolved private addresses, or absolute spool paths.

## Sources

### `POST /api/live/sources`

Register a reusable source definition.

```json
{
  "name": "Lobby camera",
  "protocol": "rtsp",
  "connection_ref": "LIVE_SOURCE_LOBBY_CAMERA_URL",
  "transport": "tcp",
  "enabled": true
}
```

Rules:

- `protocol`: `rtsp` by default. `hls`, `srt`, and `whip` are accepted only when
  present in `LIVE_ALLOWED_PROTOCOLS` (fail closed otherwise).
- RTSP / WHIP subscribe require `transport: "tcp"`. SRT uses `caller` or
  `listener` (listener also needs `LIVE_SRT_PEER_ALLOWLIST`).
- `connection_ref` names an environment/deployment-secret entry holding a
  structured connection secret. The API validates only the reference name and
  never receives or resolves the secret value.
- New sources enter `pending_validation`. The worker resolves the reference,
  validates every destination address, and writes only safe display provenance.
- Discover enabled protocols via `GET /api/live/protocols` (UI uses this to
  unlock the protocol select without changing the RTSP-only default UX).

Response `201`:

```json
{
  "source": {
    "source_id": "f25b1bb7-6ee8-4d71-b86c-1de8d851ca96",
    "name": "Lobby camera",
    "protocol": "rtsp",
    "source_revision": 1,
    "connection_ref": "LIVE_SOURCE_LOBBY_CAMERA_URL",
    "transport": "tcp",
    "enabled": true,
    "validation_state": "pending_validation",
    "created_at": "2026-09-10T04:00:00.000Z",
    "updated_at": "2026-09-10T04:00:00.000Z"
  }
}
```

### `GET /api/live/sources`

Returns source summaries and the latest session state. It never resolves or
returns credential values.

### `GET /api/live/sources/{sourceId}`

Returns one sanitized source and latest session summary. Once worker validation
finishes, the source includes either safe endpoint provenance in `ready` or a
sanitized `validation_error` in `invalid`.

### `PATCH /api/live/sources/{sourceId}`

Updates name, connection reference, transport, or enabled state and increments
`source_revision`. Changing connection fields resets validation to
`pending_validation` and never mutates an active session. Disabling a source
blocks future sessions but does not implicitly stop an active session.
A later run always receives a new session ID; epochs are only discontinuities
inside one start-to-stop run.

### `DELETE /api/live/sources/{sourceId}`

Removes the source control document from the registry. Response `200`:

```json
{ "deleted": true, "source_id": "f25b1bb7-6ee8-4d71-b86c-1de8d851ca96" }
```

If an active non-terminal session still holds the source claim, the API returns
`409 LIVE_SESSION_CONFLICT` — stop the session first. Stale claims (missing or
terminal sessions) are cleared, then the source is deleted. This does **not**
cascade-delete indexed windows, events, or spool media; use ops age-delete for
retention reclaim.

## Sessions

### `POST /api/live/sessions`

Create and request start of a session.

```json
{
  "source_id": "f25b1bb7-6ee8-4d71-b86c-1de8d851ca96",
  "idempotency_key": "start-lobby-20260910T0401",
  "window": {
    "fragment_ms": 2000,
    "window_ms": 8000,
    "overlap_ms": 2000
  },
  "retention": {
    "mode": "until_explicit_delete"
  }
}
```

Response `202`:

```json
{
  "session": {
    "session_id": "e113e701-85de-4ab4-aabd-24780d83ab79",
    "source_id": "f25b1bb7-6ee8-4d71-b86c-1de8d851ca96",
    "desired_state": "running",
    "observed_state": "created",
    "revision": 0,
    "variant_id": "4ce9b3215d882ffe",
    "created_at": "2026-09-10T04:01:00.000Z"
  },
  "links": {
    "self": "/api/live/sessions/e113e701-85de-4ab4-aabd-24780d83ab79",
    "events": "/api/live/sessions/e113e701-85de-4ab4-aabd-24780d83ab79/events"
  }
}
```

Validation:

- all durations are positive integers;
- fragment divides both window and step (`window_ms - overlap_ms`);
- `0 <= overlap_ms < window_ms`;
- variant identity hashes windowing, provider, model, task, dimensions, proxy
  settings, and schema version;
- disabled or not-yet-ready source returns its stable source-state error;
- source protocol, revision, connection reference, destination policy, variant,
  media settings, and validated retention are copied into an immutable session
  snapshot. Retention is `until_explicit_delete` (no age-based clip/thumbnail
  expiry in the RTSP MVP);
- `idempotency_key` is required, bounded, and scoped to one source;
- at most one nonterminal session exists per source. A source compare-and-set
  claim serializes concurrent creates, and the idempotency key deterministically
  identifies retries. `force_new=true` requests stop/drain and returns `409
  LIVE_SESSION_REPLACEMENT_PENDING` until the prior run is terminal.
- a missing or stale singleton-worker heartbeat returns `503
  LIVE_WORKER_UNAVAILABLE` before the source claim is changed.

### `POST /api/live/sessions/{sessionId}/start`

Sessions are created with `desired_state=running`; this endpoint is idempotent
only while desired state is already `running` and observed state is `created`,
`connecting`, `live`, or `degraded`. Once stop is requested, including while
`stopping`, it returns `409 LIVE_SESSION_CONFLICT`. A stopped or failed session
is immutable history; create a new session to restart.

### `POST /api/live/sessions/{sessionId}/stop`

```json
{ "drain_timeout_ms": 30000 }
```

Sets `desired_state=stopped` and returns `202`. Completion is observed through
status or SSE. Omitting `drain_timeout_ms` uses
`LIVE_STOP_DRAIN_TIMEOUT_MS`; a request may reduce but not increase that limit.
The API does not kill FFmpeg directly.

### `GET /api/live/sessions/{sessionId}`

```json
{
  "session_id": "e113e701-85de-4ab4-aabd-24780d83ab79",
  "source_id": "f25b1bb7-6ee8-4d71-b86c-1de8d851ca96",
  "desired_state": "running",
  "observed_state": "live",
  "revision": 42,
  "stream_epoch": 1,
  "last_sequence_no_in_current_epoch": 19,
  "last_media_at": "2026-09-10T04:03:01.000Z",
  "last_searchable_at": "2026-09-10T04:03:05.100Z",
  "capture_lag_ms": 250,
  "processing_lag_ms": 4100,
  "queue_depth": 0,
  "spool_bytes": 1944020,
  "windows": {
    "searchable": 20,
    "failed": 0,
    "dropped": 0
  },
  "reconnect_count": 1,
  "current_error": null,
  "worker_available": true,
  "updated_at": "2026-09-10T04:03:05.100Z"
}
```

The public `revision` field is the highest contiguous durable event revision.
The worker's reserved revision is internal and is never used as an SSE or
follow-search cursor.

### `GET /api/live/sessions/{sessionId}/events`

SSE response. `Last-Event-ID` is the numeric per-session published revision. The server
replays later records from `live-video-events`; it does not use process-local
history. An expired cursor returns `410 LIVE_EVENT_CURSOR_EXPIRED` with the
latest snapshot revision so the client can reconnect from current state. A
detected revision gap emits `recovery_gap` followed by `snapshot`.
Malformed, negative, or future cursors return `400 LIVE_EVENT_CURSOR_INVALID`.
Snapshots and heartbeats do not advance the durable revision. Replay catches up
again after attaching to the live tail so events between those operations are
not lost; a bounded slow-client buffer closes with the last sent cursor.

Event names:

- `snapshot`
- `session_state`
- `window_ready`
- `window_failed`
- `window_dropped`
- `searchable`
- `recovery_gap`
- `heartbeat`
- `error`

Envelope:

```text
id: 42
event: searchable
data: {"session_id":"...","revision":42,"ts":"...","payload":{"chunk_id":"...","sequence_no":19,"searchable_at":"...","processing_lag_ms":4100}}
```

## Search

### `POST /api/live/search`

Text search:

```json
{
  "query": "a person enters carrying a red bag",
  "source_ids": ["f25b1bb7-6ee8-4d71-b86c-1de8d851ca96"],
  "session_ids": ["e113e701-85de-4ab4-aabd-24780d83ab79"],
  "from": "2026-09-10T03:55:00.000Z",
  "to": "2026-09-10T04:05:00.000Z",
  "variant_id": "4ce9b3215d882ffe",
  "modality": "both",
  "sort_by": "rrf",
  "size": 20,
  "follow": true
}
```

Image search uses multipart `file` or JSON `image_base64` with the same live
filters at `POST /api/live/search/image`.

Validation requires `variant_id`. `follow=true` also requires at least one
`session_id`. `from` must precede `to`, the interval is bounded by configuration,
and decoded image size and media type are validated before checksum or inference.

Response metadata adds:

```json
{
  "query_id": "69d75819-09ee-4cc0-9cb4-f15f6d747b5b",
  "query_vector_cache": "miss",
  "follow_expires_at": "2026-09-10T04:10:00.000Z",
  "session_cursors": {
    "e113e701-85de-4ab4-aabd-24780d83ab79": 42
  },
  "hits": []
}
```

For follow mode, the server captures `session_cursors` before the initial full
retrieval, creates the handle with those baselines, attaches each event tail,
and replays all later revisions. It deduplicates chunk IDs already present in
the initial response before reporting the handle as caught up.

Every hit includes existing score/rank/modality fields plus:

```json
{
  "chunk_id": "e113e701-85de-4ab4-aabd-24780d83ab79_1_19",
  "source_id": "f25b1bb7-6ee8-4d71-b86c-1de8d851ca96",
  "session_id": "e113e701-85de-4ab4-aabd-24780d83ab79",
  "stream_epoch": 1,
  "sequence_no": 19,
  "window_start_at": "2026-09-10T04:02:53.000Z",
  "window_end_at": "2026-09-10T04:03:01.000Z",
  "event_ingested": "2026-09-10T04:03:04.100Z",
  "thumb_url": "/api/live/chunks/.../thumb",
  "clip_url": "/api/live/chunks/.../media"
}
```

The immutable hit does not claim `searchable_at`. Active session SSE and the
durable event endpoint expose that per-window acknowledgment and
`processing_lag_ms`; offline acceptance joins by `chunk_id` when producing the
run manifest.

### `GET /api/live/search/{queryId}/events`

SSE follow-search endpoint. `follow=true` requires a nonempty `session_ids`
array; source-only queries are point-in-time until source-level discovery is
designed. The handle maintains one cursor per selected session and consumes
every revision in order. Non-searchable events advance the cursor without
retrieval. A durable `searchable` event uses the cached query vector and advances
the cursor only after evaluation succeeds. An event that does not change the
result set emits a cursor-only checkpoint. Each results event replaces the
complete top-K set rather than appending partial ranks. Concurrent events coalesce to the highest
pending revision and replay from the committed cursor. Handles and vectors
expire together. They are process-local and bounded, and the MVP runs one web
replica. Web restart or TTL expiry returns `410 LIVE_QUERY_EXPIRED`, after which
the client recreates the query. It also ends on client close or explicit
`DELETE /api/live/search/{queryId}`.

## Media

- `GET /api/live/chunks/{chunkId}/thumb` — retained JPEG.
- `GET /api/live/chunks/{chunkId}/media` — immutable short clip with HTTP Range.
- `GET /api/live/sessions/{sessionId}/playback` — returns a configured gateway
  playback descriptor; it does not relay media through Next.js.

Expired local media returns `410 LIVE_MEDIA_EXPIRED` while the searchable
metadata may remain until its independent Elasticsearch retention expires.

## Ops retention (A-20)

Forever retention is the default. There is **no** silent DSL age expiry.
Operators reclaim space with explicit APIs:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/live/ops/protect-ranges` | List absolute UTC protect/keep ranges |
| `POST` | `/api/live/ops/protect-ranges` | Create a keep range (`start_at`, `end_at`, optional `session_id`, `note`) |
| `DELETE` | `/api/live/ops/protect-ranges/{rangeId}` | Remove a protect range |
| `POST` | `/api/live/ops/age-delete` | Delete live chunks/events (and best-effort spool clip/thumb) older than `older_than`; defaults to `dry_run: true` |

Age-delete keys chunks by `window_end_at` and events by `@timestamp`. Any
protect range that contains that timestamp (optionally session-scoped) is
skipped. Example:

```json
POST /api/live/ops/age-delete
{
  "older_than": "7d",
  "dry_run": true
}
```

```json
POST /api/live/ops/protect-ranges
{
  "start_at": "2026-09-01T00:00:00.000Z",
  "end_at": "2026-09-01T23:59:59.000Z",
  "session_id": "ls_…",
  "note": "keep incident window"
}
```

Set `dry_run: false` only after reviewing the dry-run counters. Soft free-space
floor (`LIVE_SPOOL_MIN_FREE_BYTES`) pauses capture under disk pressure; it does
not auto-delete.

## Error catalog

| Code | HTTP | Meaning |
| --- | --- | --- |
| `LIVE_INVALID_REQUEST` | 400 | Schema or window constraint failed |
| `LIVE_SOURCE_NOT_FOUND` | 404 | Unknown source |
| `LIVE_SOURCE_DISABLED` | 409 | Start requested for a disabled source |
| `LIVE_SOURCE_PENDING_VALIDATION` | 409 | Worker has not validated the source yet |
| `LIVE_SOURCE_INVALID` | 422 | Worker rejected the source connection material |
| `LIVE_SOURCE_FORBIDDEN` | 403 | Protocol, host, resolved address, or port rejected |
| `LIVE_CREDENTIAL_NOT_FOUND` | 422 | Credential reference cannot be resolved |
| `LIVE_SESSION_CONFLICT` | 409 | Conflicting active session or stale revision |
| `LIVE_SESSION_REPLACEMENT_PENDING` | 409 | Prior session must finish draining |
| `LIVE_SESSION_NOT_FOUND` | 404 | Unknown session |
| `LIVE_WORKER_UNAVAILABLE` | 503 | No fresh singleton-worker heartbeat exists |
| `LIVE_SOURCE_CHANGED` | 409 | Resolved endpoint no longer matches session snapshot |
| `LIVE_CONNECT_TIMEOUT` | 504 | Connection attempt timed out |
| `LIVE_MEDIA_INVALID` | 422 | Decoder or fragment validation failed |
| `LIVE_QUEUE_SATURATED` | 503 | Bounded queue cannot accept work |
| `LIVE_WINDOW_DROPPED` | 200 event | Window intentionally dropped under configured policy |
| `LIVE_EMBED_FAILED` | 502 | Provider failed after bounded retry |
| `LIVE_INDEX_FAILED` | 502 | Window could not be acknowledged by Elasticsearch |
| `LIVE_MEDIA_EXPIRED` | 410 | Retained clip or thumbnail has expired |
| `LIVE_EVENT_CURSOR_INVALID` | 400 | Session event cursor is malformed or ahead |
| `LIVE_EVENT_CURSOR_EXPIRED` | 410 | Session event cursor predates retention |
| `LIVE_QUERY_EXPIRED` | 410 | Process-local follow handle is unavailable |

## Compatibility rule

Existing `/api/ingest`, `/api/search`, `/api/search/image`, `/api/library`, and
file media routes retain their current contracts. Shared internal query code may
be refactored only with regression tests proving identical file-route responses.
