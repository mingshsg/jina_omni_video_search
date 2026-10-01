# Run-history follow-up + scene linking code review — 2026-10-01

Scope: three commits landed on `codex/enrichment-add-runs` after
[`todo/50`](../todo/50-drama-run-history-2026-10-01.md)'s fixes, co-authored
with Cursor, not reviewed before this pass:

- `cdbdc3f` — label results that fall back to an earlier enrichment run
  (`earlier_run_sources`, `todo/50` F7).
- `ffbcccb` — operator sweep for run directories trimmed from history
  (`lib/drama/trimmed-run-gc.ts`, `todo/50` F8).
- `221c383` — chain linked search moments into one scene with a
  user-adjustable gap setting (`SCENE_LINK_GAP_CHOICES_S`,
  `components/SceneLinkGapSelect.tsx`) — unrelated to the drama work, the
  idea discussed earlier in this session for grouping search results by
  more than a fixed time span.

**Verdict: no blocking issues. All three are correct, tested, and
consistent with established conventions.**

## Checked and confirmed sound

- **F7 (`earlier_run_sources`).** `earlier(run)` attributes a section to an
  older run purely by `run_id !== metaDrama.run_id`; since only the current
  run can share that ID (historical snapshots always get a distinct
  `run_id` by construction in `persist-meta.ts`'s Painless script), this is
  correct without needing position-in-array logic. The `firstWith` generic
  I'd fixed for typecheck in the prior pass was removed entirely in favor of
  explicit per-field lookups (`structureRun?.structure?.map(...)` etc.) —
  a cleaner fix than keeping the generic. New tests cover a mixed-source
  result, an all-current-run result (no labels), and the per-language
  subtitle-source case. The pre-existing `safe-dto.test.ts` assignment-cast
  diagnostic I'd flagged as out of scope is now fixed with a clean
  `as unknown as VideoAssetDocument['meta']` double cast.
- **F8 (trimmed-run GC).** `sweepTrimmedDramaRuns` reuses the exact
  `stat(runDir).mtimeMs` age-guard pattern already established and reviewed
  in `frame-gc.ts` (R10) — not a new risk pattern. Deletion requires: the
  asset still exists in ES, no active persisted drama status (meta *or*
  job, so a stale-but-not-yet-reconciled job record still protects it),
  the run ID isn't in `referencedDramaRunIds` (current + history + job
  record), and the directory is older than `DRAMA_GC_MIN_AGE_MS` (reused
  from the existing env module, not a new one). Report-only by default;
  `delete` is an explicit, separate CLI flag. `maxRuns`/`maxScanVideos`
  bound a single invocation. Six tests cover report, delete, and every skip
  reason plus the cap.
- **Scene linking.** The chain rule (`hit.start_ms <= latestEnd +
  linkGapMs`, tracking the running max end) replaces the old
  span-from-first-hit cap only when grouping is invoked with `linkGapMs`
  set; any caller not passing it (there are none left — grep confirms only
  the two search pages call `groupSearchHitsTopK`, both updated together)
  keeps the old behavior. Both pages now default to `linkGapMs: 0`
  (overlap/touching only, no length cap), which is a deliberate default
  change from the old 2×window span cap, not an opt-in toggle — matches the
  commit's stated intent. Traced through the three new tests by hand
  (chained overlapping windows, a gap that only bridges at a large enough
  tolerance, exact-touching at gap 0) — all arithmetic checks out. i18n keys
  present in both `en`/`zh` dictionaries.

## Gates

- `yarn test`: **PASS** — 108 files / 803 tests (Homebrew Node 25; Node 22
  unavailable in this shell, as in prior passes).
- `yarn build`: **PASS** — compiles, typechecks, all 20 routes.

**Still NOT RUN:** browser check of `earlier_run_sources` labels and the
Scene linking selector in the actual search UI; the trimmed-run-gc
`delete` mode against real data (the report-only run already recorded in
`todo/50` found 0 candidates, so delete is unexercised); whether the scene
chain default (gap 0, no length cap) changes relevance perception enough to
warrant a product check.
