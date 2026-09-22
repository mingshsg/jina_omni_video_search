# Program correctness and completion review — 2026-09-13

This review supersedes the completion verdict in
[`project-completion-review-2026-09-13.md`](./project-completion-review-2026-09-13.md)
for the current worktree. It also checks the subsequent Batch 5 fixes and the
new Phase 10 HLS, SRT, and WHIP adapter work.

## Verdict

**The program is not complete and should not be released as a completed live-video implementation.**

The controlled RTSP path is the strongest part of the worktree: the current
unit suite and production build pass, and earlier localhost RTSP manifests show
useful end-to-end progress. Batch 5 repaired several earlier defects, including
basic age-delete pagination, Elasticsearch-before-media ordering, mandatory
application-script gates, loopback Compose binding, and hashing untracked file
bytes.

The completion claim still fails for four independent reasons:

- the entire live feature remains outside the branch commit;
- standalone typecheck and lint gates are not green;
- the browser acceptance path and current-tree live acceptance were not run;
- Phase 10 is marked implemented even though its planned acceptance tests are
  missing and the new protocol code has correctness and security defects.

Accurate current label: **file-video baseline preserved; RTSP localhost MVP
implemented and previously demonstrated; live-video release and Phase 10 not
complete.**

## Current-run verification

| Check | Result | Evidence |
| --- | --- | --- |
| Unit suite | PASS | `yarn test`: 46 files, 225 tests passed |
| Production build | PASS | `yarn build`: compiled, type-checked production sources, generated 18 static pages, and emitted all live routes |
| Standalone TypeScript | FAIL | `yarn tsc --noEmit --pretty false`: 36 diagnostics in test sources, including missing `NODE_ENV`, stale media-result fixtures, and a tuple-index error |
| Lint | FAIL / not configured | `CI=1 yarn lint` opened Next.js's interactive ESLint setup and exited 1 |
| Diff whitespace | PASS | `git diff --check` |
| Compose parse | PASS | `docker compose config --quiet` |
| Local FFmpeg SRT capability | ABSENT | `ffmpeg -protocols` did not list `srt`; `ffmpeg -h protocol=srt` reported `Unknown protocol 'srt'` |
| Fresh RTSP application/soak run | NOT RUN | Review-only run; no external Elastic or MediaMTX state was changed |
| HLS/SRT/WHIP integration and remote soak | NOT RUN | No current evidence artifact exists for these protocols |
| Browser E2E | NOT RUN | No Playwright dependency or browser suite exists |

Pre-review identity: branch `live-video-search`, HEAD
`78d7e569edc3f975e1b96199d14bf0a87c93a15a`, dirty, repository-reported
`content_hash=142a088c1ea2998f`. `video-file-search` and local `main` still point to
the same commit; `origin/main` points to `a0316a9`.

## Completion matrix

| Scope | Result | Basis |
| --- | --- | --- |
| Preserved file-video search | Complete at the committed baseline | Historical archived evidence; not re-run against the external service in this review |
| Live RTSP implementation | Substantially implemented | API, worker, capture, embedding, indexing, search, media, recovery, and UI code exists |
| Live RTSP release artifact | Not complete | Live implementation is uncommitted; browser/type/lint gates remain open |
| HLS pull | Not correctly complete | Unit adapter exists, but dynamic playlist policy, TLS/host routing, signed URLs, and authenticated validation are defective |
| SRT caller | Adapter scaffold only | Capability-gated code exists; no capable current host or real integration evidence |
| SRT listener | Not correctly complete | Configured peer allowlist validates the listener URL address, not the connected peer |
| WHIP/browser camera | Gateway sketch only | Worker is an RTSP alias; browser publishing/auth/network workflow is not implemented or accepted |
| Shared-network/production use | Not ready | Authentication, container hardening, finite-cap behavior, and real media discontinuity handling remain deferred |

## Adversarial findings

### A-01 — The branch does not contain the reviewed live implementation

- **Location:** repository state; HEAD `78d7e56`; `git status --short`
- **Trigger condition:** A clone, CI run, deployment, or handoff checks out
  `live-video-search`.
- **Guard:** Commit the reviewed source and documentation, then rerun mandatory
  acceptance against that clean revision.
- **Potential consequence:** The named branch reproduces only the file-video
  baseline, not the application reviewed here.

### A-02 — HLS allow-policy enforcement stops after one playlist snapshot

- **Location:** `lib/live/hls-playlist.ts:166-224`;
  `lib/live/adapters/hls.ts:137-142`
- **Trigger condition:** A master playlist refers to a child playlist, a media
  playlist rotates to a new segment/key, or a referenced URL redirects after
  the preflight fetch.
- **Guard:** Put all HLS fetching behind a policy-enforcing gateway/proxy, or
  recursively fetch and rewrite every playlist and continuously revalidate
  every refreshed URI/redirect before FFmpeg can open it.
- **Potential consequence:** FFmpeg can make HTTP(S) requests that were never
  checked against `LIVE_ALLOWED_HOSTS`, ports, or resolved-address policy.

The current code parses one fetched body and validates the destinations it sees,
then gives FFmpeg the original HTTP(S) capability. It neither fetches nested
playlists nor mediates subsequent live playlist reloads.

### A-03 — Literal-IP HLS binding breaks normal HTTPS and virtual-host routing

- **Location:** `lib/live/hls-playlist.ts:74-84,124`;
  `lib/live/source-url.ts:155-167`; `lib/live/adapters/hls.ts:137-142`
- **Trigger condition:** An allowlisted HLS source uses an ordinary hostname,
  TLS certificate, SNI, or HTTP virtual host.
- **Guard:** Use a transport that pins the resolved address while preserving the
  original TLS server name and HTTP Host header, or enforce egress in a trusted
  gateway without rewriting application-layer identity.
- **Potential consequence:** Certificate validation or routing fails even for a
  valid allowlisted stream; operators are pushed toward insecure IP endpoints.

### A-04 — URL reconstruction drops all query parameters

- **Location:** `lib/live/source-url.ts:128-147,155-167`
- **Trigger condition:** RTSP, HLS, or SRT uses a signed token or required input
  option in the query string.
- **Guard:** Preserve a validated query in the private connection URL while
  continuing to omit it from public provenance and logs.
- **Potential consequence:** Common expiring/signed HLS URLs and camera URLs
  validate structurally but fail when the worker connects.

### A-05 — Authenticated HLS fails during the credential-free preflight

- **Location:** `lib/live/hls-playlist.ts:80-84`;
  `lib/live/adapters/hls.ts:88-92,139-142`
- **Trigger condition:** The playlist itself requires Basic-style username and
  password credentials supplied through the structured secret.
- **Guard:** Perform the policy fetch with a private authenticated request whose
  credentials are never logged, and define safe redirect credential behavior.
- **Potential consequence:** The adapter advertises username/password support
  but marks valid protected streams failed before FFmpeg starts.

### A-06 — SRT listener “peer admission” checks the bind endpoint, not the peer

- **Location:** `lib/live/adapters/srt.ts:97-130`
- **Trigger condition:** `transport: listener` accepts an incoming SRT
  publisher.
- **Guard:** Bind only to an approved local interface and enforce the actual
  remote peer at the gateway/firewall or through an SRT accept callback that can
  observe peer identity; do not call the listener address a peer.
- **Potential consequence:** The promised peer allowlist is not an admission
  control. Depending on the URL, legitimate listeners can be rejected while an
  unapproved publisher is not evaluated.

### A-07 — SRT passphrases are neither validated nor safely encoded in ffconcat

- **Location:** `lib/live/connection-ref.ts:75-85`;
  `lib/live/adapters/srt.ts:152-159`; `lib/live/source-adapter.ts:120-135`
- **Trigger condition:** A passphrase has an unsupported length or contains a
  newline/ffconcat-significant content.
- **Guard:** Enforce the SRT library's passphrase contract and reject control
  characters; use an encoding/transport that cannot introduce additional
  ffconcat directives.
- **Potential consequence:** Real SRT connections fail despite a green unit
  test, or untrusted secret content changes the private FFmpeg input script.

The checked unit fixture uses `srt-pass`, but no real SRT process consumes it.

### A-08 — Source PATCH accepts transports incompatible with the protocol

- **Location:** `app/api/live/sources/[sourceId]/route.ts:10-18`;
  `lib/live/control-service.ts:180-218`
- **Trigger condition:** A client changes an RTSP, HLS, or WHIP source to
  `caller`/`listener`/`udp`, or changes an SRT source to `tcp`.
- **Guard:** Apply the same `transportsForProtocol` validation used by
  `createSource` before persisting a patch.
- **Potential consequence:** The API stores a configuration that source
  creation would reject; validation/session fingerprints can disagree and the
  later capture fails asynchronously.

### A-09 — Almost every FFmpeg exit code 1 becomes an endless reconnect

- **Location:** `lib/live/adapters/shared.ts:27-48`;
  `lib/live/adapters/rtsp.ts:216-233`;
  `lib/live/session-supervisor.ts:409-452`
- **Trigger condition:** FFmpeg returns its common code 1 for a bad codec,
  malformed input, unsupported option/protocol, or persistent authentication
  failure.
- **Guard:** Classify known transient network failures narrowly, treat known
  configuration/auth/media failures as terminal, and add a total retry/time
  budget with a durable `retry_exhausted` outcome.
- **Potential consequence:** A permanently invalid source remains degraded and
  reconnects forever, consuming resources and obscuring the actual failure.

### A-10 — Partial delete-by-query success can delete media for surviving docs

- **Location:** `lib/live/age-delete.ts:263-288,434-448`
- **Trigger condition:** Elasticsearch returns a response with fewer `deleted`
  documents than requested because of conflicts, failures, races, or missing
  documents.
- **Guard:** Inspect failures/version conflicts and determine exactly which
  chunk documents are absent before adding their IDs to the media-reclaim set;
  alternatively use per-document versioned deletes or a durable tombstone flow.
- **Potential consequence:** A searchable document can survive while its clip
  and thumbnail are removed.

### A-11 — Age-delete combines a large single delete request with partial execution

- **Location:** `lib/live/age-delete.ts:183-242,263-287,408-436`
- **Trigger condition:** More than the safety cap matches, or tens of thousands
  of IDs share a backing index.
- **Guard:** Refuse all mutation when traversal truncates unless a stable
  continuation job is recorded; delete in bounded batches and expose resumable
  progress.
- **Potential consequence:** The operation reports an error after deleting only
  the first portion, and a single IDs query can exceed practical request/terms
  limits.

### A-12 — Protect ranges have a create/delete race with age-delete

- **Location:** `lib/live/age-delete.ts:384-424`;
  `lib/live/protect-range-repository.ts:93-149`
- **Trigger condition:** An operator creates a protect range after age-delete
  reads ranges but before it deletes matching documents.
- **Guard:** Serialize destructive jobs and protect mutations, or use an
  Elasticsearch-side transactional/job protocol that rechecks protection at
  delete time.
- **Potential consequence:** Data explicitly protected during a running cleanup
  can still be permanently deleted.

### A-13 — Application E2E cleanup evidence is optimistic and incomplete

- **Location:** `scripts/live-app-path-e2e.ts:309-339,660-665`
- **Trigger condition:** Stop/disable returns a non-success response, cleanup is
  interrupted by SIGINT, or the run created chunks/events/query handles.
- **Guard:** Check every cleanup response, wait for terminal state, report actual
  outcomes, and remove or uniquely expire all run-created data. Invoke cleanup
  on signal through an awaited shutdown path.
- **Potential consequence:** A manifest claims sessions were stopped and the
  source disabled even when best-effort calls failed; Elastic data remains and
  a later worker may resume stale desired-running state.

### A-14 — Strict readiness does not enforce all documented completion gates

- **Location:** `lib/live/readiness-gates.ts:18-30`;
  `docs/live-video-operations.md:273-282`
- **Trigger condition:** The strict aggregate runs without browser E2E,
  application-path E2E, standalone typecheck, or lint.
- **Guard:** Make each documented mandatory gate a named aggregate member and
  require exactly PASS on one clean revision.
- **Potential consequence:** `READY_STRICT` can succeed while the repository's
  own completion conditions remain NOT RUN or FAIL.

### A-15 — Phase 10 checkmarks do not satisfy the Phase 10 acceptance contract

- **Location:** `plan/01-live-video-search-implementation-plan.md:449-466`;
  `todo/01-live-video-search-todo.md:236-253`;
  `lib/live/protocol-extensions.test.ts`
- **Trigger condition:** The TODO's HLS/SRT/WHIP checkmarks are interpreted as
  completed adapters.
- **Guard:** Add the planned protocol-specific disconnect, timestamp,
  authentication, redaction, capability-image, gateway, and remote-network
  acceptance runs; keep each protocol open until its evidence is current.
- **Potential consequence:** Eight mocked/offline tests are treated as proof of
  three live transport implementations.

### A-16 — The optional WHIP profile grants anonymous publish and API access

- **Location:** `test/fixtures/live/mediamtx-phase10.example.yml:23-35`
- **Trigger condition:** An operator copies the Phase 10 example onto a
  reachable gateway as the docs suggest.
- **Guard:** Supply a locked-down example with explicit non-placeholder
  publisher/read/API identities, bind management locally, and document secret
  injection without committing credentials.
- **Potential consequence:** Any reachable client can publish/replace the camera
  path and invoke the MediaMTX API.

### A-17 — HLS capability probing exists but is not enforced

- **Location:** `lib/live/worker-capability-probe.ts:134-145`;
  `lib/live/adapters/registry.ts:73-126`
- **Trigger condition:** HLS is enabled in a worker image without the required
  protocol/demuxer surface.
- **Guard:** Gate HLS validation/capture with `manifestSupportsHls`, as SRT is
  gated, and test the actual worker image manifest.
- **Potential consequence:** A source becomes ready and then enters the capture
  retry loop on a worker that cannot open it.

### A-18 — The worker container is still unpinned and runs as root

- **Location:** `worker/Dockerfile:1-29`; `worker/live-worker.ts:64-76`;
  `docs/live-video-operations.md:194-195`
- **Trigger condition:** The image is rebuilt or a hostile/corrupt media stream
  exploits FFmpeg.
- **Guard:** Pin the base and FFmpeg by digest/version, use a non-root runtime,
  drop capabilities, make application files read-only, and require a real image
  digest instead of publishing `unpinned`.
- **Potential consequence:** Builds drift and a media parser receives more
  privileges than the documented design allows.

### A-19 — Dirty evidence hashing includes volatile and review-generated files

- **Location:** `scripts/worktree-identity.ts:19-56`; `.gitignore:13-54`
- **Trigger condition:** `tmp/`, old review artifacts, or runner-generated
  manifests are untracked when acceptance starts.
- **Guard:** Prefer a clean commit. If dirty evidence must be supported, define a
  reviewed inclusion manifest and store an immutable patch/archive digest
  outside the hashed tree.
- **Potential consequence:** The hash changes for irrelevant cache/evidence
  bytes and cannot serve as a practical source identity. At review time,
  untracked content included about 3.9 MB, including a 2.3 MB V8 cache blob.

### A-20 — Known runtime limits remain explicitly deferred

- **Location:** `todo/01-live-video-search-todo.md:271`;
  `docs/live-video-operations.md:205-219`;
  `lib/live/session-supervisor.ts:578-695`
- **Trigger condition:** A real source changes codec/audio/timestamps or an
  operator configures finite retained-media caps.
- **Guard:** Probe actual finalized fragments/PTS and open epochs on signature
  changes; implement and acceptance-test retained-media eviction/reconciliation.
- **Potential consequence:** Windows can cross media discontinuities, while a
  configured cap can stop/drop work without reclaiming retained bytes.

## Edge-case Hunter findings

| Location | Trigger condition | Guard | Potential consequence |
| --- | --- | --- | --- |
| `lib/live/hls-playlist.ts:172-218` | Master playlist points to another playlist | Recursively fetch/rewrite playlist graph | Child segments bypass validation |
| `lib/live/hls-playlist.ts:172-224` | Live playlist adds a new key/segment after preflight | Mediate every reload | Later destinations bypass policy |
| `lib/live/source-url.ts:128-167` | Source relies on `?token=` or SRT URL options | Preserve private validated query | Valid stream cannot connect |
| `lib/live/adapters/srt.ts:122-130` | Listener binds a local wildcard/address | Separate bind policy from remote-peer admission | Listener fails or admits wrong peer |
| `lib/live/source-adapter.ts:125-129` | Passphrase contains newline | Reject controls/encode values | ffconcat directive injection |
| `lib/live/control-service.ts:180-218` | Existing WHIP source patched to `udp` | Reuse create-time transport validation | Later fingerprint/capture failure |
| `lib/live/age-delete.ts:271-281` | DBQ says `deleted < ids.length` | Verify absent IDs before unlink | Media removed for surviving docs |
| `lib/live/age-delete.ts:408-436` | Candidate cap is exceeded | Stop before mutation or persist continuation | Partial destructive cleanup |
| `scripts/live-app-path-e2e.ts:312-339` | SIGINT after session creation | Await cleanup before exit | Desired-running test session remains |
| `scripts/worktree-identity.ts:35-49` | Generated manifest or cache exists under untracked path | Explicit source inclusion set | Evidence identity depends on noise |

## Verification Gap findings

### V-01 — Phase 10 tests never run a real protocol

`lib/live/protocol-extensions.test.ts` injects DNS/fetch stubs and inspects
ffconcat text. It does not start FFmpeg, MediaMTX, an HLS server, an SRT peer, or
a WHIP publisher. The current host has no SRT FFmpeg protocol. Add real
containerized protocol tests and a remote-network acceptance manifest.

### V-02 — HLS security tests omit the dynamic graph

No test covers a master-to-media playlist, a playlist refresh, segment/key
redirects, hostname TLS/SNI, virtual-host routing, signed queries, or protected
playlists. Those cases are exactly where the current preflight model fails.

### V-03 — SRT tests do not verify caller/listener behavior

The test checks generated text and stubbed addresses only. It never verifies
passphrase bounds, actual listener peer admission, disconnect classification,
timestamps, or a capability-positive worker image.

### V-04 — WHIP has no browser or publisher test

The worker adapter only verifies that an internal URL is RTSP. No test publishes
from a browser, exercises WHIP signaling/auth/TLS/CORS/ICE, replaces a
publisher, or proves the normalized feed reaches search.

### V-05 — Destructive cleanup tests omit partial Elasticsearch responses

Age-delete tests cover complete success, paging, protection, and total
delete failure. They do not simulate a successful response with conflicts,
failures, or `deleted < requested`, nor protection created during a run.

### V-06 — The green build excludes failing test-source type contracts

Next's production build passed, while the standalone compiler reported 36
diagnostics. Add a nonincremental `typecheck` command to the required checks and
repair the test fixtures rather than treating the production build as full-tree
type safety.

### V-07 — Browser completion remains unenforced

The operations document correctly says Playwright is NOT RUN, but the strict
gate list omits it. Add the suite and aggregate gate before changing the
completion verdict.

### V-08 — Cleanup reporting has no assertions

The application E2E records requested IDs as cleaned without checking response
status or terminal state. Add machine-verifiable cleanup results and a
postcondition query for zero active run-owned resources.

## Structure and prose findings

The document hierarchy does not expose one authoritative current status:

- `README.md:10-15` says Phase 10 is next and the 10-minute soak is outstanding;
- `reviews/live-video-batch5-residuals-2026-09-13.md:3-9,68` says Phase 10 is
  closed/deferred;
- `todo/01-live-video-search-todo.md:236-253` says Phase 10 is open and its three
  adapters are done;
- `plan/01-live-video-search-implementation-plan.md:460-466` still requires
  acceptance evidence that has not been produced.

Use one status block generated from the TODO/evidence manifest, and make older
review reports explicitly historical rather than letting their present-tense
verdicts compete. Several statements also overclaim implementation: “segment
and key re-validation” implies continuous enforcement, “peer admission” implies
inspection of a connected SRT peer, and “WHIP adapter” sounds like the app
implements WHIP even though it only subscribes to RTSP after an external gateway.

## What is complete enough to preserve

- File-video search remains isolated at the committed baseline.
- RTSP source/session/API/worker/search/media/UI implementation exists and has a
  substantial unit suite.
- Current unit, production build, Compose parse, and diff checks pass.
- Batch 5's basic traversal, dry-run counters, ES-before-media ordering,
  loopback bind, and untracked-byte hashing changes are present.
- Phase 10 protocols are opt-in and RTSP remains the default.

## Required updates before a completion claim

1. Commit the live implementation and run all evidence against that clean
   revision.
2. Fix full-tree typecheck and configure noninteractive lint.
3. Fix the HLS policy architecture, literal-IP/TLS/query/auth behavior, then add
   dynamic and real-stream tests.
4. Redesign SRT listener peer admission and passphrase handling, then validate
   caller/listener on an SRT-capable worker image.
5. Lock down and actually exercise WHIP publishing, including browser and remote
   network behavior.
6. Repair PATCH transport validation, capture exit/retry exhaustion, and
   age-delete partial-success/race semantics.
7. Add browser/application/type/lint/protocol-extension gates to one strict
   acceptance manifest.
8. Synchronize README, plan, TODO, operations, and review index with the same
   evidence-backed status.

## Review boundary

This was a read-only implementation review except for this review report, its
machine-readable companion, and the review index. It did not modify application
code, archive/delete files, run the external Elastic workflow, or start remote
media services.
