# Drama ingest enrichment — 2026-09-26

Plan: [`plan/12-drama-ingest-enrichment.md`](../plan/12-drama-ingest-enrichment.md)  
Chinese: [`chn.docs/剧集入库增强规划.md`](../chn.docs/剧集入库增强规划.md)  
Upstream: https://github.com/mingsorg/episode_processing

## Status

| Phase | Status |
| --- | --- |
| P0 Contract / UI / mapping stub / Python spike | Done (operator: setup-indices + submodule init) |
| P1 Subtitles + structure + drama-subtitles index | Node code present; ko/th development gates passed; live integration and human quality separate |
| P2 Directors script + synopsis | Done (live EIS smoke NOT RUN) |
| P3 Key actors + key scenes + frame GC job | Node code present; acceptance open (`todo/38` I1–I7; `todo/37` tracks earlier fixes) |
| P4 Search / Library consume (+ Library re-run) | Not started |

## Decisions (2026-09-26)

- [x] **OQ-1** — After `ready`; optional. Enable at upload/local **or** later from Library.
- [x] **OQ-2** — Disposable frames deleted by backend cleanup job; keep SRT/scripts/approved thumbs.
- [x] **OQ-3** — Index + embed subtitles; dedicated multi-lang timed index (not asset `meta` dump).
- [x] **OQ-4** — v1 local + upload only; URL drama later via Library.
- [x] **OQ-5** — Cap 210 min, setting `DRAMA_MAX_DURATION_MS` (adjustable).
- [x] **OQ-6** — **A submodule** at `vendor/episode_processing`.

## Checklist

### P0 — Contract and shell

- [x] Document additive `drama` request fields in `docs/api-contract.md`
- [x] Document `meta.drama` + `ES_INDEX_DRAMA_SUBTITLES` in `docs/data-model.md`
- [x] Config: `DRAMA_MAX_DURATION_MS` default 12_600_000 (210 min) in env example
- [x] Ingest UI (upload/local): "Process as drama" + language + module multi-select
- [x] i18n `en` / `zh` strings
- [x] Parse/validate `drama` on ingest / upload / batch (URL: reject drama in v1)
- [x] Spike helpers: `lib/drama/spawn-spike.ts` + submodule path checks
- [x] Lock OQ-6 — submodule at `vendor/episode_processing`
- [x] `yarn test` + `yarn build` for parse-only changes
- [ ] Operator: `git submodule update --init` on fresh clones; `yarn setup-indices` for `meta.drama` + drama-subtitles index

### P1 — Subtitles + structure + subtitle index (Node)

- [x] Follow-on drama job after `ready` (`lib/drama/runner.ts`) + SSE progress
- [x] Node path: sidecar → embedded softsubs → optional Whisper API/CLI
- [x] Implement `ko` and `th` source-language transcription through request/UI, sidecar/embedded matching, ASR API/CLI, timed index language, and director/auditor evidence. Node 22 build and bounded full suite passed; live integration and later human quality checks remain separate (see `todo/38` I6).
- [x] Structure via ffmpeg blackdetect + heuristics → `meta.drama.structure`
- [x] Timed cues → `ES_INDEX_DRAMA_SUBTITLES` + `embedText` (passage)
- [x] Partial ES script update for `meta.drama` (no editorial revision bump)
- [ ] Manual gate: one local episode; human-check structure intervals
- [x] Regression: ingest without `drama` unchanged (drama hook gated on `job.drama`)
- [ ] Operator: configure `DRAMA_ASR_*` if no sidecar/embedded subs; `yarn setup-indices`

### P2 — Directors script (Node + EIS)

- [x] EIS multimodal directors windows (`lib/drama/directors-script.ts`)
- [x] Propose id via `DRAMA_EIS_CHAT_INFERENCE_ID` (falls back to Suggest connector id)
- [x] Optional audit id must differ (`DRAMA_EIS_AUDIT_INFERENCE_ID`)
- [x] Persist ZH/EN/raw scripts on disk; synopsis_* on `meta.drama`
- [x] Wire into drama runner; cost caps (`MAX_WINDOWS`, frames/window)
- [ ] Sample groundedness on a real episode — **NOT RUN**
- [ ] Operator: set `DRAMA_EIS_CHAT_INFERENCE_ID`; re-run `yarn setup-indices` for path fields

### P3 — Key actors + key scenes + GC

Code for these stages exists in the current working tree, but the checks below
remain open. The adoption review in `todo/36` records additional P1 blockers;
do not mark P3 complete merely because the runner calls the modules.

- [ ] Index only `verified` face cards; media route for thumbs
- [ ] Key scenes: time range + summary + thumb path
- [ ] Backend cleanup job for disposable `frames/`
- [ ] Cost/latency measurement on representative episode — **NOT RUN until measured**

### P4 — Consume in search / library

- [ ] Optional filter: exclude 片头/片尾/recap windows from moment results
- [ ] Library / flyout: structure + faces + scenes
- [ ] Library action: configure modules, `zh/en/ko/th` source languages, subtitle method, and sampled director coverage for an existing ready asset; review choices before an async start. See plan/12 P4. Two backend draft files exist but are incomplete, untested, and not deployed.
- [ ] Library result view: run status/progress plus subtitles, structure timeline, director script/synopsis, key scenes, and actor candidate inspection; label partial, gaps, provenance, and provisional outputs.
- [ ] Safe post-ingest API: persist a recoverable marker before `202`, reject missing media/overlap, never re-embed, query timed subtitles, and keep previous successful generations until a complete replacement. Resolve todo/38 I1–I4 before enabling reprocess.
- [ ] Tighten `api/drama-media` to an explicit artifact allowlist before linking previews; current root containment also serves run-internal `meta.json` with an internal media path.
- [ ] Browser and live index acceptance for the Library workflow on a rebuilt container; human content-quality review remains a separate round.
- [ ] File + live search regression
- [ ] Do not claim p95/relevance without labeled run

## Explicitly NOT RUN yet

| Gate | Status |
| --- | --- |
| Live ASR on demo cluster | NOT RUN |
| Subtitle embedding relevance | NOT RUN |
| EIS directors cost/latency | NOT RUN |
| Face verify quality on non-EP38 cast | NOT RUN |
| Search relevance with structure filter | NOT RUN |
| Docker image with Python drama deps rebuild | NOT RUN |
| Frame GC job in production-like schedule | NOT RUN |
