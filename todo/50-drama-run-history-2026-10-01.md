# todo/50 — Drama run-history review follow-up (2026-10-01)

Source: [`reviews/drama-run-history-code-review-2026-10-01.md`](../reviews/drama-run-history-code-review-2026-10-01.md).
Reviewed and fixed the uncommitted "keep prior drama run results visible
after a fresh re-enrichment" work on `codex/enrichment-add-runs`.

## P1

- [x] **F1** — live `video-assets` mapping was missing `meta.drama.runs`;
      first write would 500 with `strict_dynamic_mapping_exception`.
      **Fixed 2026-10-01.** Ran `yarn setup-indices` against the configured
      cluster (idempotent, zero conflicts); live-verified a full
      create→7-runs→read→delete cycle afterward.

## P2

- [x] **F2** — `subtitle_count` fallback in `lib/drama/safe-dto.ts` could
      show a nonzero count with zero links when subtitle files existed but
      weren't in the recognized `subtitles/<lang>.srt` layout.
      **Fixed 2026-10-01.** Count now always reflects
      `Object.keys(subtitleUrls).length`; `undefined` only when no run ever
      recorded `subtitle_paths`. Updated one pre-existing test's unrealistic
      fixture path to match real layout instead of keeping a workaround.
- [x] **F3** — `meta.drama.runs` grew without bound across repeated
      re-enrichment. **Fixed 2026-10-01.** Capped at 5
      (`DRAMA_RUN_HISTORY_MAX`, trims oldest-first in the Painless script);
      live-verified 7 runs → exactly the 5 most recent retained.
- [x] **F4** — `firstWith` helper in `safe-dto.ts` failed to typecheck
      (would have broken `yarn build`; not caught by `yarn test`, which
      doesn't typecheck). **Fixed 2026-10-01** with an explicit
      `RunSnapshot` type.

## P3

- [x] **F5** — terminal/active drama-status lists duplicated as untyped
      string literals in 4 places. **Fixed 2026-10-01** — centralized as
      `DRAMA_ACTIVE_STATUSES`/`DRAMA_TERMINAL_STATUSES` in
      `lib/ingest/drama-options.ts`.
- [x] **F6** — new "Previous enrichment runs" heading bypassed the i18n
      dictionary. **Fixed 2026-10-01** — added `dramaResultPreviousRuns` to
      `lib/i18n/ui.ts`.

## Gates

- [x] `yarn test` — 107 files / 793 tests pass (Homebrew Node 25; Node 22
      unavailable in this shell, same substitution as prior sessions).
- [x] `yarn build` — compiles, typechecks, all 20 routes.
- [x] Live Elasticsearch check: `yarn setup-indices` mapping upgrade +
      disposable-doc `persistDramaMeta` round trip (create → 7 runs → read →
      delete), confirming both the mapping fix and the history-cap Painless
      logic against the real cluster.
- [ ] Real re-enrichment end-to-end through the rebuilt container with
      actual media (ASR, director's script, key scenes/actors).
- [ ] Browser check of the "Previous enrichment runs" list in
      `DramaResultsFlyout`.
- [ ] Product sign-off that 5 is the right history-retention count (ops
      judgment, not a correctness question).

## Known pre-existing, out of scope here

- `lib/drama/safe-dto.test.ts`'s `(doc.meta as Record<string, unknown>) =
  ...` assignment-cast does not "sufficiently overlap" per the TS language
  service. Already present on `HEAD` before this work; does not fail
  `yarn build` (tests are outside its typecheck scope) or `yarn test`
  (Vitest doesn't typecheck). Worth a follow-up cleanup, not blocking.
