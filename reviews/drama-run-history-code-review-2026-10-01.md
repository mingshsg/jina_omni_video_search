# Drama run-history code review — 2026-10-01

Scope: uncommitted working-tree changes on `codex/enrichment-add-runs` (on top
of committed `ff579da`) that let a video be re-enriched after a prior drama
run finished, keeping the earlier run's artifacts/results visible instead of
overwriting them. Touches `lib/drama/persist-meta.ts`, `media-access.ts`,
`safe-dto.ts`, `start-existing.ts`, `lib/es/asset-meta-mapping.ts`,
`components/DramaResultsFlyout.tsx`, `app/library/page.tsx`, plus their
tests. Not authored in this session; reviewed, fixed, and live-verified here.

**Verdict: the design is sound and now matches the deployed cluster; one P1
and three P2s were found and fixed.**

## P1 — blocking, confirmed and fixed

- [x] **F1 — live `video-assets` mapping was never migrated for the new
      `meta.drama.runs` field.** The code added
      `runs: { type: 'object', enabled: false }` to
      `videoAssetsMetaMappingProperties()` (`lib/es/asset-meta-mapping.ts`),
      but nobody had run the upgrade against the real cluster. A disposable
      live-cluster check (create a throwaway asset, call `persistDramaMeta`
      with a new `run_id`, which triggers the history-snapshot branch) threw
      `strict_dynamic_mapping_exception: ... dynamic introduction of [runs]
      within [meta.drama] is not allowed` — the exact mapping/payload-parity
      failure mode this repo already hit once in `todo/38` I1. The very
      first re-enrichment attempt in production would have 500'd.
      **Fixed:** ran `yarn setup-indices` against the configured cluster
      (idempotent `putMapping` upgrade, zero conflicts,
      `meta.properties.drama.properties.runs` added), then re-ran the same
      disposable check — now succeeds end to end (see Gates).

## P2 — should fix, confirmed and fixed

- [x] **F2 — `subtitle_count` fallback could show a count with zero
      playable links.** `dramaResultsFromAsset` (`lib/drama/safe-dto.ts`)
      computed `subtitle_count` as
      `Object.keys(subtitleUrls).length || runs.reduce(... subtitle_paths
      length ...)`. Whenever no run had a subtitle file in the recognized
      `subtitles/<lang>.srt` layout — e.g. a run that only produced a host
      transcript, which `media-access.ts` deliberately never authorizes —
      the OR fallback summed raw (including unexposed/unparseable)
      `subtitle_paths` across every run, so the flyout could render
      "Subtitles: 5" with zero links beneath it. **Fixed:** count is now
      always `Object.keys(subtitleUrls).length` (the honest, exposed count),
      `undefined` only when no run ever recorded `subtitle_paths` at all (so
      the section still hides itself when subtitles were never attempted).
      Updated the one pre-existing test whose fixture path lacked a
      `subtitles/` folder (an unrealistic layout only used to test path
      redaction) to a realistic path, rather than keep designing around it.
- [x] **F3 — `meta.drama.runs` grows without bound.** Every fresh
      re-enrichment appended a full snapshot of the previous terminal run
      (subtitle paths, structure, synopsis text, key scenes/actors) with no
      cap, so a video re-enriched many times over its life would carry an
      ever-growing document. **Fixed:** `DRAMA_RUN_HISTORY_MAX = 5` in the
      Painless script trims from the front (oldest first) once history
      exceeds the cap. Live-verified: 7 distinct runs → final `runs` holds
      exactly `[run2, run3, run4, run5, run6]`, oldest (`run1`) dropped.
- [x] **F4 — `firstWith` helper did not typecheck, breaking `yarn build`.**
      `safe-dto.ts`'s `runs` array mixes `DramaMetaPayload` (current run)
      and `Omit<DramaMetaPayload, 'runs'>` (history entries); TS inferred a
      union element type that a generic `keyof DramaMetaPayload` index
      couldn't be applied to (`Type 'K' cannot be used to index type
      'Omit<DramaMetaPayload, "runs">'`). This was not caught by `yarn test`
      (Vitest doesn't typecheck) or visible without running `yarn build`.
      **Fixed:** introduced a local `RunSnapshot = Omit<DramaMetaPayload,
      'runs'>` type and typed both `runs` and `firstWith`'s generic against
      it.

## P3 — hygiene, fixed

- [x] **F5 — terminal/active drama-status lists duplicated in four places**
      (`start-existing.ts`, `app/library/page.tsx` ×3,
      `DramaResultsFlyout.tsx`), as untyped string-literal arrays that could
      silently drift from each other or from `DramaEnrichmentStatus`.
      **Fixed:** added `DRAMA_ACTIVE_STATUSES` / `DRAMA_TERMINAL_STATUSES` to
      `lib/ingest/drama-options.ts` (already a dependency-free constants
      module safe for client components) and pointed all five call sites at
      them.
- [x] **F6 — new "Previous enrichment runs" heading bypassed the i18n
      dictionary**, using an inline `locale === 'zh' ? ... : ...` ternary
      next to half a dozen sibling headings that all use `t.dramaResultXxx`.
      **Fixed:** added `dramaResultPreviousRuns` to `lib/i18n/ui.ts`
      (interface + both locales) and switched the component to use it.

## Checked and not changed

- `media-access.ts`'s run lookup (`[drama, ...(drama.runs ?? [])].find(...)`)
  and its new test correctly serve only the exact published-file list for
  the matched historical run — confirmed no path outside each run's own
  publication list is reachable, and a `runId` with no match (current or
  history) returns `null`.
- `start-existing.ts`'s terminal-status gate correctly still defers to
  `isDramaRunActive()` (the real per-process lease) as the authoritative
  check; the status-string gate only prevents offering "start fresh" while
  the persisted record says a run is in flight (including a stale
  post-crash `running` marker, which should go through Retry, not a new
  run — unchanged, intentional).
- The new `runs: { type: 'object', enabled: false }` mapping is correctly
  excluded from the `drama-mapping-contract.test.ts` I1 walk (an
  `enabled: false` subtree is allowed to contain anything), so historical
  snapshots are never required to satisfy the full strict schema.
- A pre-existing (not introduced by this change, already on `HEAD`) TS
  diagnostic in `safe-dto.test.ts` — `(doc.meta as Record<string, unknown>)
  = ...` doesn't "sufficiently overlap" — does not fail `yarn build` (test
  files are outside its typecheck scope) or `yarn test` (Vitest doesn't
  typecheck). Left alone as out of scope for this pass; worth a follow-up.

## Gates

- `yarn test`: **PASS** — 107 files / 793 tests (Node 22 unavailable in this
  shell; ran on Homebrew Node 25, same substitution prior sessions used).
- `yarn build`: **PASS** — compiles, typechecks, all 20 routes.
- **Live Elasticsearch check (not a mock):** ran `yarn setup-indices`
  against the configured cluster to add the missing mapping, then a
  disposable throwaway asset doc through 7 distinct `persistDramaMeta`
  calls, confirmed `meta.drama.run_id === 'run7'` and
  `meta.drama.runs` == the 5 most recent prior runs via a live `GET`, then
  deleted the doc. This is the first evidence this exact code path has run
  against a real cluster.

**Still NOT RUN:** a real re-enrichment end-to-end with actual media (ASR,
director's script, etc.) through the rebuilt container; browser check of the
new "Previous enrichment runs" list rendering; whether 5 is the right
history cap (a product/ops judgment call, not a correctness one).
