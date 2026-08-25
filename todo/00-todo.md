# TODO

Status legend: `[ ]` not started, `[~]` in progress, `[x]` done, `[-]` cancelled.
Last updated: 2026-08-25, after the second readiness review, the plan
consolidation, and the EUI stack decision. No application code started yet.

Each phase carries an acceptance criterion so completion is verifiable rather
than declared.

Single authoritative plan:
[plan/00-implementation-plan.md](../plan/00-implementation-plan.md).
Requirements: [requirements/01-interpreted-requirements.md](../requirements/01-interpreted-requirements.md).

## Phase 0: planning and documentation

- [x] Confirm technical facts about `jina-embeddings-v5-omni-small` on Elastic
      (endpoint id, input shape, 32-frame sampling, dimensions)
- [~] **Resolve the binary input size limit question.** Partially done and
      previously recorded incorrectly. Verified: Serverless is fixed at 1 MB;
      images 5 MB; PDFs 8 MB; the airgap server constant is 10 MB. **Still
      unknown: the hosted Jina video and audio ceiling** — the live OpenAPI
      declares no size or duration constraint, so it must be measured in
      Phase 2 (OQ2). The earlier "10 MB is the direct Jina API limit" claim was
      wrong and has been corrected.
- [x] Collect decisions from the user: stack, provider, proxy strategy, storage,
      UI language, chunk granularity
- [x] Write `requirements/00-original-request.md`
- [x] Write `requirements/01-interpreted-requirements.md`
- [x] Write the implementation plan
- [x] Write `todo/00-todo.md`
- [x] Write `chn.docs/架构与数据流.md` Chinese architecture and data-flow document
- [x] Review the first readiness review and fold its valid findings back in
- [x] Investigate the sibling `jina-on-prem`, `jina-airgap`, and `onnx_jina`
      projects for reusable groundwork
- [x] Download related Elastic / Jina / arXiv documents into `reference/`
- [x] Review `reviews/current-readiness-review-2026-08-25.md` and respond in
      `reviews/review-response-2026-08-25b.md` (10 of 11 findings accepted; P0-3
      accepted in reasoning, rejected in data)
- [x] Add the missing retriever references:
      `reference/elastic-rrf-retriever.md`, `reference/elastic-knn-retriever.md`
- [x] Verify and record the EUI adoption constraints in
      `reference/elastic-eui-constraints.md`
- [x] Consolidate every plan fragment into the single
      `plan/00-implementation-plan.md`
- [x] Initialise the Git repository (`main`)
- [x] Update `reference/constraints-cheat-sheet.md` and `reference/00-index.md`
- [ ] Sync `requirements/01-interpreted-requirements.md` with the accepted review
      findings: rewrite C1 per-provider, add C3 (version matrix, task adapters,
      normalization ownership, no video truncation), rewrite FR-8 / FR-9 / FR-12
      / FR-13, harden FR-2, add FR-19 variant identity, FR-20 job state machine,
      FR-21 search response contract, and restate OQ1-OQ3
- [ ] Sync `chn.docs/架构与数据流.md`: variant identity, version matrix, provider
      isolation, fusion trade-off, EUI interface stack
- [ ] Write `docs/data-model.md` with **executable Elasticsearch mapping JSON**
      (not prose), including the variant field (**required before Phase 3**)
- [ ] Write `docs/api-contract.md` with the SSE event schema and the job state
      machine (**required before Phases 6-8**)
- [ ] Write `docs/architecture.md`, `docs/data-flow.md`, `docs/ui-mockup.md`
- [ ] Create `docs/operations.md` with measured fields explicitly marked pending
      until Phase 2
- [-] Add the `hive-mind` submodule for Elastic's internal EUI and Next.js
      patterns. **Blocked:** the repository is private and the clone failed
      without credentials. The EUI approach was derived from public sources
      instead. Revisit if credentials become available.

**Acceptance:** a reader who has never seen this project can, from these
documents alone, state what is being built, why the byte budget shapes the
design, which limits are measured versus unknown, and what the first three
implementation steps are.

## Phase 1: project scaffolding

- [ ] Write `.gitignore` excluding `.env` and `data/` **before the first commit**
- [ ] Commit the documentation baseline
- [ ] Initialise Next.js 16 with TypeScript, pinning **React 18** (EUI peer
      range; Next.js 16 accepts `^18.2.0`)
- [ ] Use **yarn**, not npm — EUI does not support npm
- [ ] Install EUI and its peers: `@elastic/eui @elastic/eui-theme-borealis
      @elastic/datemath @emotion/react @emotion/css moment`
- [ ] Implement the client-side EUI provider: `'use client'` wrapper with
      `EuiProvider`, `@emotion/cache`, and `useServerInsertedHTML`
- [ ] Confirm no Tailwind is present anywhere in the project
- [ ] Write `.env.example` covering every variable in the plan
- [ ] Implement `lib/config.ts` with zod validation that fails fast, including a
      clean "not configured" path for `LOCAL_IMPORT_ROOT`
- [ ] Create the `data/` subdirectory structure (originals, playback, proxies,
      thumbs, uploads)
- [ ] Write the README: prerequisites (Node 22, ffmpeg 8 on `PATH`, **yarn**),
      setup, startup, and the deployment assumption from NFR-7

**Acceptance:** `yarn dev` serves a page rendering at least one EUI component
with Borealis styling and no hydration warning in the console; starting with a
deliberately malformed `.env` produces a clear error naming the offending
variable; `git status` shows neither `.env` nor `data/`.

## Phase 2: capability probe (blocks phases 4 to 8)

- [ ] Obtain Elastic Serverless URL and API key from the user, place in `.env`
- [ ] Implement `scripts/probe-capabilities.ts`
- [ ] **Discover or create** the `embedding` endpoint rather than assuming
      `.jina-embeddings-v5-omni-small` exists; document any live creation before
      applying it (NFR-6)
- [ ] Report the endpoint's id, task type, model, dimensions, and version
      availability, trusting the live endpoint over any version table
- [ ] Measure the real binary ceiling **per provider**, recording the exact
      payload size that first returns HTTP 400. Include a boundary above 1 MB
      for non-EIS providers (resolves OQ1 and OQ2)
- [ ] **Attempt to pass task settings to the EIS endpoint** and record whether
      they are accepted, rejected, or silently ignored (resolves OQ3)
- [ ] Exercise the **query side** via `query_vector_builder`, not only the
      ingest path
- [ ] Record per-modality latency and token usage, including the
      `image_tokens` / `audio_tokens` / `video_tokens` fields (feeds NFR-9 and
      the NFR-10 cost estimate)
- [ ] Write measured budgets **per provider** into `.env` and
      `docs/operations.md`

**Acceptance:** `docs/operations.md` states, for each configured provider, the
measured ceiling with the exact payload size that first returned HTTP 400,
alongside per-modality latency. OQ1, OQ2, and OQ3 are marked resolved in the
requirements document.

## Phase 3: Elasticsearch layer

- [ ] Write `docs/data-model.md` before applying anything to the live instance
      (NFR-6)
- [ ] Define `video-assets` mapping including the nested variants list
- [ ] Define `video-chunks` mapping with `variant_id` and two `dense_vector`
      fields (1024 dims, cosine, `bbq_hnsw`)
- [ ] Implement `lib/ingest/variant.ts` deriving `variant_id` from chunking
      config, provider, model, task, proxy settings, and `SCHEMA_VERSION`
- [ ] Implement `scripts/setup-indices.ts`, idempotent
- [ ] Implement `lib/es/client.ts` and `lib/es/index-chunks.ts` bulk upsert with
      `_id` = `{video_id}_{variant_id}_{chunk_index}`

**Acceptance:** running the setup script twice leaves the cluster unchanged the
second time; a hand-crafted chunk document round-trips and is retrievable by a
`knn` query filtered to its `variant_id`; ingesting two variants of the same
video leaves both intact with no overwritten or orphaned chunks.

## Phase 4: embedding providers

- [ ] Define the `EmbeddingProvider` interface in `lib/embed/provider.ts`,
      carrying model, task, dims, and normalization ownership
- [ ] Implement `eis.ts` against `_inference/embedding/{id}` (required)
- [ ] Implement `jina.ts` against `api.jina.ai/v1/embeddings`, **explicitly
      setting `task`** — the API default of `text-matching` is wrong for
      retrieval (optional, needs `JINA_API_KEY`)
- [ ] Implement `local.ts` against a self-hosted omni server's
      OpenAI-compatible `/v1/embeddings` (optional, see constraint C2)
- [ ] Add L2 normalisation where the provider does not already guarantee it
- [ ] Add exponential backoff with jitter for 429 and 503
- [ ] Add a concurrency gate honouring `EMBED_CONCURRENCY`
- [ ] Add per-modality token usage accounting
- [ ] Enforce the isolation policy: refuse to write a variant whose recorded
      provider, model, or task differs from the current configuration

**Acceptance:** a provider compatibility test runs text, video, and audio
fixtures through every configured provider and reports similarity per modality.
Failure does **not** block the build; it forces those providers into separate
variants. Mixing providers inside one variant is rejected with a clear error.

## Phase 5: ffmpeg layer

- [ ] `lib/video/probe.ts` wrapping ffprobe (duration, resolution, fps, codec,
      audio presence)
- [ ] `lib/video/plan-chunks.ts` pure window planner with the stride rule and
      short-remainder merge
- [ ] Unit tests for the window planner, including edge cases: video shorter
      than one window, exact multiples, sub-`CHUNK_MIN_MS` remainder
- [ ] `lib/video/proxy-encode.ts` budget-adaptive 32-frame visual encoder
      walking the resolution and CRF ladders
- [ ] Implement the ladder's **terminal behaviour**: 640x360 is a last-resort
      rung; if CRF 32 there still exceeds the budget, step the frame count down
      (32, 24, 16), then record `ladder_exhausted`, fail that window with a
      specific error code, and continue the job
- [ ] Audio proxy encoder (16 kHz mono Opus), skipped when no audio stream
- [ ] `lib/video/thumbnail.ts` middle-frame extraction
- [ ] `lib/video/playback.ts` 720p faststart proxy, skipped when unnecessary

**Acceptance:** every proxy produced from the test asset is at or under the
measured budget and the ladder rung used is recorded; a deliberately
impossible budget produces the defined terminal failure rather than a hang or a
silent skip. Encode time per window is **recorded and compared** against the
Phase 2 inference latency as a benchmark and optimisation trigger, not as a
pass/fail gate.

## Phase 6: import modes

- [ ] URL import: scheme check, DNS resolution with private and loopback
      rejection, **redirect-count limit with per-hop re-validation**, connection
      to the validated address while preserving the Host and TLS name,
      **stream-time byte enforcement**, request and idle timeouts, defined abort
      behaviour, and partial-file quarantine
- [ ] Local path import: absolute path required, `realpath` containment inside
      `LOCAL_IMPORT_ROOT`, regular-file and extension checks
- [ ] Upload import: streaming multipart to disk without buffering, size cap
- [ ] Shared post-validation via ffprobe with readable errors
- [ ] Stable error codes with a bilingual display mapping that never leaks
      credentials, filesystem paths, or upstream response bodies
- [ ] Unit tests for the validators

**Acceptance:** a URL resolving to loopback or a private range is refused; **a
URL that redirects to a private address is refused at the redirect hop**; **an
oversized chunked response with no content-length is aborted mid-stream and its
partial file quarantined**; a local path outside `LOCAL_IMPORT_ROOT` is refused,
including via symlink; a non-video file with a `.mp4` extension is refused by
the ffprobe check.

## Phase 7: pipeline and progress

- [ ] Write the job state machine into `docs/api-contract.md` before coding it
- [ ] `lib/ingest/job-store.ts` job state persisted to `video-assets`
- [ ] `lib/ingest/pipeline.ts` full sequence: probe, variant derivation,
      playback proxy, plan windows, encode proxies, embed both modalities,
      bulk upsert
- [ ] `api/jobs/[id]/stream` SSE progress endpoint
- [ ] Idempotent re-run behaviour verified (same `_id`, upsert not duplicate)
- [ ] Pre-import estimate of window count and inference calls surfaced before
      the user confirms (NFR-10)
- [ ] Report observed throughput in windows per minute on completion (NFR-9)

**Acceptance:** ingesting the same video and variant twice leaves the chunk
count unchanged. **Restart recovery is explicitly out of scope**; the guarantee
is that a manual retry after a failure is idempotent and does not duplicate
work. Failed windows are individually visible rather than aggregated into a
single opaque error.

## Phase 8: retrieval API

- [ ] `lib/es/search.ts` RRF fusion over `embedding_video` and `embedding_audio`
- [ ] Set `rank_window_size` explicitly (the default of 10 is too small) and
      keep it `>= size`
- [ ] Support per-retriever `weight` for asymmetric visual and audio influence
- [ ] Modality restriction (visual only, audio only, both) by dropping or
      keeping child retrievers
- [ ] Filter by `variant_id` and by video; adjustable top-k
- [ ] Provider-aware query vectors: `query_vector_builder` for EIS,
      application-computed `query_vector` with `task: retrieval.query` for Jina
      and local
- [ ] Implement the documented response contract, including per-modality
      rank/score recovery and the badge rule for chunks returned by both
      branches
- [ ] `api/search/route.ts` with zod-validated payload

**Acceptance:** a fixture of queries with **expected time ranges** returns the
correct chunk within top-k; a chunk retrieved by both branches is labelled
according to the documented rule; end-to-end search latency is reported as a
**warm p95 over repeated runs**, targeting under 2 seconds (NFR-9), not a single
timing.

## Phase 9: interface

- [ ] Import page: mode selector, per-mode form, client-side validation, live
      progress from SSE, pre-import cost estimate
- [ ] Library page: indexed videos, **variants per video**, status, chunk
      counts, re-index and remove actions
- [ ] Search page: query bar, modality toggle, variant selector, filters,
      result cards with thumbnail, `mm:ss` range, score, and modality badge
- [ ] Player: `api/media` source, seek to `start_ms` on result click
- [ ] Timeline strip marking all matching windows for the selected variant
- [ ] `api/media/[videoId]` with HTTP Range support (required for seeking)
- [ ] Bilingual strings for Chinese and English with a header switch
- [ ] All UI built from EUI components, rendered client-side

**Acceptance:** clicking a result begins playback within one second at the
chunk's start time, accurate to under a second; switching language leaves no
untranslated strings on any page; no EUI hydration or Emotion style warnings
appear in the console on any page.

## Phase 10: end-to-end verification

- [ ] Ingest the public-domain *Breakfast at Tiffany's* trailer (158 s) from the
      Internet Archive
- [ ] Run the standard 64 s / 4 s preset as one variant; record chunk count and
      encoder rungs used
- [ ] Run the fine 10 s / 2 s preset as a second variant; confirm both coexist
- [ ] Define a query fixture with **expected time ranges** on this corpus and
      measure time-range relevance and top-k success per variant
- [ ] Verify click-to-play seeks accurately for both variants
- [ ] Verify all three import modes end to end
- [ ] Record findings in `reviews/`

**Acceptance:** the preset comparison is quantified with the same metric on the
same local corpus. **Do not compare against Elastic's published scores** —
Elastic split this trailer into 28 PySceneDetect scenes of 1.9 to 18.4 seconds,
so raw scores over different candidate sets are not comparable.

## Phase 11: close-out

- [ ] Complete the `docs/` set with measured numbers
- [ ] Refresh the README with anything learned during implementation
- [ ] Mark this file complete
- [ ] Self-review in `reviews/` covering known limits: picture quality under the
      measured byte budget, temporal precision of 64-second windows, the
      client-only EUI rendering decision and any residual styling issues, and
      the `embedding` query vector builder's maturity

**Acceptance:** the `docs/` set contains no placeholder text, and every number
in it traces to a measurement rather than an estimate.

## Blocked / waiting on user

- [ ] **Elastic Serverless (search profile) endpoint URL and API key.** Required
      before Phase 2. If the project does not exist yet, creation steps will be
      documented in `docs/operations.md` for the user to run in the console.
- [ ] **Confirmation that the project may create an EIS inference endpoint** if
      the desired endpoint is not already available.
- [ ] Optional: `JINA_API_KEY`, only if the `jina` provider is wanted. Worth
      having, since the hosted video ceiling is unmeasured and may be the escape
      from the Serverless 1 MB cap.
- [ ] Optional: decision on whether to stand up the `local` provider. It needs
      Docker, roughly 8 GB of memory, and a weights download (about 3.5 GB), and
      is only worth it if the measured budget hurts retrieval quality, or as a
      zero-cost baseline.
- [-] `hive-mind` submodule access. Private repository; clone failed without
      credentials. Not blocking — the EUI approach uses public sources.
