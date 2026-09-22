# Live Video Search Requirements

Status: **planning complete; implementation not started**  
Date: **2026-09-10**  
Branch: **`live-video-search`**

This contract extends the existing file-video application without changing the
file ingest, provider, vector, or retrieval contracts in
[`01-interpreted-requirements.md`](./01-interpreted-requirements.md). The
canonical short spec is
[`SPEC.md`](../plan/specs/spec-live-video-search/SPEC.md).

## Scope and terminology

- **Source** — a reusable remote feed definition with sanitized connection
  metadata and an indirect credential reference.
- **Session** — one start-to-stop connection run for a source.
- **Fragment** — a finalized canonical MPEG-TS media unit in the local spool;
  capture targets 2 seconds, but window assembly uses actual PTS coverage.
- **Window** — an immutable model input assembled on fragment boundaries. The
  default is four finalized fragments advanced by three fragments, targeting 8
  seconds with 2 seconds overlap; stored PTS values report actual coverage.
- **Close-to-searchable lag** — `searchable_at - window_closed_at`; same-boot
  values use the worker's monotonic clock. Recovery across worker boots uses UTC
  elapsed time plus recorded uncertainty and is labeled `cross_boot`.
- **Capture lag** — `window_closed_at - window_end_at`; this is reported
  separately because `window_end_at` is receive-anchored UTC event-time.
- **Event-to-searchable lag** — `searchable_at - event_time`; it ranges with an
  event's position inside a window and is reported separately.

## Protocol contract

| Protocol | Release | Direction | Handling |
| --- | --- | --- | --- |
| RTSP over TCP | MVP | worker pulls | Direct FFmpeg adapter; required acceptance path |
| HLS / LL-HLS | next | worker pulls | Playlist adapter; finalized segments only |
| SRT | next | caller/listener by config | FFmpeg or MediaMTX adapter; passphrase by credential ref |
| WHIP/WebRTC | optional first release | publisher pushes | Terminates at MediaMTX; worker consumes a normalized internal feed |
| RTMP(S) | deferred | publisher pushes | Gateway compatibility only; no app-native implementation |

The application API does not proxy an unbounded media body through a Next.js
route. A source is registered and the dedicated worker establishes or consumes
the media connection.

## Functional requirements

### Source and session control

- **LVR-FR-1** The operator can create, inspect, disable, and list live sources.
  The API stores display metadata and a validated `connection_ref` name in
  `pending_validation`. Only the worker resolves the structured secret, then
  stores sanitized provenance or an `invalid` result. It never stores a secret.
- **LVR-FR-2** At most one nonterminal session may exist per source. A required
  idempotency key and source compare-and-set claim serialize concurrent starts.
  `force_new` first requests a bounded stop/drain
  and creates a new session only after the prior session is terminal.
- **LVR-FR-3** A session exposes separate `desired_state` and `observed_state`.
  The API writes desired state; the worker is the only writer of observed state,
  counters, timestamps, and event revisions. Reserved revisions are internal;
  client cursors use only the contiguous published revision.
- **LVR-FR-4** Session states are `created`, `connecting`, `live`, `degraded`,
  `stopping`, `stopped`, and `failed`. Every transition records a timestamp and
  reason code according to `docs/live-video-state-recovery.md`.

### Capture and windowing

- **LVR-FR-5** The worker supports RTSP over TCP first, using FFmpeg argument
  arrays and an explicit protocol whitelist. Connection timeout, read timeout,
  and reconnect backoff are configurable.
- **LVR-FR-6** Capture transcodes the selected video track and optional audio
  track to the canonical MPEG-TS fragment contract using FFmpeg's HLS muxer with
  `temp_file`, `independent_segments`, and `program_date_time`. A playlist entry
  that references the atomically renamed file is the finalization signal. The
  worker records PTS coverage, receive-anchored UTC, media signature, actual
  duration, and checksum. Open `.tmp` fragments are never passed to inference.
- **LVR-FR-7** Default windowing is fragment-aligned: four consecutive finalized
  fragments per window, advancing three fragments. The 2,000 ms fragment,
  8,000 ms window, and 2,000 ms overlap values are targets; actual start/end PTS
  and duration are authoritative. `0 <= overlap < window` is enforced, and the
  fragment target must divide both configured window and step.
- **LVR-FR-8** Reconnect, PTS regression, codec change, or discontinuity creates
  a new `stream_epoch`. Windows never span epochs.
- **LVR-FR-9** Window identity is deterministic:
  `{session_id}_{stream_epoch}_{sequence_no}`. Epoch and sequence start at 1;
  sequence is allocated in the manifest before media publication, is monotonic
  within an epoch, and is never reused. Every worker restart opens a new epoch.

### Processing and indexing

- **LVR-FR-10** Each window uses the existing proxy primitives with a fixed,
  bounded live profile: 720 px initial long edge and at most three CRF rungs.
  It retains the existing audio-proxy request behavior, thumbnail, active
  embedding provider, 1024 dimensions, provider identity, and normalization
  rules. The live profile is part of `variant_id`; file behavior is unchanged.
- **LVR-FR-11** Visual and audio inference for one window run concurrently under
  the shared `EMBED_CONCURRENCY` gate. Absent audio is a valid video-only
  window; if present audio or required video processing fails after retries,
  the whole window fails and no partial chunk document is indexed.
- **LVR-FR-12** Completed windows enter a bounded indexing-ack queue and are
  micro-batched without blocking capture. Before indexing, the manifest records
  a searchable intent and expected event revision. One bulk create uses
  `refresh=wait_for`; the event is created or verified before terminal `index_ack`.
- **LVR-FR-13** A failed window records a stable error code and retains enough
  spool metadata for bounded retry. Retry attempts persist across restarts;
  `window_failed` is written only after the budget is exhausted and is terminal.
  Sibling and later windows continue unless a source-fatal condition occurs.
- **LVR-FR-14** Finalized window media and its append-only manifest entry remain
  recoverable until terminal acknowledgment or a durable explicit drop.
  Acknowledgment releases replay
  protection but not retained playback media. Restart recovery is idempotent
  and never creates two logical hits for one window. Because data-stream IDs are
  unique only within a backing index, recovery first queries the full data stream
  by `chunk_id` or `event_id` and verifies fingerprints before any create.

### Search and playback

- **LVR-FR-15** Text search supports `source_id`, `session_id`, absolute time
  range, `variant_id`, modality, result size, and sort choice. Existing RRF and
  modality attribution rules remain unchanged.
- **LVR-FR-16** Image search supports the same source/session/time filters and
  searches `embedding_video` only.
- **LVR-FR-17** A follow-search mode requires explicit session IDs and tails
  durable `searchable` events using one cursor per selected session. It reruns
  the full filtered top-K retrieval only when new searchable chunks arrive,
  advances past other event types without retrieval, and reuses the unchanged
  query vector for a bounded TTL.
- **LVR-FR-18** Each hit includes event-time, ingestion-time,
  source/session/epoch/sequence identity, thumbnail URL, and retained clip URL.
  Per-window searchable and lag evidence is returned by the matching durable
  event or acceptance manifest, never fabricated from the immutable chunk. A
  result remains playable after disconnect until clip expiry.
- **LVR-FR-19** The live player, when configured, uses MediaMTX HLS/WebRTC and is
  independent from the retained result clip and embedding path.

### Operations, retention, and safety

- **LVR-FR-20** Status exposes connection state, last media time, last searchable
  time, capture lag, processing lag, queue depth, spool bytes, reconnect count,
  successful/failed/dropped windows, and current error.
- **LVR-FR-21** Work queue, indexing-ack queue, recoverable-input spool,
  retained-media, and reserved manifest headroom limits are enforced
  independently. Breach changes the
  session to `degraded`; the MVP evicts the oldest queued, non-processing window
  and durably records identity, reason, and counter before deleting its media.
  Silent loss is prohibited.
- **LVR-FR-22** Elasticsearch live chunks use Data Stream Lifecycle. Local clips
  and thumbnails use an independently configured retention policy.
- **LVR-FR-23** Stop is graceful: cease new capture, finalize or mark the open
  fragment, drain within a timeout, persist terminal state, then end the process.
- **LVR-FR-24** Source URLs are deny-by-default. Protocol, hostname, resolved IP,
  port, redirects where applicable, and nested protocol access are validated
  before initial connection and reconnect. Every resolved address must be
  allowed, and deployment egress controls bind validation to the actual socket.
- **LVR-FR-25** Complete connectable endpoints and credentials come from
  structured environment-backed `connection_ref` entries available only to the
  worker. URL userinfo is forbidden in the stored base URL; adapter-specific
  credentials are materialized only at the process boundary and are redacted
  from logs, errors, events, Elasticsearch, and API responses.

## Non-functional requirements

| ID | Requirement | Initial gate |
| --- | --- | --- |
| LVR-NFR-1 | Close-to-searchable latency | initial p95 <= 10 s during a 10-minute one-stream run; tighten only from measured evidence |
| LVR-NFR-2 | Search latency | warm p95 < 2 s for text and image live searches |
| LVR-NFR-3 | Sustained throughput | keep pace with every produced four-fragment window (nominal target 10/min) with no growing backlog, processing service time p95 <= 4.5 s at concurrency 2, and bounded behavior during a 429 storm |
| LVR-NFR-4 | Recovery | worker restart causes no duplicate logical hits and recovers every nonterminal window/event intent except durably dropped work |
| LVR-NFR-5 | Reconnect | a reachable interrupted RTSP fixture returns to `live` within 15 s |
| LVR-NFR-6 | Integrity | no window crosses epoch; all result timestamps align within one fragment duration |
| LVR-NFR-7 | Security | private/unapproved targets and protocol smuggling fixtures are rejected |
| LVR-NFR-8 | Compatibility | all existing file-search unit tests, build routes, and E2E contract remain valid |
| LVR-NFR-9 | Evidence | one run manifest identifies source fixture, config, versions, counts, percentiles, faults, and result IDs |
| LVR-NFR-10 | Elastic deployment boundary | no local Elasticsearch process/container is installed or started; all tests and runtime operations use the `.env`-configured external Elastic instance |

The 10-second initial gate combines existing single-sample EIS video (~2.2 s)
and audio (~0.45 s) observations with unverified encode and Serverless refresh
headroom; it is not a current pass claim. The live run must report stage and
event-to-searchable distributions so the target can be tightened honestly.

## Acceptance scenarios

| Scenario | Pass condition |
| --- | --- |
| Ten-minute steady stream | Expected fragment-derived window count, zero unexplained gaps, no growing backlog, p95 service/lag gates pass |
| Controlled disconnect | New epoch, reconnect within gate, no cross-epoch window, indexing resumes |
| Worker restart | Finalized unacknowledged windows replay once logically; counters and state recover |
| Slow inference | Session becomes degraded; queue/spool remain bounded; any drop is explicit |
| Text follow search | A later matching window appears without a second query-inference call |
| Image follow search | New visual match appears with the same cached image vector |
| Result playback | Thumbnail and clip correspond to absolute result time within 2 seconds |
| Malicious source | Disallowed scheme/address/port and secret-bearing persistence are refused |
| File-search regression | `yarn test` and `yarn build` remain green; existing routes retain behavior |

## Assumptions requiring confirmation

1. One simultaneous stream is sufficient for the first accepted release.
2. Searchable vector metadata may be retained for 7 days.
3. Local playable clips and thumbnails may be retained for 24 hours.
4. RTSP is required first; WHIP browser publishing may follow it.

Changing assumptions 1–3 affects queue sizing, worker topology, storage, and
cost. Record the decision in this file, the architecture memlog, operations
configuration, and TODO before implementation expands beyond the MVP.
