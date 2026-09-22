# Technology Review — Live Video Search Architecture Spine

**Reviewed:** 2026-09-10  
**Re-reviewed after amendments:** 2026-09-10  
**Artifact:** `plan/architecture/architecture-live-video-search-2026-09-10/ARCHITECTURE-SPINE.md`  
**Review focus:** current technology reality, protocol/runtime fit, and implementation-blocking assumptions  
**Verdict:** **READY TO START PHASE 1, WITH PRECONDITIONS — the amended design closes the original media, recovery, retention, modality, and singleton-worker ambiguities. It still has four RTSP implementation gates and two new cross-document contract conflicts that must be resolved before the live vertical slice can pass.**

The document exists to give the implementation team a compact, authoritative
substrate for building remote live-video capture, embedding, indexing, search,
and playback. Its separation of the unbounded media worker from Next.js, use of
an adapter boundary, append-only Elasticsearch data, deterministic identity,
and explicit backpressure are good foundations. The protocol choices are also
real: MediaMTX 1.21.0 supports WHIP publishing, FFmpeg supports RTSP/TCP, and
Elasticsearch Serverless supports data streams and Data Stream Lifecycle.

The amendments close T-03, T-04, T-07, T-08, T-10, and T-13 at design level.
T-02 and T-09 are correctly deferred and do not block the RTSP MVP. T-01,
T-05, T-06, T-11, and T-12 are now explicit implementation gates rather than
hidden assumptions. T-14 is adequately clarified for planning and its remaining
runtime work is covered by T-01 and T-11.

## Amendment closure matrix

| Finding | Closure status | Re-review evidence | Remaining action |
| --- | --- | --- | --- |
| T-01 | **PARTIAL — explicit Phase 1 gate** | The spine now labels FFmpeg 8.1.1 as host-observed; operations and Phase 1 require a dedicated pinned worker image and capability manifest. | Pin and build the actual worker image, then record its digest and FFmpeg capabilities before Phase 2. |
| T-02 | **CLOSED for RTSP; DEFERRED for SRT** | Operations keeps SRT disabled unless the worker probe exposes `srt`; protocol extensions are independently gated. | No RTSP action. Require a libsrt-capable image and SRT-specific acceptance before enabling SRT. |
| T-03 | **CLOSED in design** | AD-3 and the media contract select transcoding, forced two-second keyframes, and actual-PTS coverage rather than fragment counting. | Prove long-GOP, VFR, and keyframe fixtures in Phase 3. |
| T-04 | **CLOSED in design** | The media contract binds MPEG-TS, H.264/yuv420p/1280x720/25 fps, optional AAC-LC mono 16 kHz, selected tracks, media-signature epochs, and standalone MP4 windows. | Commit one constant FFmpeg argument vector and prove output with `ffprobe`. |
| T-05 | **PARTIAL — implementation mechanism unproven** | AD-16 and data flow define a receive-anchor clock, uncertainty, PTS origin, UTC, and monotonic stage timing. | Prove how the worker samples the first accepted packet PTS and simultaneous clocks from the same FFmpeg capture process; see R-02. |
| T-06 | **PARTIAL — architecture corrected, bounded execution unproven** | AD-7 and Phase 5 use asynchronous micro-batches with one `refresh=wait_for`; operations now budget five seconds for Serverless refresh. | Define maximum in-flight batches and reconcile the 10-second target with the 10.5-second component envelope; see R-03. |
| T-07 | **CLOSED in design** | The chunk and manifest carry `media_sha256` and `immutable_fingerprint`; 409 acknowledgment compares media, variant, schema, provider/model/task, normalization, and proxy settings. | Prove mismatch and valid-replay fixtures. |
| T-08 | **CLOSED in design** | AD-6 and retention rules separate replay protection from retained playback lifetime; acknowledgment never deletes retained media. | Prove acknowledgment, eviction, expiry event, and 410 transitions. |
| T-09 | **DEFERRED — not an RTSP blocker** | WHIP remains behind Phase 9 and requires pinned MediaMTX plus one-time publisher credentials. | Before WHIP release, add the still-missing TLS/CORS/ICE/STUN/TURN/codec profile and remote-network test; see Deferred D-01. |
| T-10 | **CLOSED for one-host MVP** | AD-5 mandates one process, one Compose replica, and an exclusive spool-root lock; distributed fencing is explicitly deferred. | Implement an OS-held lock whose ownership is released on process death; do not use stale file existence as the lock. |
| T-11 | **PARTIAL — explicit Phase 1 gate** | Operations and Phase 1 name the resolved 8.19.2 client and require either a tested 9.x client or tested raw REST for lifecycle/template calls. | Select and test one path before live mappings are implemented; see R-01. |
| T-12 | **PARTIAL — adapter boundary defined, connection binding missing** | `LiveSourceAdapter.protocolPolicy()` and adapter-specific whitelist tests are planned; HLS redirects and SRT admission are deferred. | Bind the validated address to the address FFmpeg actually uses and add egress enforcement; see R-04. |
| T-13 | **CLOSED in design** | AD-7 allows no-audio; present-audio failure fails the window; media-signature changes open an epoch; track selection is specified. | Prove no-audio, late-audio, track-change, codec-change, and resolution-change fixtures. |
| T-14 | **CLOSED for planning; runtime work folded into T-01/T-11** | Stack entries now identify repository baseline, host observation, external observation, and preconditions instead of claiming one reproducible resolved runtime. | Record exact worker, Node, FFmpeg, MediaMTX, and client versions in the acceptance manifest. |

## Remaining implementation blockers after amendment

### R-01 — The worker and Elasticsearch client runtime are still choices, not resolved artifacts

- **Maps to:** T-01, T-11, T-14
- **Trigger condition:** Phase 2 or mapping implementation begins before Phase 1
  produces an exact worker image and client path.
- **Finding:** The documents now correctly expose the work, but the repository
  still has the Bookworm FFmpeg mismatch and the 8.19.2 JavaScript client against
  observed Serverless 9.6.0. A plan to choose later is not runtime evidence.
- **Guard:** Treat the Phase 1 image/client probe as a hard dependency: commit a
  digest-pinned worker build, capability manifest, selected client/REST strategy,
  and live template/lifecycle create-and-read-back result before RTSP coding
  advances beyond contract-only tests.
- **Consequence:** Media and data-stream behavior can diverge between local,
  container, and target Elastic environments.

### R-02 — The receive-anchor contract lacks an observable capture mechanism

- **Maps to:** T-05
- **Trigger condition:** The worker must record “the first accepted packet's PTS
  and simultaneous worker UTC plus monotonic time” while FFmpeg owns packet input.
- **Finding:** The timestamp semantics are now clear, but no process interface
  explains how Node observes a packet-level PTS and its receive instant from the
  same FFmpeg connection. Probing a finalized fragment later does not recreate a
  simultaneous receive timestamp, and opening a second `ffprobe` connection
  observes a different packet stream.
- **Guard:** In the RTSP spike, select and bind one measurable technique: tested
  FFmpeg progress/log metadata, a controlled wall-clock timestamp mode, or a
  worker-observed fragment anchor with explicitly larger uncertainty. Persist
  the measured uncertainty and test PTS reset, clock step, and process restart.
- **Consequence:** The implementation may fabricate precision the media process
  cannot supply, invalidating absolute-time filters and alignment evidence.

### R-03 — Indexing concurrency and the latency gate remain internally inconsistent

- **Maps to:** T-06
- **Trigger condition:** A Serverless refresh approaches five seconds while new
  ready windows continue arriving.
- **Finding:** Asynchronous micro-batching removes capture blocking, but there is
  no maximum number of in-flight bulk/refresh waits or explicit queue ownership
  for those pending acknowledgments. Operations also states a 10,000 ms p95
  target beside a 10,500 ms component envelope, while the spec and Phase 10
  require p95 at or below 10 seconds.
- **Guard:** Add a bounded indexing-ack queue and in-flight batch limit to AD-12
  and configuration. Choose one coherent initial gate: either reduce component
  budgets to fit 10 seconds or set the acceptance target to the envelope until
  measured evidence justifies tightening it. Test refresh-delay saturation.
- **Consequence:** Pending refresh listeners can become an unbounded hidden
  queue, and a run can satisfy every stage budget yet fail the aggregate gate.

### R-04 — DNS validation is not bound to FFmpeg's actual connection

- **Maps to:** T-12
- **Trigger condition:** A permitted hostname changes its DNS answer after the
  worker's preflight check but before or during FFmpeg resolution/reconnect.
- **Finding:** Re-resolution tests detect some changes, but FFmpeg still resolves
  the hostname independently. A preflight approval does not prove the socket
  connected to the approved address; the operations security list does not yet
  require network egress enforcement.
- **Guard:** For the RTSP/TCP MVP, require a literal approved address, safely
  rewrite the connect target to the vetted address where protocol semantics
  allow it, or enforce the approved destination set at the worker/container
  network boundary. Test DNS rebinding between validation and connect, not only
  between reconnect attempts.
- **Consequence:** A source can pass application validation and still make FFmpeg
  connect to a forbidden local or metadata destination.

### R-05 — Source creation contradicts the declared credential-isolation boundary

- **Maps to:** new cross-document finding
- **Trigger condition:** `POST /api/live/sources` validates a `connection_ref`
  while the deployment gives source credential variables only to `live-worker`.
- **Finding:** The API contract says the Next.js API resolves the complete secret
  to validate the endpoint and compute redacted provenance. The architecture
  deployment seed says only the worker receives stream credential variables,
  and the data flow resolves/validates the reference in the worker. Both cannot
  be true. The source document nevertheless expects `endpoint_fingerprint`,
  `allowed_host`, and `allowed_port` at source-registration time.
- **Guard:** Choose one owner. The safer contract is for the API to validate only
  the reference name and non-secret fields, then let the worker resolve, validate,
  and record a sanitized immutable session snapshot when starting. Otherwise,
  explicitly grant the web process secret access and revise the isolation claim.
- **Consequence:** Implementation either fails registration because the API
  cannot resolve the reference or unnecessarily exposes camera credentials to
  the web process.

### R-06 — Strict event mappings conflict with an arbitrary payload object

- **Maps to:** new cross-document finding
- **Trigger condition:** A durable event indexes a type-specific field inside
  `payload: Record<string, unknown>`.
- **Finding:** The data model requires all mappings to use `dynamic: strict` but
  defines the durable event payload as an unconstrained object. Unless every
  possible payload field is predeclared, Elasticsearch rejects the first unknown
  field under a strict object mapping.
- **Guard:** Replace `Record<string, unknown>` with a discriminated typed event
  union and an exhaustive strict mapping, map payload as `flattened` if its query
  limitations are acceptable, or set only that object to `enabled: false` and
  duplicate searchable cursor/filter fields at the top level. Add one indexing
  fixture for every event type.
- **Consequence:** Durable SSE and follow-search events can fail indexing even
  though the session revision has already been reserved.

## Deferred, protocol-specific remainder

### D-01 — WHIP deployment profile is still incomplete

This does not block RTSP. Before Phase 9 WHIP acceptance, bind HTTPS/signaling
origin, publisher authentication and path authorization, CORS, ICE-advertised
addresses, exposed UDP/TCP ports, STUN/TURN, supported browser/encoder codecs,
publisher replacement behavior, and the internal worker subscription protocol.
Require a remote-network fixture rather than localhost-only evidence.

## Evidence checked

### Repository and local runtime

- `package.json` pins Next.js 14.2.35, React 18.3.1, and EUI 119.1.0.
- `yarn.lock` resolves `@elastic/elasticsearch` 8.19.2 from the declared
  `^8.17.0` range.
- The local host reports Node 22.13.1 and FFmpeg 8.1.1.
- The local FFmpeg build exposes RTSP and HLS demuxers, but `ffmpeg -protocols`
  does **not** expose `srt`; its build configuration has no `--enable-libsrt`.
- The current `Dockerfile` starts from `node:22-bookworm-slim` and installs
  FFmpeg using Debian Bookworm `apt`, not an FFmpeg 8.1.1 artifact. Debian
  Bookworm currently packages FFmpeg 5.1.9.
- The current repository contains no live worker, MediaMTX service, live data
  stream template, or live implementation tests. That is consistent with the
  companion documents' “planned, not implemented” status.

### Primary documentation

- MediaMTX 1.21.0 is the current documented release and accepts WHIP publishing
  at `/{path}/whip`: [MediaMTX WebRTC clients](https://mediamtx.org/docs/publish/webrtc-clients),
  [MediaMTX configuration reference](https://mediamtx.org/docs/references/configuration-file),
  [MediaMTX releases](https://github.com/bluenviron/mediamtx/releases/tag/v1.21.0).
- WHIP is IETF Standards Track RFC 9725 and uses HTTP signaling followed by
  ICE/DTLS/SRTP media transport: [RFC 9725](https://www.rfc-editor.org/rfc/rfc9725.html).
- FFmpeg documents RTSP TCP interleaving, SRT, timeout controls, and protocol
  whitelisting; protocol availability still depends on the build:
  [FFmpeg protocols](https://ffmpeg.org/ffmpeg-protocols.html).
- FFmpeg segment boundaries are keyframe-sensitive unless encoding and keyframe
  placement are controlled: [FFmpeg formats](https://ffmpeg.org/ffmpeg-formats.html).
- Elasticsearch data streams require `@timestamp` and create-only writes;
  Data Stream Lifecycle is available on Serverless:
  [set up a data stream](https://www.elastic.co/guide/en/elasticsearch/reference/current/set-up-a-data-stream.html),
  [Data Stream Lifecycle](https://www.elastic.co/guide/en/elasticsearch/reference/current/data-stream-lifecycle.html).
- `refresh=wait_for` waits for a refresh; the documented Serverless default
  refresh interval is 5 seconds, and Elastic recommends batching consecutive
  waits: [refresh parameter](https://www.elastic.co/docs/reference/elasticsearch/rest-apis/refresh-parameter).
- The JavaScript client compatibility matrix maps Elasticsearch 9.x to a 9.x
  client. An 8.x client can be a compatibility bridge, but it does not expose
  feature parity for newer APIs: [JavaScript client installation](https://www.elastic.co/docs/reference/elasticsearch/clients/javascript/installation),
  [REST API compatibility](https://www.elastic.co/docs/reference/elasticsearch/rest-apis/compatibility).
- Node 22 remains supported but is in Maintenance LTS until 2027-04-30:
  [Node release schedule](https://github.com/nodejs/Release#release-schedule).

## Technology findings

### T-01 — The declared FFmpeg runtime does not match the container runtime

- **Location:** Stack; Structural Seed; AD-3
- **Trigger condition:** The worker is built from the current
  `node:22-bookworm-slim` Dockerfile and installs FFmpeg with `apt`.
- **Finding:** The spine declares FFmpeg 8.1.1, but Debian Bookworm installs
  FFmpeg 5.1.9. The local macOS measurement does not establish the worker image.
  The floating `node:22-bookworm-slim` tag also prevents a reproducible runtime.
- **Guard:** Define a dedicated worker image with an exact Node image digest and
  an exact FFmpeg build/version. At startup and in acceptance, record
  `ffmpeg -version`, `ffmpeg -buildconf`, `ffmpeg -protocols`, encoders,
  demuxers, and the image digest. Either make 5.1.9 the supported baseline and
  test it, or explicitly install a verified 8.1.x build.
- **Consequence:** Local acceptance can pass while the deployed fragmenter or
  codecs behave differently or lack required capabilities.

### T-02 — SRT is named as an adapter, but the verified FFmpeg build cannot use it

- **Location:** AD-2; Stack; Deferred
- **Trigger condition:** Work begins on the deferred SRT adapter using the
  currently verified host toolchain.
- **Finding:** FFmpeg supports SRT only when the distribution build includes the
  required protocol/library. The current local 8.1.1 binary has no `srt` input
  or output protocol and no `--enable-libsrt` build flag.
- **Guard:** Add an adapter capability probe and fail startup with a stable
  `LIVE_PROTOCOL_UNAVAILABLE` code when a configured protocol is absent. Pin a
  worker FFmpeg build with SRT support before moving the adapter out of deferred
  scope. Record caller/listener/rendezvous mode and encryption/passphrase rules
  in that adapter's contract.
- **Consequence:** The design can claim SRT extensibility that the shipped
  runtime cannot exercise.

### T-03 — Two-second finalized fragments are not guaranteed by the current rule

- **Location:** AD-3
- **Trigger condition:** An RTSP camera sends long or irregular GOPs and capture
  uses stream copy into FFmpeg's segment muxer.
- **Finding:** FFmpeg normally cuts video segments on suitable keyframes. A
  requested two-second segment duration does not guarantee a two-second media
  file when keyframe cadence is uncontrolled. “Four fragments form one
  eight-second window” is therefore not an implementation invariant yet.
- **Guard:** Choose and document one of two contracts: (a) transcode capture to
  a canonical GOP and force two-second keyframes, including CPU budget and
  encoder availability; or (b) preserve source packets, admit variable fragment
  durations, and assemble windows by PTS coverage rather than fragment count.
  Acceptance must include long-GOP, VFR, and missing-keyframe fixtures.
- **Consequence:** Window duration, overlap, sequence cadence, latency, and model
  input semantics drift from the claimed values.

### T-04 — The normalized fragment/container contract is missing

- **Location:** Design Paradigm; AD-3; Structural Seed
- **Trigger condition:** Inputs vary across H.264/H.265, AAC/Opus/G.711,
  missing-audio, multiple-track, and resolution-change feeds.
- **Finding:** “Normalized fragment” does not state container, codecs, time
  base, track-selection policy, or whether normalization occurs during capture
  or only during proxy encoding. Concatenating independently finalized MP4 or
  fMP4 fragments also requires an explicit init/container strategy.
- **Guard:** Bind a `NormalizedFragment` media contract: container, accepted
  input codecs, canonical output codecs, time base, keyframe rule, selected
  video/audio tracks, no-audio behavior, resolution/codec-change handling, and
  exact FFmpeg command templates. Prefer MPEG-TS or a fully specified fMP4/init
  design for crash-safe capture, then generate a standalone embedding proxy.
- **Consequence:** The window assembler can emit files that are not decodable,
  seekable, or accepted by the embedding provider.

### T-05 — Event time cannot be derived from arbitrary stream PTS alone

- **Location:** AD-4; AD-13; Consistency Conventions
- **Trigger condition:** The source PTS starts at zero, wraps, jumps, or is
  generated from a clock unrelated to UTC.
- **Finding:** `@timestamp` is defined as window-end event time, but the spine
  does not define how media PTS becomes an absolute UTC timestamp. RTSP PTS by
  itself is not wall-clock time. Receive time, RTCP sender reports, camera
  metadata, and playlist program-date-time have different accuracy.
- **Guard:** Define a per-adapter `ClockAnchor` contract with source, uncertainty,
  drift correction, monotonicity rules, and fallback to worker receive time.
  Persist both source-media time and ingestion/receive time. Increment the epoch
  on clock-source or discontinuity changes, not merely process reconnects.
- **Consequence:** Time-filtered search and clip alignment can return the wrong
  real-world interval while appearing internally consistent.

### T-06 — Per-document `refresh=wait_for` conflicts with the stated live cadence

- **Location:** AD-7
- **Trigger condition:** Elasticsearch Serverless retains its documented
  five-second refresh interval and one document is indexed every six seconds.
- **Finding:** `refresh=wait_for` confirms visibility, but it does not mean a
  one-second index stage. On Serverless it can wait close to five seconds. If
  the same processing slot awaits indexing before accepting the next window,
  the approximately three-second inference plus refresh wait can exceed the
  six-second emission cadence. Consecutive waits also lose Elastic's advised
  bulk benefit.
- **Guard:** Separate the inference concurrency gate from asynchronous indexing
  acknowledgments; measure the real Serverless refresh distribution. Either
  budget up to the observed interval, micro-batch ready documents in one bulk
  request with one `refresh=wait_for`, or index with `refresh=false` and confirm
  visibility through a bounded poll/search contract. Do not emit `searchable`
  until visibility is actually confirmed.
- **Consequence:** A nominally one-stream design can accumulate backlog and miss
  its close-to-searchable target before media or inference is saturated.

### T-07 — Duplicate acknowledgment verifies only fields already encoded by the ID

- **Location:** AD-6; AD-7
- **Trigger condition:** Recovery receives HTTP 409 for an existing deterministic
  document whose payload was produced with different media or embedding settings.
- **Finding:** The companion data model proposes checking source, session,
  epoch, and sequence. Those values are already the document identity and do
  not prove payload equivalence. A corrupted or semantically different earlier
  write could be acknowledged as success.
- **Guard:** Put `media_sha256`, `variant_id`, schema/mapping version, provider,
  model/task, normalization contract, and proxy-settings fingerprint in the
  live document and manifest. On 409, fetch the existing document and compare
  the full immutable identity fingerprint before writing `index_ack`.
- **Consequence:** Recovery can silently bind the wrong vector or clip to a
  supposedly verified window.

### T-08 — Spool acknowledgment and playback retention have conflicting lifetimes

- **Location:** AD-6; AD-10
- **Trigger condition:** A successful index acknowledgment is interpreted as
  permission to delete the finalized media named in AD-6.
- **Finding:** AD-6 says media remains “until” indexing acknowledgment, while
  AD-10 requires retained immutable clips for search results. The spine does
  not state whether the embedding spool and playback-retention store are one
  object, linked objects, or separate copies.
- **Guard:** Define explicit lifecycle states such as
  `finalized -> indexed -> retained -> expired`; state that acknowledgment
  releases only replay protection, not playback retention. Define reference
  ownership, GC eligibility, crash consistency, and the 410 transition without
  requiring a second source-content copy unless the storage design needs one.
- **Consequence:** Implementers can delete result media immediately after
  indexing or retain unbounded duplicate media.

### T-09 — WHIP support is real, but “terminate at MediaMTX” is not a deployment contract

- **Location:** AD-2; AD-10; Deferred
- **Trigger condition:** A browser or remote encoder publishes across NAT or
  through an HTTPS application origin.
- **Finding:** MediaMTX 1.21.0 does accept RFC 9725 WHIP, but successful external
  WebRTC publishing also requires HTTPS/signaling origin decisions, CORS,
  publisher authentication, ICE-advertised addresses, UDP/TCP port exposure,
  and often STUN/TURN. Browser codec support is also constrained.
- **Guard:** Before promoting WHIP, add a gateway deployment profile covering
  TLS, authentication, CORS, path authorization, ICE host/ports, STUN/TURN,
  codecs, and the exact internal worker-read protocol. Require a real remote
  network acceptance fixture, not only localhost.
- **Consequence:** WHIP can work in local Compose yet fail or expose an open
  publisher endpoint in the intended deployment.

### T-10 — Worker separation is correct, but exclusive session ownership is deferred too far

- **Location:** AD-1; AD-5; Deferred
- **Trigger condition:** Compose restarts or temporarily overlaps two worker
  processes, even with only one configured stream.
- **Finding:** A dedicated worker is the right fit for an unbounded process, but
  “multi-host worker leasing” is deferred while session documents already have
  worker identity/lease concepts. Without a compare-and-set claim, two workers
  can launch FFmpeg for the same session and race on epoch, sequence, and state.
- **Guard:** Make a single-owner claim mandatory for MVP. A minimal lease can be
  stored in Elasticsearch with atomic create/update preconditions and fencing
  tokens; the worker must renew it and stop media work when fenced. Horizontal
  scheduling and a queue may remain deferred.
- **Consequence:** Ordinary restart overlap can duplicate capture and index
  conflicting chunks without any multi-stream scale-out.

### T-11 — The Elasticsearch client version is absent from the stack decision

- **Location:** Inherited Invariants; Stack; AD-8
- **Trigger condition:** The implementation uses Data Stream Lifecycle APIs
  against the observed Elasticsearch Serverless 9.6.0 deployment.
- **Finding:** The repository resolves JavaScript client 8.19.2, while the stack
  names only the 9.6.0 server. Elastic documents 9.x client-to-9.x server as the
  feature-complete pair; REST compatibility is a migration bridge and does not
  give an older client new API types/features automatically.
- **Guard:** Add the JavaScript client to the version matrix and either upgrade
  to a tested 9.6-compatible client or specify raw REST calls for unsupported
  lifecycle/template fields. Add a live template/create/write/read-back probe.
- **Consequence:** Type-safe implementation can stall on missing API fields, or
  lifecycle configuration can be silently omitted.

### T-12 — FFmpeg protocol whitelisting needs per-adapter closure tests

- **Location:** AD-11
- **Trigger condition:** The worker applies one generic whitelist to RTSP, HLS,
  and later SRT inputs.
- **Finding:** FFmpeg inputs invoke nested protocols: RTSP/TCP differs from
  HTTP(S)/TLS playlist loading, and HLS can load nested playlists and segment
  URLs. A generic whitelist is either too broad or breaks valid input.
- **Guard:** Give each adapter an exact whitelist plus format/protocol flags and
  verify it with positive and negative fixtures. Revalidate HLS redirects and
  every playlist/segment destination. Add OS/container egress controls because
  FFmpeg performs its own resolution and a preflight DNS result alone does not
  eliminate DNS rebinding.
- **Consequence:** Production either rejects valid feeds or permits SSRF through
  an unexpected nested protocol or re-resolved address.

### T-13 — Track absence and mid-stream media changes need explicit state paths

- **Location:** AD-3; AD-4; AD-7
- **Trigger condition:** A feed has no audio, audio starts late, a camera changes
  resolution/codec, or a publisher replaces tracks.
- **Finding:** The rule says video and audio inference run concurrently but does
  not define optional audio or changing media parameters. The data model makes
  audio optional, so the spine should bind that behavior.
- **Guard:** Specify that video-only windows remain indexable, define minimum
  usable video/audio coverage, and make codec/resolution/track-set changes
  explicit epoch boundaries or fatal adapter events. Record the selected stream
  indices and media signature in the manifest.
- **Consequence:** Normal camera behavior can stall the pipeline, mix incompatible
  fragments, or cause false session failures.

### T-14 — Runtime pinning policy is internally inconsistent

- **Location:** Stack
- **Trigger condition:** A new environment installs the named “versions.”
- **Finding:** The table mixes a version family (`Node.js 22.x`), exact package
  pins, one locally observed server version, a model dimension, and an RFC.
  FFmpeg 8.1.1 is verified locally but 8.1.2 is the current 8.1 patch release;
  Node 22 is in Maintenance LTS, and the current host is on 22.13.1 rather than
  the latest 22.x maintenance release. None of these is necessarily wrong, but
  the support/pinning intent is ambiguous.
- **Guard:** Split the table into: repository dependencies, worker runtime pins,
  external-service observations, model contract, and protocol standards. State
  whether each entry is exact, minimum, tested range, or observed-only, and add
  a planned update/security cadence.
- **Consequence:** Rebuilds drift while reviewers mistake observations for
  enforced compatibility requirements.

## Edge paths not yet closed

| Path | Missing handling | Required guard |
| --- | --- | --- |
| EOF or stop during a partial window | Whether to embed, discard, or terminally record the partial window | Record a terminal reason and bind minimum-duration policy |
| Stop requested while inference/index refresh is in flight | Whether shutdown drains or cancels and who acknowledges the window | State a bounded drain deadline and replay ownership |
| Provider returns one vector but the other fails | Whether video-only fallback is allowed after retries | Bind partial-inference policy to `variant_id` |
| Spool reaches hard limit while no manifest write is possible | Session fails, but ownership of already-running FFmpeg is not explicit | Stop capture first, fence the session, then report failure |
| `@timestamp` falls outside current retention due to source clock error | Data can age out immediately | Validate clock skew and retain receive-time fallback |
| Data stream template already exists with incompatible mapping | Idempotent setup cannot safely overwrite it | Compare schema hash and stop on mismatch |
| Session embedding settings change while running | Deterministic ID no longer identifies one semantic contract | Freeze settings per epoch or start a new session/variant |
| MediaMTX path has an existing publisher | Default replacement policy can disconnect the current producer | Disable publisher override or authorize replacement explicitly |

## Editorial review

This review uses the **Explanation (Conceptual)** structure model. The artifact
is concise at 1,364 words and generally follows abstract-to-concrete ordering.

| Pass | Original Text | Revised Text | Changes |
| --- | --- | --- | --- |
| structure | `status: final` and `## Deferred` | QUESTION: use `status: conditional` until the media, clock, refresh, and lease contracts are bound; move those assumptions to an early `Implementation Preconditions` section | Prevents “final” from being interpreted as build-ready; adds about 80–120 words |
| structure | `## Stack` | MERGE with a short support matrix split into repository pins, worker runtime, external observations, and standards | Makes heterogeneous version claims auditable; approximately word-neutral |
| structure | AD-3, AD-4, and AD-7 | PRESERVE, but add direct links to the canonical media, clock, and visibility contracts once written | These are the critical implementation seams; links add about 15 words |
| structure | `## Structural Seed` before the capability map | PRESERVE | The compact file map helps implementers translate decisions into modules |
| prose | “Live chunk data stream” | “Elasticsearch live-chunk data stream” | Avoids confusion with the incoming live media stream |
| prose | “a window is indexed immediately with `refresh=wait_for`” | “the worker submits each ready window without batch delay and confirms search visibility according to the indexing-ack contract” | “Immediately” contradicts a potentially five-second refresh wait |
| prose | “HLS and SRT are additional adapters” | “HLS and SRT are deferred adapter contracts” | Matches the Deferred section and current runtime capability |
| prose | “a simultaneous-stream target above one” | “a requirement for more than one concurrent stream” | Removes awkward phrasing without changing scope |

**Editorial summary:** 8 recommendations. No net reduction is warranted; the
document is already compact. Accepting the precondition and contract links may
add roughly 95–135 words (7–10%) but materially reduces implementation
ambiguity. No comprehension-enhancing diagram or table should be removed.

## Confirmed decisions that should remain

- Keep the dedicated worker separate from Next.js request lifecycles.
- Keep RTSP over TCP as the first remote-pull implementation.
- Keep WHIP termination at MediaMTX rather than implementing WebRTC signaling
  in the worker.
- Keep live chunks separate from file-video indices and use create-only data
  stream writes with deterministic IDs.
- Keep search-result clips independent from the current-live player.
- Keep deny-by-default source validation, argument-array process spawning,
  bounded queue/spool behavior, explicit dropped-window records, and stage-level
  latency timestamps.

## Acceptance recommendation

After T-01 through T-08 are resolved in binding documents, proceed with an RTSP
MVP spike in this order:

1. Prove the exact worker image, FFmpeg build, RTSP/TCP input, canonical fragment
   contract, and long-GOP behavior.
2. Prove event-time anchoring, reconnect/epoch transitions, stop/drain, and
   single-owner fencing without invoking embedding.
3. Prove exact-window proxy generation and optional-audio behavior.
4. Create/read back the live data-stream template and lifecycle on the target
   Serverless project; measure index-to-visible timing.
5. Add embedding, recovery, duplicate fingerprint verification, retained-media
   lifecycle, follow search, and the full fault-injection manifest.

MediaMTX/WHIP, HLS, and SRT should remain independently gated additions. The
RTSP acceptance result cannot be used as evidence that those adapters work.
