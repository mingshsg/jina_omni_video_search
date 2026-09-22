---
id: SPEC-live-video-search
companions:
  - ../../architecture/architecture-live-video-search-2026-09-10/ARCHITECTURE-SPINE.md
  - ../../../requirements/02-live-video-search-requirements.md
  - ../../../docs/live-video-api-contract.md
  - ../../../docs/live-video-data-model.md
  - ../../../docs/live-video-state-recovery.md
  - ../../../docs/live-video-operations.md
  - ../../01-live-video-search-implementation-plan.md
  - ../../02-live-video-traceability.md
sources: []
---

> **Canonical contract.** This SPEC and the files in `companions:` are the
> complete contract for building and validating live-video search. The existing
> file-video requirements and implementation remain supported but are not part
> of this feature contract.

# Live Video Indexing and Search

## Why

The current application can search video only after a finite source has been
uploaded or downloaded and fully processed. Operators need remote camera and
live-feed content to become searchable continuously while a stream is running,
without weakening the existing embedding, provenance, or retrieval guarantees.

## Capabilities

- **CAP-1**
  - **intent:** An operator can register, start, stop, and inspect a remote live source.
  - **success:** An RTSP-over-TCP source reaches `live`, stops on request, and reconnects after a controlled interruption.
- **CAP-2**
  - **intent:** The system continuously converts a source into deterministic overlapping windows.
  - **success:** The default profile emits a four-fragment window every three finalized fragments, targeting 8-second coverage and 6-second cadence, with actual PTS boundaries, monotonic sequence, and explicit discontinuity epochs.
- **CAP-3**
  - **intent:** Each completed window becomes semantically searchable without waiting for the stream to end.
  - **success:** A `searchable` event is emitted only after Elasticsearch can retrieve the window document.
- **CAP-4**
  - **intent:** A user can search live windows by text or image and restrict results by source, session, time range, and modality.
  - **success:** Newly matching windows appear while an unchanged query is followed without re-running query inference.
- **CAP-5**
  - **intent:** An operator can see connection health, processing lag, backlog, drops, reconnects, and window failures.
  - **success:** Each injected fault appears with a stable code, timestamp, affected sequence, and recovery state.
- **CAP-6**
  - **intent:** A user can inspect a result thumbnail and play the retained clip for that window.
  - **success:** Playback content and displayed absolute timestamps match the indexed window.
- **CAP-7**
  - **intent:** The worker can recover finalized but unacknowledged windows after restart.
  - **success:** Recovery indexes each window at most once logically, with no duplicate search hits.
- **CAP-8**
  - **intent:** Remote-feed access is constrained and credentials never enter Git, indexed documents, logs, or client responses.
  - **success:** Unapproved destinations are blocked and stored source provenance is redacted.

## Constraints

- A dedicated worker, not a Next.js request, owns long-running media processes.
- RTSP over TCP is the first delivery slice; HLS and SRT use the adapter family
  but require protocol-specific security and clock extensions; browser WHIP
  terminates at a media gateway.
- Existing provider identity, variant isolation, dual visual/audio vectors,
  1024 dimensions, provider byte budgets, and RRF behavior remain binding.
- Live sessions and chunks use separate Elasticsearch storage from file assets
  because their identity, lifecycle, time, and retention differ.
- The application never installs, starts, or bundles Elasticsearch. Every live
  setup, integration check, write, and query uses only the external Elastic
  instance identified by `ELASTICSEARCH_URL` and `ELASTICSEARCH_API_KEY` in
  `.env`.
- Complete connectable URLs and credentials are selected by a server-side
  environment/deployment-secret `connection_ref`. Only the worker resolves the
  structured secret; raw secret-bearing URLs are never accepted as durable
  provenance.
- Source validation, session claims, event publication, and crash recovery use
  the ordered state machines in `docs/live-video-state-recovery.md`.
- Each indexed window has deterministic identity and explicit event-time,
  ingestion-time, source, session, epoch, and sequence fields.
- Data-stream rollover cannot create duplicate logical results: recovery checks
  identifiers across all backing indices before create, verifies fingerprints,
  and live retrieval collapses by `chunk_id`.

## Non-goals

- Sub-second semantic availability.
- A general broadcast, transcoding, or CDN platform.
- Multi-tenant authentication and authorization in the first release.
- Face recognition, person identification, automated alerts, or surveillance analytics.
- Replacing or changing the existing file-video ingest and search flow.

## Success signal

A deterministic live fixture runs for 10 minutes, survives one forced
disconnect, indexes all expected windows without duplicates or silent drops,
keeps initial p95 window-close-to-searchable latency at or below 10 seconds for one
stream, and returns timestamp-aligned playable results for text and image
queries.

## Assumptions

- Default windowing is 8 seconds with 2 seconds overlap and a 2-second canonical-fragment target.
- The RTSP MVP is fragment-aligned: four finalized fragments per window and a
  three-fragment step; configured durations are targets and stored PTS coverage
  is authoritative.
- MediaMTX 1.21.0 is used for deterministic integration tests and optional WHIP/SRT gateway behavior; direct FFmpeg RTSP pull remains valid.
- Initial capacity is one active stream on one developer machine.
- Searchable metadata defaults to 7-day retention and local playable clips to 24 hours until policy is confirmed.
- The MVP runs one live worker and one web replica; horizontal scaling requires
  a new fencing and shared follow-handle decision.

## Open Questions

- What retention periods are required for vectors, thumbnails, and playable clips?
- How many simultaneous live streams must the first production-like deployment sustain?
- Is browser-camera publishing through WHIP required in the first release or after remote RTSP acceptance?
