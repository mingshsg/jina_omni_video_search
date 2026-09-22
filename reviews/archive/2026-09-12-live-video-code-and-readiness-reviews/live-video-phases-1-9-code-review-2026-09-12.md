# Live Video Search — Phases 1–9 Code Review

**Date:** 2026-09-12  
**Scope:** `lib/live/**`, `worker/**`, `app/live/**`, `app/api/live/**`, `components/live/**`, live scripts, and live-touching related edits.  
**Tests run:** `yarn vitest run lib/live worker lib/es/search-core.test.ts lib/media/prepare-finite-media.test.ts lib/ingest/ip-guard-extended.test.ts` → **31 files / 129 tests passed**.  
**Product decisions assumed:** retention forever until explicit delete; unlimited spool; single stream/worker/web MVP; localhost allowlist incl. 8554; WHIP deferred.

---

## 1. Overall verdict

Phases 1–9 form a coherent RTSP MVP: secret surfaces are split, allowlisting/DNS bind-URL defenses are real, spool ownership and optimistic control docs are mostly sound, and unit coverage is strong for security and queue mechanics. **Not yet ready to treat as production-hard or to start Phase 10 adapters without fixing several runtime correctness gaps**—especially capture reconnect, health-field races that erase `windows_searchable`, and credential-in-argv exposure. Controlled fixture demos remain viable with known caveats (short soak / no Playwright already noted in Phase 9 readiness).

---

## 2. Findings by severity

### Critical

_None that fully break the happy-path fixture under single-process MVP assumptions. Closest items are filed as High._

### High

#### H1. Capture disconnect never auto-reconnects
- **Status:** **Fixed 2026-09-12** — unexpected exit schedules capped backoff, re-resolves source, bumps epoch, and calls `startCapture` again.
- **Where:** `lib/live/session-supervisor.ts` ~257–280; `lib/live/worker-loop.ts` ~100–121; reconnect helper unused in path (`lib/live/process-supervisor.ts` ~202–210).
- **Why:** On unexpected FFmpeg exit the runtime sets `observed_state=degraded` and increments `reconnect_count`, with a comment that the “caller may restart.” `LiveWorkerLoop` keeps the runtime in `runtimes` and, while `runtimes.size >= 1`, refuses to start another capture. There is no restart/`startCapture` retry loop. Session stays degraded until operator stop/start.
- **Fix:** After capped backoff (`nextReconnectDelayMs`), re-resolve connection_ref + destination policy and call `startCapture` again (bumping epoch per SPEC); or tear down the runtime so the poller can recreate it. Cover with a unit/integration test that simulates supervisor exit.

#### H2. `publishHealth` overwrites indexer-owned `windows_searchable`
- **Status:** **Fixed 2026-09-12** — supervisor patches omit `windows_searchable`; worker merge deep-merges health.
- **Where:** `lib/live/session-supervisor.ts` `publishHealth` ~508–528; `lib/live/indexer.ts` `publishSearchableEvent` ~223–239; merge is full-object replace in `lib/live/ownership.ts` `mergeSessionWorkerPatch` ~151–172.
- **Why:** Local `SessionRuntime.health.windows_searchable` stays `0` (never incremented). Indexer increments the ES counter, then fragment polling periodically writes the entire local `health` blob and **resets searchable counts (and can clobber other indexer updates)**. UI/API lag and searchable counters become wrong under load.
- **Fix:** Split health ownership (queue/spool/reconnect local vs searchable/indexing from indexer), or read-merge-write: preserve `windows_searchable` / `last_searchable_at` unless the writer owns them. Add a race test: index then `publishHealth` must not drop the counter.

#### H3. RTSP credentials placed on FFmpeg argv
- **Status:** **Fixed 2026-09-12** — credentials go in mode-0600 ffconcat; argv references script path only. Residual: same-UID can read the private script while capture runs.
- **Where:** `lib/live/source-adapter.ts` `buildAuthenticatedUrl` ~63–71; `lib/live/adapters/rtsp.ts` `buildFfmpegInput` ~166–173; spawned in `lib/live/process-supervisor.ts` ~83–89.
- **Why:** Username/password are embedded in the `-i` URL. That is visible to any local `ps`/audit tooling despite “memory only; never log” intent. Stderr redaction does not protect argv.
- **Fix:** Prefer FFmpeg auth options that avoid argv secrets (e.g. AVOption / headers file with `0600`, or RTSP with separate credential plumbing). At minimum document as host-trust requirement and avoid multi-tenant hosts.

#### H4. Source claim not cleared on terminal stop; same idempotency key returns a dead session
- **Status:** **Fixed 2026-09-12** — terminal stop/onTerminal clears claim; create rejects terminal/stopped sessions for the same idempotency key.
- **Where:** `lib/live/session-supervisor.ts` `stop` ~531–564; claim clear only in `worker-loop` bootstrap + `control-service` create path ~248–263, ~284–295; `lib/live/source-repository.ts` `clearActiveSessionClaim` ~248–275.
- **Why:** After stop/fail, `active_session_id` often remains until bootstrap or a *different* create clears a terminal leftover. Retrying **the same** `idempotency_key` finds the existing terminal session and returns `202` with that document—worker skips terminals—so the client believes create/start succeeded while nothing runs. Conflicts with “starting again creates a new session.”
- **Fix:** On terminal transition, CAS-clear the claim. On create, if existing session is terminal, reject with a stable conflict / require new key (do not idempotent-succeed). Add control-service tests for stop → recreate same key and stop → new key.

### Medium

#### M1. `reserved_revision` reservation is not true CAS
- **Where:** `lib/live/indexer.ts` `reserveSearchableRevision` ~118–148 (comment claims CAS).
- **Why:** Revision is computed outside `withOptimisticRetry`; on conflict retry the **stale** `revision` is rewritten. Manifest `event_intent` is appended before the ES update. Today flushes are serialized in `LiveWindowProcessor.flushOneBatch`, so MVP is mostly safe; enabling parallel `LIVE_INDEX_MAX_IN_FLIGHT_BATCHES` without fixing this will duplicate revisions / gap SSE.
- **Fix:** Compute `revision = current.reserved_revision + 1` **inside** the optimistic retry; only append `event_intent` after a successful CAS (or use a per-session mutex).

#### M2. Manifest never writes `window_processed`
- **Where:** SPEC/`docs/live-video-state-recovery.md` window publication steps; type exists in `lib/live/fragment-manifest.ts`; **no producer** outside tests.
- **Why:** Crash after embed but before index cannot recover an immutable processed draft from the manifest; work is re-inferred. Recovery matrix is incomplete vs normative docs.
- **Fix:** After successful `prepareFiniteMedia` / chunk draft build, append `window_processed` with checksums before enqueue to index-ack.

#### M3. Chunk `media_sha256` left as `sha256:unknown`
- **Where:** `lib/live/live-chunk-builder.ts` ~81; `lib/live/embed-window.ts` does not pass remux/file hash into `LiveWindowEmbedContext`.
- **Why:** Immutable fingerprint ignores real media bytes; duplicate/conflict detection is weaker than the plan’s fingerprint story.
- **Fix:** Hash the remuxed MP4 in finalize/embed and pass `media_sha256` into `buildLiveChunkDocument`.

#### M4. Thumbnails remain under `tmp/`
- **Where:** `lib/live/embed-window.ts` ~110; `lib/live/serve-media.ts` candidates ~26–28.
- **Why:** Serving falls back to `tmp/`, but any tmp cleanup or incomplete promotion breaks thumbs while clips live in `media/`. Opaque `thumb_ref` is unused for path resolution.
- **Fix:** Atomically move/copy thumb into `media/${chunkId}.thumb.jpg` before indexing; resolve only under `media/`.

#### M5. `patchSource` connection change is two non-atomic updates
- **Where:** `lib/live/control-service.ts` `patchSource` ~180–202.
- **Why:** API fields update first; worker validation reset is a second write. A worker validation poll can interleave and briefly publish `ready` provenance for the new ref, then get cleared—or leave inconsistent revision/validation pairs under contention.
- **Fix:** Single optimistic transaction that bumps revision and resets worker fields together (extend `updateApiFields` / merge path—which already resets on connection change in `mergeSourceApiPatch`).

#### M6. Session SSE poll intervals can overlap
- **Where:** `app/api/live/sessions/[sessionId]/events/route.ts` ~156–182.
- **Why:** `setInterval` fires async work without an in-flight guard (unlike follow-search’s `evaluating` flag). Slow ES polls can reorder cursor advances and duplicate frames.
- **Fix:** Same single-flight pattern as follow-search events.

#### M7. Hardcoded `embedding.dims: 1024` on session create
- **Where:** `lib/live/control-service.ts` ~345–350 vs `deriveLiveVariantId` using `appCfg.EMBED_DIMS`.
- **Why:** If `EMBED_DIMS` ≠ 1024, session snapshot dims disagree with variant identity / provider asserts.
- **Fix:** Use `appCfg.EMBED_DIMS` (and keep indices/templates aligned).

#### M8. No authentication on live control/search/media APIs
- **Where:** all `app/api/live/**` routes; media by guessable `chunk_id` (`${sessionId}_${epoch}_${seq}`).
- **Why:** Acceptable for locked-down demo hosts; unsafe on any shared network. Chunk IDs are structured, not high-entropy.
- **Fix:** Before any non-localhost deploy: session auth, signed media URLs, or network policy; consider opaque media tokens for serve paths.

#### M9. RTSP nested protocol whitelist includes `file` / `http` / `https`
- **Where:** `lib/live/adapters/rtsp.ts` `RTSP_PROTOCOL_WHITELIST` ~28–39.
- **Why:** Architecture called for an explicit nested whitelist; including `file` increases blast radius if a malicious/compromised RTSP peer redirects. Localhost allowlist mitigates MVP SSRF but not local file read via nested protocols.
- **Fix:** Drop `file` unless a fixture proves it is required; keep the minimal set FFmpeg needs for RTSP/TCP/RTP.

#### M10. API contract sample still shows age-based retention
- **Where:** `docs/live-video-api-contract.md` session create example ~100–104 (`clip_hours` / `thumbnail_hours`: 24) vs code `retention: { mode: 'until_explicit_delete' }` and product decision.
- **Why:** Operators/implementers can reintroduce age expiry against locked policy.
- **Fix:** Update the contract example and validation text to match forever-until-delete.

### Low

#### L1. Follow handles / query cache / rate limits are process-local
- Documented (`LIVE_QUERY_EXPIRED`); web restart drops follow SSE. Fine for one-web MVP; call out in ops docs for Phase 10 scale-out.

#### L2. `sanitizeLiveText` path redaction is heuristic
- `lib/live/api-sanitize.ts` ~12–19 — incomplete absolute-path patterns; prefer never putting paths in `current_error.message` (map to stable codes only).

#### L3. Indexer seed fingerprint is synthetic
- `lib/live/indexer.ts` ~129 — `sha256:seed_${chunkId}_${revision}` does not bind to event body; weakens manifest audit vs SPEC seed fingerprint language.

#### L4. Opaque media refs unused for serving
- Minted in chunk docs; serve path uses deterministic filenames. Either wire refs or document them as future-facing only.

#### L5. Phase 9 gaps already acknowledged
- Full 10-minute soak and Playwright browser E2E not run (`reviews/live-rtsp-readiness-2026-09-11.md`). Still open.

---

## 3. What went well

- Clear web vs worker secret split (`env-surfaces`, `instrumentation.ts`, connection_ref JSON secrets).
- Destination policy + literal bind URL for DNS rebinding defense; solid RTSP security unit fixtures.
- Spool root lock, bounded queues with oldest-drop, optimistic concurrency on control indices.
- Shared `prepareFiniteMedia` / `executeChunkSearch` keeps file-video path intact.
- Fingerprint-aware chunk/event create with `refresh=wait_for` and follow-search vector co-expiry design.
- Compose `replicas: 1` for web/worker; bilingual error catalog; mutation body/rate limits.

---

## 4. Test gaps

| Gap | Risk |
| --- | --- |
| Capture exit → auto-reconnect / epoch bump | H1 |
| Indexer vs `publishHealth` health merge race | H2 |
| Stop → create same/new idempotency key + claim clear | H4 |
| Parallel index batches / reserved_revision CAS | M1 |
| Manifest `window_processed` recovery path | M2 |
| Real `media_sha256` in immutable fingerprint | M3 |
| Session SSE single-flight under slow polls | M6 |
| Browser E2E + 10-minute soak (already noted) | L5 |
| Authz / media IDOR on shared host | M8 |

Unit suite sampled above is green (129); it does not cover these integration races.

---

## 5. Suggested next steps

**Fixed 2026-09-12:** H1–H4 (reconnect, health-field ownership merge, ffconcat
credential channel, claim clear + terminal idempotency). See amendment below.

**Fix before Phase 10 (recommended):** M1–M4; M10 doc sync done with H-fix pass.  
**Acceptable to defer to production hardening / Phase 10 gate:** M8 auth, L1 multi-instance state, full soak + Playwright.  
**Do not start HLS/SRT/WHIP adapters** until a fresh readiness pass after H1–H4.

---

## Amendment — H1–H4 addressed (2026-09-12)

| ID | Fix summary |
| --- | --- |
| H1 | Unexpected FFmpeg exit → capped backoff → re-resolve + `startCapture` with epoch bump (`session-supervisor` + `resolveSource` hook). |
| H2 | Supervisor health patches omit `windows_searchable`; `mergeSessionWorkerPatch` deep-merges health. |
| H3 | Auth URL written to mode-0600 `private/ffmpeg-input.ffconcat`; argv uses concat demuxer only. Residual: same-UID can read the script while capture runs; host-trust required. |
| H4 | Terminal transitions clear source claim; create with same idempotency key on stopped/failed session returns `LIVE_SESSION_CONFLICT`. |

Tests added/updated: `session-supervisor.test.ts`, `ownership.test.ts`, `control-service.test.ts`, `worker-loop.test.ts`, `rtsp-security.test.ts`.

---

## Traceability notes

| Area | Status vs plan/SPEC |
| --- | --- |
| Forever retention / unlimited spool defaults | Implemented in config + indices |
| Single stream/worker/web | Enforced in loop + compose |
| Localhost + 554/8554 | Config + policy |
| Outbox reserve → chunk → searchable → publish | Present; reservation CAS incomplete |
| Reconnect + DNS re-validation | Policy exists; **runtime reconnect missing** |
| `window_processed` oracle | **Not written** |
