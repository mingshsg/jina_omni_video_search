# Code review — trimmed-run age guard + scene moment buttons (2026-10-02)

**Scope:** commit `c9e3b57` ("fix: harden trimmed-run age guard and bound
scene moment buttons"), the only commit on `codex/enrichment-add-runs` not
covered by an earlier review (the previous recheck,
[`run-history-followup-and-scene-link-code-review-2026-10-01.md`](./run-history-followup-and-scene-link-code-review-2026-10-01.md),
ended at `53fd89a`). Plus a branch-wide pass (`live-video-search...HEAD`,
55 commits, 226 files) for the AGENTS.md known traps.

**Verdict: no P1. One P2 — the new tree-wide age guard fails open on any
filesystem error, so the active-run deletion it was written to prevent is
still reachable (reproduced). Two P3 hygiene items.**

## Findings

### P2 — should fix

- **G1 — `treeStats` treats a filesystem error as "nothing newer", so the
  trimmed-run sweep can still select an active run.**
  `lib/drama/trimmed-run-gc.ts:75-96`:

  ```ts
  function treeStats(dir: string): { bytes: number; newestMtimeMs: number } {
    let bytes = 0;
    let newestMtimeMs = 0;
    try {
      newestMtimeMs = fs.statSync(dir).mtimeMs;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        ...
          const stat = fs.statSync(p);
        ...
      }
    } catch {
      /* ignore */
    }
    return { bytes, newestMtimeMs };
  }
  ```

  One `try` wraps the whole directory loop, and the `catch` returns whatever
  was accumulated so far. Two ways this under-reports the newest mtime:

  1. **Unreadable subdirectory (reproduced).** `readdirSync` throws `EACCES`;
     the subdirectory's own mtime is returned, which does not change when an
     existing file inside it is appended to. Reproduction (`/tmp`, Node
     22.13.1, `tsx`): run dir and `work/` set to 2 h old, `work/transcript.part`
     written just now, `chmod 000 work/`, sweep with `minAgeMs = 1h`,
     `apply: false`. Output:

     ```json
     { "candidates": [ { "videoId": "v1", "runId": "active", "bytes": 0 } ] }
     ```

     The active run is a deletion candidate and its size is reported as 0.
     Mixed container/host ownership under `MEDIA_ROOT` (the Compose app writes
     into the bind mount; the operator runs the script on the host) makes this
     plausible, and with `--trimmed-runs=delete`, `fs.rmSync(..., {recursive})`
     at `:167` removes whatever siblings it can before failing on the
     unreadable directory — a partially destroyed run lands in `kept`.
  2. **Entry vanishes mid-scan (code reading, not reproduced).** An active run
     that writes via temp file + rename can remove an entry between
     `readdirSync` and `statSync(p)`. The `ENOENT` aborts the loop for that
     directory, so every later sibling — possibly the freshest file — is never
     inspected.

  The commit message states the purpose is that "a failed best-effort status
  marker could have let the sweep delete an active run"; G1 leaves the same
  outcome reachable through a different failure. A GC guard should fail
  closed.

  **Fix:** per-entry `try`; on `ENOENT` for an entry, treat the tree as fresh
  (a disappearing file is evidence of activity) or at least continue the loop;
  on any other error, return a sentinel (e.g. `newestMtimeMs: Infinity` or a
  `complete: false` flag) so the caller skips the run and records it in
  `skipped` with a new reason such as `'scan_error'`. Add regression tests
  for both the `EACCES` and the vanished-entry cases (the latter can be
  driven by mocking `fs.statSync` once).

### P3 — hygiene

- **G2 — the best-scoring moment can lose its button on a long scene.**
  `app/page.tsx:1265` and `app/search-image/page.tsx:544`:

  ```tsx
  {group.members.slice(0, SCENE_MOMENT_BUTTONS_MAX).map((m) => (
  ```

  `members` is sorted by `start_ms` (`lib/es/group-hits.ts:86-93`), so on a
  chained scene with more than 12 moments the representative (highest score)
  may sit past index 11. Clicking the card still seeks to it and the
  timeline lists it, so nothing is unreachable — but the button row omits
  the single most relevant moment. Consider always including
  `group.representative` in the visible set (e.g. first 11 + representative
  when it falls outside). Optional.

- **G3 — two untracked duplicate files contradict their tracked versions.**
  `reviews/suggest-metadata-editor-session-review-2026-09-23 (1).md` and
  `todo/32-suggest-metadata-editor-session-2026-09-23 (1).md` are pre-fix
  snapshots: `diff` against the tracked files shows R1–R4 and R6–R9 still
  unchecked and the disposition block missing. A `git add .` would commit a
  second `todo/32` that says the fixed P1 (R1) is open. Not deleted here
  (repository owner's rule: no direct deletions); move them out of the tree
  or into `reviews/archive/` by hand.

## Checked and rejected

- **"+N more on the timeline" is truthful.** `timelineHits`
  (`app/page.tsx:348-358`, `app/search-image/page.tsx:237`) is every hit for
  the active video + variant, not just the visible buttons, and the strip
  renders once any card is clicked (`app/page.tsx:1330-1347`).
- **Test fixture change is correct.** `makeRun` now back-dates the file, the
  subdirectory and the run dir (`lib/drama/trimmed-run-gc.test.ts:21-23`);
  without that every existing case would see a fresh file and stop producing
  candidates. By reading, the new nested-file case would fail against the
  pre-commit code, which checked only the run directory's own mtime (not run).
- **GC reference set is complete.** Published subtitle/script media is served
  only for the current run or a run in `meta.drama.runs`
  (`lib/drama/media-access.ts:23-24`), and subtitle cue documents of other
  runs are purged by `keepRunId` (`lib/drama/index-subtitles.ts:161-164`), so
  no index still points into a directory `referencedDramaRunIds` omits.
- **`--max-runs` doc line** in `scripts/drama-gc-sweep.ts:13-14` matches the
  code (`maxScanVideos: maxRuns`, `:69`).
- **`as never` at `lib/es/indices.ts:293`** (mapping `putMapping`) predates
  this commit (`f175bc1`), carries an explanatory comment, and the migration
  it serves was live-verified under `todo/50`. Not re-raised.
- **Branch-wide trap scan:** no new `upsertAsset(` callers in the diff; no
  `*.test.ts` outside `lib/` or `worker/`; no files under `data/`; no
  secret-shaped literals in added lines; no new `as any` / `@ts-expect-error`
  / `@ts-ignore` in non-test code.

## Gates

| Gate | Result |
| --- | --- |
| `yarn test` | **PASS** — 108 files / 804 tests, Node 22.13.1 (`/usr/local/bin/node`; the shell default is Node 20.15.1 and `node_modules` was empty, so dependencies were installed with `yarn install --frozen-lockfile`) |
| `yarn build` | **PASS** — compiled and typechecked |
| G1 reproduction script (`/tmp`, report mode) | **RUN** — active run selected as candidate |
| G1 vanished-entry (`ENOENT`) case | **NOT RUN** — code reading only |
| Browser check of the 12-button cap and "+N more" text | **NOT RUN** |
| `drama-gc-sweep --trimmed-runs=delete` against real media | **NOT RUN** |
| Docker image rebuilt with this commit | **NOT RUN** |
| Live Elasticsearch / Serverless behavior | **NOT RUN** |
