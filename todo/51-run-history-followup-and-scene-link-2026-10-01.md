# todo/51 — Run-history follow-up + scene linking recheck (2026-10-01)

Source: [`reviews/run-history-followup-and-scene-link-code-review-2026-10-01.md`](../reviews/run-history-followup-and-scene-link-code-review-2026-10-01.md).
Independent review of `cdbdc3f` (todo/50 F7), `ffbcccb` (todo/50 F8), and
`221c383` (scene linking) — co-authored with Cursor, not reviewed before
this pass.

## Result

No P1/P2/P3 findings. All three commits are correct, tested, and consistent
with established conventions (see review for the per-commit reasoning).

## Gates

- [x] `yarn test` — 108 files / 803 tests pass (Homebrew Node 25; Node 22
      unavailable in this shell).
- [x] `yarn build` — compiles, typechecks, all 20 routes.
- [ ] Browser check of `earlier_run_sources` labels and the Scene linking
      selector in the actual search UI.
- [ ] `drama-gc-sweep --trimmed-runs=delete` against real data (report mode
      already found 0 candidates per `todo/50`; delete path unexercised).
- [ ] Product sign-off on the scene-link default (gap 0, no length cap)
      replacing the old 2×window span cap for everyone, not just as an
      opt-in toggle.
