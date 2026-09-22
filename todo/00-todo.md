# TODO

> **Scope:** completed file-video work. Active live-video planning and delivery
> is tracked in [`01-live-video-search-todo.md`](./01-live-video-search-todo.md).

Status legend: `[ ]` not started, `[~]` in progress, `[x]` done, `[-]` cancelled.
Last updated: 2026-09-04 — image-to-video search (`/search-image`).

Each phase carries an acceptance criterion so completion is verifiable rather
than declared.

Single authoritative plan:
[plan/00-implementation-plan.md](../plan/00-implementation-plan.md).
Requirements: [requirements/01-interpreted-requirements.md](../requirements/01-interpreted-requirements.md).

## Phase 0: planning and documentation

- [x] Confirm technical facts about `jina-embeddings-v5-omni-small` on Elastic
- [x] **Resolve the binary input size limit question (OQ1).** EIS direct
      `_inference/embedding` on ES 9.6 Serverless: no size 400 up to ~3.1 MB;
      operational budget **1 MB** in `.env` per Serverless docs. OQ2 (hosted
      Jina) still open without `JINA_API_KEY`.
- [x] Collect decisions from the user
- [x] Write `requirements/00-original-request.md` (verbatim; do not edit)
- [x] Write / sync `requirements/01-interpreted-requirements.md` (Round-4:
      C1/C3/C4, FR-2/8/9/12/13 rewrite, FR-19..22, NFR, OQ, decision log)
- [x] Write the consolidated implementation plan
- [x] Write `todo/00-todo.md`
- [x] Sync `chn.docs/架构与数据流.md`
- [x] Review rounds 1–4; responses in `reviews/` (never rewrite review files)
- [x] Download related documents into `reference/`
- [x] Update `reference/constraints-cheat-sheet.md`, `elastic-eui-constraints.md`
- [x] Consolidate plan; initialise Git; baseline commit `262412b`
- [x] Respond to Round 4 in `reviews/archive/2026-09-10-file-video-search/review-response-2026-08-25-r4.md`; correct
      false sync claim in `review-response-2026-08-25b.md` addendum
- [x] Write `docs/data-model.md` with **executable mapping JSON** (before Phase 3)
- [x] Write `docs/api-contract.md` with SSE schema and job state machine (before
      Phases 7–8)
- [x] Write `docs/architecture.md`, `docs/data-flow.md`, `docs/ui-mockup.md`
- [x] Create / refresh `docs/operations.md` (Phase 1 spike, Phase 2 probe,
      Phase 10 E2E measurements; measured vs cited vs operational)
- [-] `hive-mind` submodule — blocked (private repo)

## Publish / remote (2026-09-03)

- [x] Secret scan: `.env` / media / `node_modules` / `.next` gitignored; `.env.example` placeholders only
- [x] Commit demo app (no secrets) and push to `mingshsg/jina_omni_video_search`


**Acceptance:** a reader can state what is built, why byte budgets shape the
design, which limits are measured vs unknown, and the first three steps.

## Phase 1: project scaffolding

- [x] Add `.gitignore` **immediately** (before `.env` or `data/`); exclude
      `.env`, `.env.*` except `.env.example`, `data/`, uploads, proxy media,
      OS/editor junk
- [x] Documentation baseline commit already done (`262412b`)
- [x] **Compatibility spike (first acceptance gate):** pin
      `next@14.2.35`, `react@18.3.1`, `react-dom@18.3.1`, `@elastic/eui@119.1.0`,
      Borealis 8.0.0, Emotion 11.x; render `EuiProvider` + one interactive
      control via App Router; pass `yarn dev` and `yarn build && yarn start`;
      fail on peer→error, hydration, duplicate React, Emotion insertion, or
      runtime failure; record tree + result in `docs/operations.md`
- [x] Use **yarn** (project pin)
- [x] Install EUI peers; implement client-side EUI provider (`'use client'`,
      Emotion cache, `useServerInsertedHTML`)
- [x] Confirm no Tailwind
- [x] Write `.env.example` (per-provider budget vars + byte layer)
- [x] Implement `lib/config.ts` with zod
- [x] Create `data/` subdirectory structure (gitignored)
- [x] Write README (Node 22, ffmpeg 8, yarn, NFR-7)

**Acceptance:** spike recorded; `yarn dev` serves EUI with Borealis and no
hydration warning; malformed `.env` fails with a clear variable name;
`git status` shows neither `.env` nor `data/` contents as tracked.

## Phase 2: capability probe (blocks phases 4 to 8)

**Status: complete (2026-08-26)** for EIS path. Hosted Jina / local probes
optional — skipped (no keys/URL). See `docs/operations.md` and
`data/uploads/probe-report.json`.

- [x] Obtain Elastic Serverless URL and API key
- [x] Implement `scripts/probe-capabilities.ts` (`yarn probe`)
- [x] Discover or create embedding endpoint — found `.jina-embeddings-v5-omni-small`
- [x] Measure binary ceiling (EIS video/audio); byte layer `decoded_media`
- [x] Attempt EIS task settings (OQ3); query-side `query_vector_builder` OK
- [x] Record latency / dims; write budgets to `.env` and `docs/operations.md`

**Acceptance:** operations doc states per-provider ceiling + payload that first
returned 400; OQ1–OQ3 marked resolved in requirements. **Partial:** OQ2 open
without Jina key; EIS ceiling is a lower bound (no 400 up to ~3 MB).

## Phase 3: Elasticsearch layer

- [x] `docs/data-model.md` before live apply
- [x] `video-assets` / `video-chunks` mappings with `variant_id`
- [x] `lib/ingest/variant.ts`; idempotent `setup-indices.ts`
- [x] Bulk upsert `_id` = `{video_id}_{variant_id}_{chunk_index}`

**Acceptance:** second setup run is a no-op; two variants of one video coexist.

## Phase 4: embedding providers

- [x] Provider interface + eis / jina / local; pin task on Jina; isolation policy
- [x] Retry, concurrency, token accounting, L2 where needed
- [x] `yarn test-embed-compat` — text/video/audio fixtures + isolation check

**Acceptance:** compatibility fixture reports per-modality similarity; mixing
providers in one variant is rejected.

## Phase 5: ffmpeg layer

- [x] `lib/video/probe.ts` — ffprobe wrapper (duration, geometry, fps, codecs)
- [x] `lib/video/plan-chunks.ts` — pure window planner + vitest unit tests
- [x] `lib/video/proxy-encode.ts` — budget-adaptive visual encoder with terminal
      frame reduction (32→24→16) and `ProxyBudgetExhaustedError`
- [x] Audio proxy (16 kHz mono Opus 16k) in `proxy-encode.ts`
- [x] `lib/video/thumbnail.ts` — middle-frame ~320 px JPEG
- [x] `lib/video/playback.ts` — 720p H.264 faststart when needed
- [x] `lib/video/budget.ts` — per-provider byte budget from config
- [x] `scripts/test-video-pipeline.ts` smoke script (`yarn test-video-pipeline`)

**Acceptance:** proxies ≤ budget; impossible budget → defined failure; encode
time recorded as benchmark (not pass/fail gate). **Met:** unit tests pass;
smoke script reports proxy bytes vs `EIS_MAX_BINARY_BYTES`.

## Phase 6: import modes

- [x] Hardened URL / local / upload validators + tests; bilingual safe errors
- [x] FR-22 URL provenance sanitization

**Acceptance:** SSRF redirect hop refused; oversized stream aborted and
quarantined; path traversal refused. **Met:** unit tests (31) pass; validators
in `lib/ingest/*`; API stubs at `app/api/ingest`.

## Phase 7: pipeline and progress

- [x] `docs/api-contract.md` — job state machine, SSE schema, ingest shapes;
      search modality badge sketched for Phase 8
- [x] `lib/ingest/pipeline.ts` — probe→variant→playback→windows→proxies→embed→
      bulk upsert; per-window failure; throughput windows/min on complete
- [x] `lib/ingest/job-store.ts` — persist to `video-assets`; SSE listeners;
      hydrate read-only after restart (no auto-resume)
- [x] `lib/es/index-assets.ts` — asset upsert / get / find-by-job
- [x] `GET /api/jobs/[id]/stream` — SSE progress
- [x] `POST /api/jobs/[id]/confirm` and `/retry` — confirm + idempotent retry
- [x] Wire `POST /api/ingest` + upload to estimate + async pipeline
- [x] Pre-import **workload** estimate (NFR-10) in response + SSE `estimate`

**Acceptance:** re-ingest same variant does not grow chunk count; no crash-
resume claim beyond idempotent retry. **Met** in contract + upsert `_id`
design; live ES re-ingest smoke optional.

## Phase 8: retrieval API

- [x] RRF with explicit `rank_window_size`; variant filter; response contract
      and modality badge rule
- [x] `lib/es/search.ts` — ES RRF + parallel knn attribution; EIS builder /
      jina·local `query_vector`
- [x] `POST /api/search` zod-validated; `docs/api-contract.md` finalized
- [x] Smoke: `scripts/smoke-phase8-search.ts` (reuses Phase 7 chunks)

**Acceptance:** fixture expected ranges; warm p95 search under 2 s target
(measure in smoke / Phase 10).

## Phase 9: interface

- [x] Import page: mode selector, forms, client validation, SSE progress,
      workload estimate + confirm when `awaiting_confirm`
- [x] Library page: list assets from `GET /api/library`, variants/status/chunks,
      re-index (retry) + remove (ES only, files kept)
- [x] Search page: query, modality, variant, top-k, result cards, player seek,
      timeline strip for current video+variant
- [x] `GET /api/media/[videoId]` HTTP Range (FR-18)
- [x] `GET /api/thumb/[videoId]/[variantId]/[chunkIndex]` thumbnails
- [x] Bilingual ZH/EN header switch; Chinese default (NFR-3)
- [x] EUI client-only; no Tailwind

**Acceptance:** click-to-play within ~1 s; no EUI hydration warnings.
**Met** in UI + Range media routes; live click-to-play timing depends on local
media size (verify in Phase 10).

## Phase 10: end-to-end verification

- [x] Tiffany trailer (~157.5 s) from Wikimedia Commons (IA search unusable);
      full length, no synthetic substitution
- [x] **standard** (64 s/4 s) variant — 3/3 windows ready; encoder rungs recorded
- [x] **fine** (10 s/2 s) second variant on same `video_id` — 20/20; coexistence
      + `variant_id` isolation OK
- [x] Query fixture with expected time ranges; same-corpus top-k / range overlap
      (standard top1 4/5 top3 5/5; fine top1 5/5 top3 5/5) — no Elastic score compare
- [x] Click-to-play path: media Range 206 (lib + HTTP `/api/media`)
- [x] Import modes: upload stream OK; URL sanitize/provenance OK (full URL
      re-download optional); local skipped (`LOCAL_IMPORT_ROOT` unset)
- [x] Findings: `reviews/archive/2026-09-10-file-video-search/e2e-verification-2026-08-26.md`; runner
      `scripts/phase10-e2e.ts`

**Acceptance:** dual-preset coexistence + same-corpus metrics recorded.
**Met** 2026-08-26.

## Phase 11: close-out

- [x] Docs: empirical claims → measurements; constants → cited sources
- [x] README refresh; self-review in `reviews/archive/2026-09-10-file-video-search/self-review-2026-08-26.md`
- [x] Refresh `docs/architecture.md`, `data-flow.md`, `ui-mockup.md`,
      `operations.md`; verify `data-model.md` + `api-contract.md` vs code

**Acceptance:** no placeholder text; traceability as above.
**Met** 2026-08-26.

## Follow-up: per-import chunk preset

- [x] Named presets at import: `standard` / `60s` / `30s` / `20s` / `fine`
- [x] `POST /api/ingest` + upload accept `chunk_preset` (or `window_ms`+`overlap_ms`)
- [x] Ingest UI select + bilingual help; library/search show window labels
- [x] Docs: `docs/api-contract.md`; Docker rebuild needed for live UI

## Follow-up: batch import

- [x] `POST /api/ingest/batch` — multi-file upload + local folder (no URL)
- [x] Shared `chunk_preset`; one file = one `video_id` / job
- [x] Ingest UI batch scope + multi progress list
- [x] Docs + Docker rebuild on APP_PORT=3001

## Follow-up: per-hit visual/audio scores + sort

- [x] `POST /api/search` hits include `score` (RRF), `score_visual`, `score_audio`, `rank_visual`, `rank_audio`
- [x] Request `sort_by`: `rrf` \| `visual` \| `audio` (server-side; default `rrf`)
- [x] Search UI shows three scores + EUI sort select; EN/ZH i18n
- [x] Docker rebuild on APP_PORT=3001 after this change
  (plan: `APP_PORT=3001 docker compose up -d --build`; keep existing
  `./data` → `/app/data` bind; do **not** delete media). Verified 2026-09-03:
  search returns `score_visual`/`score_audio`; media dirs intact.

## Follow-up: image-to-video search

- [x] `POST /api/search/image` — multipart or JSON base64; prepare/compress
      (max edge 1280 JPEG under provider budget); `embedImage` + knn on
      `embedding_video` only (`variant_id` required, optional `video_id`)
- [x] UI `/search-image` — upload/drop, variant + video filter + top-k,
      result cards / player / timeline; nav **Image search**; EN/ZH i18n
- [x] Docs: `docs/api-contract.md` (+ architecture route table)
- [x] Docker rebuild on APP_PORT=3001 after this change
  (`APP_PORT=3001 docker compose up -d --build`; Dockerfile uses
  `node:22-bookworm-slim` to avoid Hub pulls of full bookworm /
  `# syntax=` frontend when offline). Verified: `/search-image` → 200.

## Follow-ups

- [x] Add import chunk preset `2s` (2 s window / 1 s overlap); rebuild app
      container (2026-09-22)
- [x] Library batch delete (`POST /api/library/batch-delete` + multi-select UI);
      rebuild app container (2026-09-22)
- [x] Search defaults: modality=visual; RRF sort disabled unless Both
- [x] Search result grouping: same-video hits within `2×chunk_window` collapse;
      Top-k counts groups (UI default 5); rebuild app (2026-09-22)

## Blocked / waiting on user

- [x] **Phase 2 Elastic credentials** — `.env` present; probe run 2026-08-26.
- [ ] Optional: `JINA_API_KEY` (hosted Jina probe / **OQ2**)
- [ ] Optional: `LOCAL_EMBED_URL` (local provider probe)
- [ ] Permission to create EIS endpoint if discovery finds none — not needed;
      default `.jina-embeddings-v5-omni-small` exists (`ALLOW_EIS_ENDPOINT_CREATE=false`)
- [-] `hive-mind` submodule access
