# Drama ingest enrichment (adopt `episode_processing`)

Date: 2026-09-26
Status: **P0–P3 Node code committed as `03932da`; P4 Library start/results first cut committed as `df7a10e` and `9547047`. Submission fixes are tracked in `todo/39`. Live drama quality, timed subtitle inspection, search consume, browser and multi-replica gates remain open; human transcript quality is a separate round.**
Upstream ideas: [`mingsorg/episode_processing`](https://github.com/mingsorg/episode_processing)
Tracker: `todo/35-drama-ingest-enrichment-2026-09-26.md`
Chinese summary: `chn.docs/剧集入库增强规划.md`

## Goal

On ingest (upload / local / URL), the operator can opt into **Process as drama**.
They multi-select enrichment modules and subtitle languages. Selected stages
reuse the episode-processing pipeline (ASR, directors script, key faces, key
scenes, structure tags). Results are written into Elasticsearch as **asset
metadata** — including 片头 / 片尾 / recap / intro time ranges — without
changing chunk vectors or the existing file/live search contracts.

User framing (2026-09-26):

> when we process the uploaded video, we can select process as drama, then it
> will extract the subtitle (we can select languages, multi-selection) and
> director's script, and key actors picture and key scenes in the drama.
> these can be multiselected. then we can leverage the code, and index into
> the corresponding elastic as metadata of the drama/video including the
> recap, intro, 片头 片尾 info.

## Non-goals (this plan)

- Merging the two repos into one monorepo.
- Sending whole-video bytes into the existing edit-time **Suggest** path
  (that path stays title/clue-only; see `plan/04`).
- Re-embedding chunks when drama metadata arrives (invariant: metadata edits
  never re-embed).
- Shipping the full promotional clip/thumbnail brief pipeline from
  `episode_processing` content requirements (clips/briefs are a later
  consumer of the same structure fields).

## Relationship to existing tracks

| Track | Role |
| --- | --- |
| File ingest (`lib/ingest/pipeline.ts`) | Remains source of truth for media prepare, chunk plan, embed, `video-chunks` |
| Hybrid metadata / Suggest | Work-level catalog facts; **orthogonal** to drama file understanding |
| `meta.group_id` (`todo/34`) | Organizational bucket (`trailer` / `demo` / show slug); drama fields sit *inside* the asset |
| `episode_processing` | Offline Python stages we **call**, do not rewrite in TypeScript |

## UX (Ingest page)

When **Process as drama** is checked (default off):

1. **Subtitle languages** — multi-select (`zh`, `en`, `ko`, `th`). Select the spoken
   language: `ko` requests Korean ASR, `th` requests Thai ASR. Each selected
   language is resolved separately (sidecar → matching embedded stream → ASR);
   this does not translate or auto-detect the language. At least one language
   is required when "subtitles" is selected.
2. **Modules** — multi-select, all optional independently:
   - `subtitles` — extract / align SRT for selected languages
   - `structure` — label 片头 / 片尾 / recap / intro / body intervals
   - `directors_script` — bilingual directors prose (EIS propose)
   - `key_actors` — verified face cards (expensive; gated)
   - `key_scenes` — representative scene stills + short summaries
3. Progress: extend job SSE with drama sub-stages
   (`drama_subtitles`, `drama_structure`, …) without renaming existing
   embed stages.

**When drama runs (OQ-1 decided):** embed always finishes first (`ready`).
Drama enrichment is **optional** and **not forced**. Two entry points:

- **At upload / local ingest:** operator checks Process as drama → after
  `ready`, a follow-on drama job runs the selected modules.
- **Later (Library):** operator can start the same enrichment on an already
  indexed asset (needed for URL-sourced videos in a later phase; see OQ-4).

Batch import: same drama options apply to every file in the batch (v1); per-file
overrides are deferred.

## API sketch (additive)

`POST /api/ingest`, `/api/ingest/upload`, `/api/ingest/batch` gain optional:

```json
{
  "drama": {
    "enabled": true,
    "languages": ["zh", "en"],
    "modules": ["subtitles", "structure", "directors_script", "key_actors", "key_scenes"]
  }
}
```

Validation:

- `enabled: false` or omitted ⇒ ignore `languages` / `modules` (today's path).
- `enabled: true` with empty `modules` ⇒ `400` `INGEST_DRAMA_EMPTY`.
- Unknown language / module ⇒ `400`.
- `directors_script` / `key_actors` require EIS (or configured) credentials;
  missing config ⇒ fail the **drama** follow-on job with a clear code; the
  embed path can still reach `ready`.

Job snapshot adds optional `drama: { status, modules_done[], error? }`.

## How we implement drama enrichment

**P1+ preference: Node.js in this repo** (`lib/drama/*`), using ffmpeg already
on PATH and the existing EIS/Jina `embedText` path. The
`vendor/episode_processing` submodule remains a **reference** for algorithms
and offline EP38 experiments — it is **not required** at runtime for
subtitles/structure.

| Stage | Node approach (shipped path) |
| --- | --- |
| Audio | `ffmpeg` → 16 kHz mono MP3 under `data/media/…/drama/<run_id>/` |
| Subtitles | Sidecar SRT → embedded softsubs (`ffmpeg -map 0:s`) → optional OpenAI-compatible Whisper API / whisper CLI |
| Structure | `blackdetect` + duration heuristics → 片头/片尾/`body` (+ intro/recap when signals exist) |
| Index | `meta.drama` partial update; timed segments → `ES_INDEX_DRAMA_SUBTITLES` + `embedText` |

Director script, key-face and key-scene modules are now present as Node code.
They do not call the Python submodule on the normal runtime path. Their
presence is not an acceptance claim: see
[`todo/36`](../todo/36-drama-adoption-review-2026-09-27.md) for coverage,
audit, face-verification, status and recovery blockers.

### Review correction — implementation limits (2026-09-27)

This review originally found the 400-cue truncation, whole-episode coverage
overclaim, audit gaps, `key_actors` dependency, premature face verification,
and lost UI progress. R1–R3, R5, R6 and R8 received scoped code fixes on
2026-09-28; R4, R7 and R9 were reopened after recheck. The original evidence
remains in [`todo/36`](../todo/36-drama-adoption-review-2026-09-27.md).

### Recheck correction — acceptance contract (2026-09-28)

Index every validated subtitle cue; only vector inference is capped. A retry
must not leave multiple visible subtitle generations for the same episode and
must not overlap another active enrichment run. Director coverage must refer
to **successful** windows, preserve gaps, and never imply a whole-episode
synopsis from a short or mostly failed sample. A skipped, unparseable, or
failed audit cannot yield an accepted synopsis; if auditing is optional, store
its output as explicitly provisional until reviewed. Visual claims need frame
evidence, not subtitles alone. Persist the requested enrichment state with or
before base `ready` so a crash cannot silently lose the follow-on run.
Partial/failed enrichment remains visible and retryable in UI and batch
results, without a generic green enrichment success. See
[`todo/37`](../todo/37-drama-system-adoption-recheck-2026-09-28.md) for the
implementation and acceptance checklist.

### Follow-up implementation contract (2026-09-28)

Before calling the Node implementation complete, the strict asset mapping
must declare every field in the persisted `meta.drama` payload, including
`modules_done`, `error`, and nested actor `role_en`; verify the terminal
scripted update on the target index. Stable `run_id` alone is not sufficient
retry reconciliation: old cue IDs from a shorter or retimed retry must be
removed, and a partial multilingual run must not retire the last complete
generation. If the pre-ready drama marker fails to persist, the request must
still be recoverable after restart. Partial/failed drama must not render a
green success or disappear from batch results on an automatic timer. An
`audited` synopsis needs evidence covering the actual published synopsis,
not merely an early script excerpt. Korean and Thai source episodes can select
`ko` or `th` for timed native-language subtitles and director/auditor evidence;
live ASR and source-language quality still need representative-episode validation.
Follow-up findings and gates: [`todo/38`](../todo/38-drama-implementation-followup-2026-09-28.md).

### `ko` / `th` source-language transcription acceptance plan

The operator selects the **spoken source language**. Selecting `ko` means
Korean transcription; selecting `th` means Thai transcription. Neither option
requests English translation. Do not infer the language from the filename or
silently fall back to `en`/`zh`. Keep the language selection empty by default
so an operator must choose it when enabling the subtitles module. For a
mixed-language video, multi-select runs one independent subtitle resolution
per selected language; it is not automatic language detection or segmentation.

| Step | Required behavior | Evidence to collect |
| --- | --- | --- |
| Request/UI | Accept only `zh`, `en`, `ko`, `th`; require at least one when `subtitles` is selected; persist selected codes through retry. | JSON and form request tests, UI selection check. |
| Subtitle source | For each selected code, prefer a matching `<stem>.<code>.srt` sidecar, then an embedded stream tagged with that language (`kor`/`ko`, `tha`/`th` included); never assign an untagged or mismatched stream. | Sidecar and ffprobe/ffmpeg fixture tests for both languages and mismatch cases. |
| ASR fallback | When no matching subtitles exist, pass exactly `ko` or `th` to the transcription endpoint or Whisper CLI with a transcribe task; request timed segments and preserve the returned native-language text. Do not use the Chinese/English prompt for either. | Captured API form/CLI argv tests. Provider compatibility is an operational integration gate; transcript quality belongs to a later human review. |
| Output | Write `ko.srt` or `th.srt`; index every valid timed cue with `lang` set to the selected code; preserve timestamps and source. Pass these cues to director-script generation and audit as source-language evidence. Director-script output remains the existing ZH/EN format; that translation is a separate model step and must not be represented as native-language transcription. | SRT/index payload tests and director/auditor prompt tests. Live ES and human transcript checks are separate gates. |
| Failure | If no matching source exists and ASR is unavailable or returns untimed/empty output, report that language's failure; do not relabel another language's cues or publish a false completed subtitle set. Retry must reconcile prior cue generations (todo/38 I2). | No-source, provider-error, untimed-response, mixed-language partial-run, and changed-cue retry checks. |

**Development gate (2026-09-28): passed.** Node 22 `yarn build` passed and
`yarn test --maxWorkers=4` passed 82 files / 560 tests, including API and CLI
language arguments, embedded/sidecar matching, timed index `lang`, and
director/auditor evidence. The unrestricted full test run had a 5-second
`key-scenes` timeout; that file passed alone and in the bounded full run.
The app image was later rebuilt with `docker compose up -d --build app`;
the replacement container is running and `/ingest` returned HTTP 200. No
live-provider/Elasticsearch claim follows from these checks. The next human
round judges Korean and Thai transcription quality separately; it does not
reopen the code development gate. Track broader system gates in
[`todo/38`](../todo/38-drama-implementation-followup-2026-09-28.md).
Standalone `yarn tsc --noEmit` still reports 45 errors in existing test files
outside the ko/th change; none are in the ko/th tests touched here. The
repository's required production typecheck is `yarn build`, which passed.

### OQ-6 — submodule (decided A; reference only for P1)

`vendor/episode_processing` is cloned for design reference and optional later
stages. Fresh clones: `git submodule update --init`. P1 Node enrichment runs
without importing those Python scripts.

Workspace layout under `MEDIA_ROOT` (runtime only):

```text
data/media/<video_id>/
  source…               # existing originals/uploads path
  drama/<run_id>/
    meta.json
    audio/
    subtitles/*.srt
    structure.json
```

Node owns: job follow-on, ffmpeg, ASR adapters, ES `_update`, SSE.

## Elasticsearch: asset metadata (not new chunk index)

Add under `meta` (or a sibling `drama` object on the asset doc — prefer
`meta.drama` so Library/PATCH patterns stay one tree). Mapping migration is
additive keyword/object/text only; **no** dense_vector change.

```json
{
  "meta": {
    "drama": {
      "run_id": "keyword",
      "show_id": "keyword",
      "episode_id": "keyword",
      "enrichment_status": "keyword",
      "modules": { "type": "keyword" },
      "languages": { "type": "keyword" },
      "structure": {
        "type": "nested",
        "properties": {
          "kind": { "type": "keyword" },
          "start_ms": { "type": "integer" },
          "end_ms": { "type": "integer" },
          "confidence": { "type": "float" },
          "source": { "type": "keyword" }
        }
      },
      "synopsis_zh": { "type": "text" },
      "synopsis_en": { "type": "text" },
      "directors_script_zh": { "type": "text", "index": false },
      "directors_script_en": { "type": "text", "index": false },
      "subtitle_paths": { "type": "keyword", "index": false },
      "key_actors": {
        "type": "nested",
        "properties": {
          "role_zh": { "type": "keyword" },
          "person_id": { "type": "keyword" },
          "thumb_path": { "type": "keyword", "index": false },
          "verified": { "type": "boolean" },
          "t_ms": { "type": "integer" }
        }
      },
      "key_scenes": {
        "type": "nested",
        "properties": {
          "start_ms": { "type": "integer" },
          "end_ms": { "type": "integer" },
          "summary_zh": { "type": "text" },
          "summary_en": { "type": "text" },
          "thumb_path": { "type": "keyword", "index": false }
        }
      }
    }
  }
}
```

`structure.kind` enum (v1):

`opening_credits` | `ending_credits` | `recap` | `intro` | `body` | `unknown`

Half-open `[start_ms, end_ms)` aligned with chunk windows.

**Subtitles + embedding (OQ-3 decided):** yes — index and embed subtitle
segments for search. Because languages are multi-select and segment-timed,
do **not** dump full multilingual SRT into `meta` on the asset. Prefer a
**dedicated index** (working name `video-drama-subtitles` / env
`ES_INDEX_DRAMA_SUBTITLES`) with documents shaped roughly:

```json
{
  "video_id": "…",
  "lang": "zh",
  "seg_id": "…",
  "start_ms": 120000,
  "end_ms": 125000,
  "text": "…",
  "text_embedding": "<dense_vector same dims/variant rules as chunks, or semantic_text>"
}
```

Asset `meta.drama` keeps language list, run_id, and pointer that subtitles
were indexed; SRT files remain on disk as source of truth. Exact embedding
mechanism (app-side Jina vs ES `semantic_text`) is a P1 spike — must not mix
`variant_id` rules with visual/audio chunk vectors casually.

Long directors scripts default `index: false` on the asset; searchable
synopsis fields only on `meta.drama`.

Writes: partial `_update` on the asset (never `upsertAsset` whole-doc replace
for drama-only fields — same trap as AGENTS.md #4). Subtitle docs use bulk
index into the drama-subtitles index.

### Duration cap (OQ-5 decided)

Drama enrichment refuses (clear error) when probed duration exceeds
`DRAMA_MAX_DURATION_MS` (default **210 minutes** = `12_600_000` ms),
overridable via `.env` / config — not hard-coded only in UI.

### Frame cleanup (OQ-2 decided)

1fps / intermediate frames are **disposable**. After modules that need them
finish (or fail terminally), a **backend cleanup job** deletes disposable
frame dirs under `drama/<run_id>/frames/`. Keep SRT, scripts, structure.json,
verified face/scene thumbs. Cleanup is idempotent and safe to re-run.

## Search / product use (phase after index)

Not required to ship enrichment itself, but drives schema choices:

1. **Hard-filter / soft-boost:** exclude or down-rank moments whose window
   intersects `opening_credits` / `ending_credits` / `recap` when the user
   wants "剧情 only".
2. **Library UI:** show structure timeline + key actor thumbs + key scenes.
3. **Hybrid lexical:** `synopsis_*` joins existing description/abstract paths
   carefully labeled as *this file's drama enrichment*, not external catalog
   work synopsis (provenance in `meta.review` or `meta.drama.source`).

### P4 Library workflow for an existing video (first cut, 2026-09-29)

The Library now has a start action, per-run subtitle policy, a result summary,
and approved script/still links. The first cut is not full P4 acceptance:
timed subtitle query/seek, coverage gaps, browser outcomes and restart checks
remain open in `todo/35` and `todo/39`.

**Entry and eligibility.** Add a distinct **Process as drama** action on each
ready Library asset; do not reuse **Re-index**, which reruns chunk embedding.
The server checks the asset, its saved original `media_path`, duration cap,
active job, and current `meta.drama` state. A URL-origin asset is eligible only
if its previously downloaded local media still exists on that server; do not
silently fetch a URL again. Show a precise disabled or error reason for missing
media, non-ready assets, or a running job. A completed run opens **View drama
results**; failed/partial runs show **Retry enrichment**. New selections after
a completed run require explicit reprocess semantics and safe generation
replacement (todo/38 I2), not an accidental overwrite.

**Configuration before start.** Open a reviewable modal for that video:

| Control | Behavior |
| --- | --- |
| Outputs | Checkboxes for timed subtitles, structure/credits, director's script plus synopsis, key scenes, and actor **candidates**. `key_actors` requires `directors_script`; do not label candidates verified until their review gate passes. |
| Spoken subtitle languages | Multi-select `zh`, `en`, `ko`, `th`, empty by default. Required only for subtitles. `ko` requests Korean transcription and `th` Thai; neither means translation. |
| Subtitle method | `auto` (matching sidecar → matching embedded stream → configured ASR), `existing subtitles only`, or `force ASR`. This is a per-run policy to implement; display the configured ASR backend without exposing credentials. Missing language-tagged subtitles or unavailable ASR fails that language visibly. |
| Director coverage | Show the current **sampled windows** cap and estimated work before starting. Do not offer “full episode” until full-coverage generation and audit are implemented. ZH/EN director output is distinct from the source-language transcript. |
| Confirmation | Summarize selected modules, languages, method, limits, and expected generated artifacts. The start request responds immediately with a job/run ID; long work proceeds asynchronously. |

**API and processing contract.** `POST /api/library/{videoId}/drama` accepts a
validated, bounded body such as
`{"modules":["subtitles","structure","directors_script"],"languages":["ko"],"subtitle_source":"auto","director_coverage":"sampled"}`.
Return `202` with `job_id`, `video_id`, `run_id`, and initial drama status; use
specific `400/404/409` errors for bad options, absent asset/media, and
overlapping runs. Persist the request and a recoverable pending/running marker
**before** reporting acceptance. Reuse the drama runner on the saved media,
without changing base ingest status, `variant_id`, chunk vectors/counts, or
playback paths. The method field must actually control sidecar/embedded/ASR
resolution; do not add a decorative UI setting. A crash/restart and a second
click must not launch overlapping runs. Before enabling reprocess, fix todo/38
I1–I4, especially subtitle generation reconciliation and partial-run status.

**Inspection after start.** The Library row shows a separate drama badge
(queued/running/succeeded/partial/failed), selected outputs, last update,
and an expandable progress view fed by the existing job SSE plus refresh after
navigation/restart. The result view reads a safe DTO from `meta.drama` and
paginated subtitle-index queries, never raw filesystem paths or credentials:

| Result section | Inspectable content |
| --- | --- |
| Run overview | Run ID/time, requested/completed/failed modules, languages, per-module errors, source/method, sampled coverage ranges and gaps, audit/provisional status. |
| Subtitles | Language, source (`sidecar`/`embedded`/ASR), cue count, timed text with seek-to-video, lexical/vector indexing state; make missing languages and partial runs explicit. |
| Structure | Timeline bands for intro/recap/body/opening/ending, with seek links. |
| Director's script and synopsis | ZH/EN documents, sampled coverage and gaps, source-language evidence label, downloadable/previewable markdown through validated media routes; provisional text must not look approved. |
| Key scenes and actors | Timed scene thumbnails/summaries and actor candidate cards with verification state; use the bounded drama-media route for thumbnails. |

Keep prior successful results visible until a new generation is complete; do
not retire subtitle generations after only one of several selected languages
succeeds. Surface unavailable artifacts as missing, never as empty success.
Artifact previews must not reveal internal `media_path` or arbitrary server
files. The `app/api/drama-media/[videoId]/[runId]/[...rest]` route now checks
published artifact paths and denies `meta.json`, audio, raw scripts and
temporary files; the safe DTO emits only route URLs. Verify this against a
rebuilt container before claiming runtime acceptance. Timed SRT inspection is
still open and is not exposed through this route.
Human review of transcript/scene quality is a later round, separate
from the functional development gate.

**Acceptance for the next implementation tool.** Verify request validation,
media eligibility, module dependencies, source-method behavior, duplicate
click/restart recovery, and an unchanged chunk/variant snapshot. Browser-test
the selection modal, immediate `202` response, live progress, refresh after
reload, each result section, and partial/error states on a rebuilt container.
Check the target index mapping and a real terminal `meta.drama` update plus
subtitle query before claiming live integration; report p95/cost only after a
representative measurement. Do not use human content-quality review as a
substitute for these functional checks.

## Hard invariants preserved

1. Existing `/api/ingest` without `drama` behaves identically.
2. Drama stages do not mutate `variant_id`, chunk docs, or file paths used by
   playback.
3. Secrets (EIS, Whisper keys) only in `.env`; never in ES docs or logs.
4. Face cards: acceptance requires upstream-equivalent identity/quality gates
   before `verified` faces are indexed. The current Node implementation is
   under review (`todo/36` R6); its `verified: true` flag alone does not prove
   equivalence to `episode_processing`.
5. Do not claim latency/cost gates without measuring on a real episode.

## Phased delivery

| Phase | Deliverable | Gate |
| --- | --- | --- |
| **P0** | Contract + UI controls + mapping stub + Python spawn spike; OQ-6 = submodule | `yarn build` / unit tests for parse; no live ASR |
| **P1** | `subtitles` + `structure` → disk + `meta.drama` + **drama-subtitles index** (+ embed spike) | One local MP4; structure intervals human-checked |
| **P2** | `directors_script` via EIS; synopsis fields | Propose≠audit IDs; sample groundedness |
| **P3** | `key_actors` + `key_scenes` + frame **cleanup job** (Node code present; acceptance open) | Only upstream-equivalent verified faces; scene thumbs via media route; scheduled cleanup |
| **P4** | Search/Library consume structure + synopsis; Library “run drama” for existing assets | File/live regression green; measured p95 NOT claimed until run |

## Decisions (2026-09-26)

| ID | Decision |
| --- | --- |
| **OQ-1** | After `ready` only; **not mandatory**. Enable at upload/local ingest *or* later from Library. |
| **OQ-2** | Disposable intermediates (esp. frames) deleted by a **backend cleanup job**; keep SRT/scripts/approved thumbs. |
| **OQ-3** | **Yes** — index + **embed** subtitles. Multi-lang timed segments → **separate ES index** (not mashed into asset `meta`). |
| **OQ-4** | v1: **local + upload** only. URL: enable drama later from **Library** (not at URL ingest). |
| **OQ-5** | Cap **210 minutes**, adjustable via setting (`DRAMA_MAX_DURATION_MS`). |
| **OQ-6** | **A — Git submodule** at `vendor/episode_processing` (decided 2026-09-26). |

## What this plan deliberately rejects

- Running drama enrichment inside Suggest Agent Builder.
- Storing raw face crops in ES `_source` as base64.
- Treating directors script as authoritative cast for Suggest without review.
- Blocking moment search until directors script finishes (OQ-1: always after ready).
- Enabling drama on URL ingest in v1 (Library-later only).
