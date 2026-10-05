# Code review — branch-wide bug review (2026-10-04)

**Scope:** `codex/enrichment-add-runs` at `92b317b` vs `live-video-search`,
correctness only (no style). Server side: enrichment start/retry, run
persistence, subtitle/script/media serving, Elasticsearch writes (group
backfill, group availability, asset rename, mapping upgrade, hybrid search).
UI side: metadata editor, enrichment flyouts, Group filter, ingest page and
ingest routes. Two read-only passes traced the code; the four P2 headline
items below (S1, U1, U2, U3) were re-checked by hand against the cited lines.
Items already tracked in `todo/22`, `todo/32`, `todo/43`, `todo/46`,
`todo/49`, `todo/50`, `todo/52`, `todo/53` are not repeated. No code was
changed.

**Verdict: no P1. Five P2s — retry wipes the results of the run it retries;
`todo/53` D1 has two more triggers than a restart; Group-only edits and the
operator hint are lost to stale React callbacks; the ingest page locks after
a failure. Eleven P3s.**

## P2 — should fix

### S1 — retrying a run reuses its `run_id`, so the run's published results vanish from `meta.drama` the moment the retry starts

Both retry branches keep the old ID — `app/api/jobs/[id]/retry/route.ts:108-113`
(enrichment-only) and `:136-145` (base retry):

```ts
prev.drama = {
  status: 'pending',
  ...
  modules_done: [],
  run_id: prev.drama.run_id,
```

The runner's first write is a `running` marker with no result fields
(`lib/drama/runner.ts:191-200`). The Painless merge only snapshots the
previous record into history when the ID **differs**
(`lib/drama/persist-meta.ts:66-77`):

```painless
if (previous.run_id != next.run_id) {
  def snapshot = new HashMap(previous);
  ...
}
...
ctx._source.meta.drama = next;
```

With the same ID, the previous record is replaced whole. **Trigger:** retry
a `partial` run (e.g. only `key_actors` failed). **Consequence:** synopsis,
structure, script URLs, subtitle links and key scenes disappear from the
results flyout during the retry. The earlier-run fallback (`todo/50` F7) only
reads `runs` history, so it cannot help on this path. Every module re-runs
(ASR/EIS cost). A module that succeeded before and fails now is lost
permanently, and a restart mid-retry loses all of them. The files stay on
disk, but nothing references them anymore. Library "Start"
(`start-existing`) mints a new ID and is not affected. **Fix direction:**
either mint a new `run_id` on retry, or snapshot `previous` into history
whenever its status is terminal, even with the same ID. Keep F1's stable
subtitle-document intent in mind: subtitle docs are already retired by
`keepRunId`.

### S2 — `todo/53` D1 ("stuck at running") has two triggers besides a restart

- **Final meta write fails.** `lib/drama/runner.ts:512-523` catches the
  failure and only updates in-memory state, then
  `updateJob(..., { persist: false })` (`:542-554`). Elasticsearch keeps
  `meta.drama.enrichment_status: 'running'`.
- **Top-level runner throw** (e.g. `ENOSPC` from `openDramaWorkspace` or
  `writeDramaJson`). The catch at `:563-579` persists `job.drama = failed`
  via `persistJob`; `meta.drama` stays `running`.

`lib/drama/start-existing.ts:47-57` reads `meta.drama` first, so Start
returns 409 forever, the same as D1. A startup-only reset does not cover
these. The D1 fix must treat "`running` with no live in-process lease"
(`isDramaRunActive` false) as interrupted. Recorded here as an extension of
D1, not a separate item.

### U1 — saving a Group-only edit fails; successive Group edits save a stale value

`components/EditMetadataFlyout.tsx:1381-1389` reads `selectedGroup` inside
`save`, but the `useCallback` dependency list (`:1497-1520`) omits it:

```ts
const nextGroup =
  selectedGroup[0] != null
    ? String(selectedGroup[0].value ?? selectedGroup[0].label).trim() || null
    : null;
```

- **Trigger 1:** change only Group, then Save. `save` still sees the
  load-time value, finds no change, and shows the generic save error
  (`:1452-1455`).
- **Trigger 2:** change Group to A, then Description, then Group to B, then
  Save. A is persisted.

This is exactly the manual per-video Group backfill path `todo/43`
prescribes.

### U2 — the operator hint is dropped by a stale callback and, when sent, can hit a cache entry that ignores it

- **(a)** `EditMetadataFlyout.tsx:694` reads `operatorHint` in `onSuggest`;
  the dependency list (`:995-1014`) omits it. Typing a hint and clicking
  Suggest sends no `operator_hint`, unless another listed dependency changed
  after the hint was typed.
- **(b)** `app/api/library/[videoId]/meta/suggest/route.ts:168-181` keys the
  job cache on the *parsed* `hint.workTitle` / `hint.locale` only, while
  `:191` passes the full raw `operator_hint` into the agent prompt. Two
  different hints that parse to no title (e.g. a free-form sentence) share
  the hint-less cache key, so the second Suggest returns the first result.
  The inline comment ("a different hint is a different run") is not what
  the code does. Fix: key on the normalized raw hint.

### U3 — the ingest page locks after a failure; only a page reload recovers

- **Batch:** failed rows, and rows whose enrichment is `partial` or
  `failed`, stay in `batchRows` (`app/ingest/page.tsx:443-462`, `:472-481`),
  so `batchBusy = batchRows.length > 0` (`:928`) stays true. The banner that
  holds "Clear results" only renders when
  `batchFinishedBanner && !batchBusy` (`:949`). The whole form stays
  disabled and there is no way out. On `live-video-search`,
  `maybeFinishBatch` reset unconditionally after 2.5 s; this branch removed
  that reset without adding a reachable exit. Regression.
- **Single:** a `ready` job with `partial` or `failed` enrichment keeps
  `singleBusy` true (`:921-926`), and the panel offers only Retry
  (`:1388-1411`), with no dismiss. If the retry fails or isn't wanted, the
  page is stuck.

## P3 — hygiene / less likely

- **S3 — `job.drama.status` stays `running` after enrichment finishes, so
  trimmed-run GC never runs for videos enriched at ingest.**
  `lib/ingest/pipeline.ts:472-503` persists `running` at handoff; later
  runner updates use `persist: false`. `hasActiveDramaStatus`
  (`lib/drama/trimmed-run-gc.ts:61-69`) checks `job.drama.status` and skips
  the video as `run_active`. Fail-safe direction, but `todo/50` F8 does not
  apply on the main path.
- **S4 — race between retry and Library Start.** The retry route does not
  consult `start-existing`'s `starting` set. `start-existing` awaits
  `resolveIngestJob` and `prepareDramaHandoff` between its
  `isDramaRunActive` check (`:58`) and launch (`:89`), on a shared in-memory
  job. Near-simultaneous clicks can return 202 for a run that never
  executes. Inferred; low likelihood.
- **S5 — 500 instead of 400.** `app/api/library/[videoId]/drama/route.ts:32`
  `await request.json()` on malformed JSON falls to `DRAMA_START_FAILED` 500.
  That route and `app/api/drama-media/[videoId]/[runId]/[...rest]/route.ts:28-33`
  call `decodeURIComponent` outside `try`, so `%E0` throws `URIError` and
  returns 500.
- **S6 — subtitle vectors carry no provider/variant identity.**
  `lib/drama/index-subtitles.ts` writes `text_embedding` with fixed index
  dims and no provider tag. Changing `EMBED_DIMS` makes every subtitle bulk
  fail under the strict mapping; changing provider silently mixes vectors
  (invariant #3 in spirit). No query reads the field yet.
- **S7 — `renameAssetTitle` is not atomic.** `lib/es/asset-rename.ts:91-118`
  updates the asset, then chunks via `update_by_query` with
  `conflicts: 'proceed'`, without checking `version_conflicts` or
  `failures`. A partial failure cannot be re-run, because the
  `expectedTitle` guard now mismatches. A job still in app memory can also
  revert the title on the next `persistJob`. The only caller is an
  already-executed one-off script.
- **S8 — script/SRT paths are stored absolute.**
  `lib/drama/media-access.ts:47-48` compares absolute paths, so a writer and
  a server with different `MEDIA_ROOT` (container vs host `yarn dev`) show
  links that 404.
- **U4 — a clean batch after a batch with skips shows "Completed with
  errors".** `batchRetainRef` is reset only in `resetBatchForm`, not in
  `startBatchImport` (`app/ingest/page.tsx:680-690`).
- **U5 — upload kept on disk when enrichment is rejected.**
  `acceptDramaForIngest`'s duration check runs after the file is written to
  originals (`app/api/ingest/upload/route.ts:70-90`,
  `app/api/ingest/route.ts:187-193`,
  `app/api/ingest/batch/route.ts:117-122`, `:148-157`), with no cleanup.
  Whether another GC reclaims these files was not checked.
- **U6 — all-rejected batch hides the reason.**
  `app/api/ingest/batch/route.ts:296-298` returns `INGEST_BATCH_EMPTY`
  ("no video files found") and drops the collected `errors`, e.g. "too long
  for enrichment".
- **U7 — ingest page lacks the client check "key_actors needs
  directors_script".** `app/ingest/page.tsx:502-518` lacks it;
  `components/DramaStartFlyout.tsx:78-84` and the server
  (`INGEST_DRAMA_NEEDS_DIRECTORS`) have it. The user learns only after the
  whole upload body is sent.
- **U8 — catalogs load failure shows stored values as "—".**
  `components/EditMetadataFlyout.tsx:526-534` degraded mode leaves only the
  empty option (`:588-617`), so stored type, language and country look
  blank. Not overwritten unless touched.

## Additions to tracked items

- **`todo/53` D3** also triggers on a full localized label: typing
  `预告片` in the zh UI compares against `entry.id === name`
  (`components/SearchGroupFilter.tsx:148`) where the id is `trailer`, so it
  still shows "no match". The fix should match labels too.
- **`todo/46` retry polling race** also hits the ingest page:
  `attachStream` / `attachBatchStream` close on a first snapshot that is
  still `failed` (`app/ingest/page.tsx:353-364`). Batch retry also
  double-counts the failure.

## Checked and rejected

- **drama-media path traversal:** segments with `/` or `..` are rejected;
  `resolve` + inside check, exact allow-listed paths, and realpath against
  symlinks.
- **Trimmed runs still served:** only the current run and run IDs in `runs`
  history are served.
- **Run-history cap:** Painless, GC and DTO consistently keep current + 5
  prior runs. The `todo/50` wording "newest 5" is imprecise, not a bug.
- **Subtitle docs leaking across runs or videos:** retirement is scoped by
  `video_id` + language + `keepRunId`.
- **Trap #4:** `persistJob` is create-if-absent + partial update; `meta` is
  never in that patch.
- **Strict mapping vs `meta.drama` payload:** the contract test covers every
  field.
- **Mapping upgrade:** additive only; omitted defaults handled; run live
  under `todo/50`.
- **Group backfill:** Painless no-op guard, revision bump,
  `review.group_id` mapped.
- **Retry body validation:** 4096-byte cap, strict schema, `JSON.parse` →
  400.
- **Custom chunk preset:** client and server agree (`^\d+$`, `w > 0`,
  `0 ≤ o < w`).
- **Long CJK filenames:** truncated on UTF-8 byte boundaries, no
  separators, token-suffixed.
- **EventSource / Library polling:** closed or cleared on unmount.
- **Save 409 and Suggest revision conflict:** handled.
- **Uncited suggestions:** all go to the pending-review area; none is
  dropped or auto-applied.
- **PATCH sends only changed fields:** true, except Group (U1).
- **Rename and chunk vectors:** the script writes only `video_title`. Not
  confirmed whether Serverless `update_by_query` preserves vectors under
  `exclude_source_vectors`; a kNN spot-check on a renamed video is owed.

## Gates

| Gate | Result |
| --- | --- |
| `yarn test` / `yarn build` at `92b317b` | **PASS** earlier on 2026-10-03 (809 tests, Node 22.13.1); no code changed since. **Not re-run** for this review |
| Live reproduction of S1 / S2 against Elasticsearch | **NOT RUN** |
| Browser reproduction of U1 / U2 / U3 | **NOT RUN** — traced in code |
| Upload-orphan check in the container (U5) | **NOT RUN** |
| kNN spot-check of a renamed video (vectors intact) | **NOT RUN** |
