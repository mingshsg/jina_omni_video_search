# todo/52 — Trimmed-run age guard + scene moment buttons (2026-10-02)

Source: [`reviews/trimmed-run-age-guard-and-scene-buttons-code-review-2026-10-02.md`](../reviews/trimmed-run-age-guard-and-scene-buttons-code-review-2026-10-02.md).
Review of `c9e3b57` plus a branch-wide trap scan of `codex/enrichment-add-runs`.

## Findings

- [x] **G1 (P2)** — make `treeStats` in `lib/drama/trimmed-run-gc.ts` fail
      closed. **Fixed 2026-10-02.** `treeStats` now returns `complete:
      false` on any unreadable entry (unreadable subdirectory, or a file
      that vanishes between `readdirSync` and `statSync`) instead of
      silently returning the partial stats accumulated so far; the sweep
      records a new `skipped` reason `'scan_error'` with the `runId` and
      never treats that run as a deletion candidate. Both reproductions
      from the review are now regression tests: an unreadable `work/`
      subdirectory (`chmod 000`, skipped when not running as root) and a
      file mocked to throw `ENOENT` mid-scan. `drama-gc-sweep
      --trimmed-runs=delete` is safe to run again.
- [x] **G2 (P3, optional)** — keep `group.representative` among the visible
      scene moment buttons when a scene has more than
      `SCENE_MOMENT_BUTTONS_MAX` members (`app/page.tsx`,
      `app/search-image/page.tsx`). **Fixed 2026-10-02.** New
      `pickVisibleSceneMoments()` (`lib/es/group-hits.ts`) returns the
      first `SCENE_MOMENT_BUTTONS_MAX` members, swapping the representative
      in (re-sorted chronologically) when it would otherwise fall past the
      cap; both pages now call it instead of a raw `.slice()`. Tests cover
      under-cap, representative-already-visible, and representative-swapped
      cases.
- [x] **G3 (P3)** — move the untracked stale copies
      `reviews/suggest-metadata-editor-session-review-2026-09-23 (1).md` and
      `todo/32-suggest-metadata-editor-session-2026-09-23 (1).md` out of the
      tree. **Fixed 2026-10-02** — moved (not deleted) to
      `reviews/archive/2026-09-23-suggest-metadata-editor-stale-duplicates/`,
      which is gitignored, so they're no longer a `git add -A` risk.

## Gates

- [x] `yarn test` — 108 files / 804 tests pass (Node 22.13.1).
- [x] `yarn build` — passes.
- [x] Post-fix re-run (2026-10-02, Homebrew Node 25): `yarn test` 108 files /
      809 tests pass (`--testTimeout=20000`; the default-timeout run hit the
      pre-existing, unrelated `key-scenes` flake under full parallelism
      already documented in `todo/38` — passes alone and with a longer
      timeout, confirmed not a regression). `yarn build` passes.
- [x] G1 reproduced in report mode with a `/tmp` fixture.
- [x] G1 `ENOENT` race — reproduced via a mocked `fs.statSync`, now fixed
      and covered by a regression test alongside the `EACCES` case.
- [ ] Browser check of the 12-button cap and "+N more" text.
- [ ] `drama-gc-sweep --trimmed-runs=delete` on real media (previously
      blocked on G1; unblocked now, but still not run against real data).
- [ ] Docker image rebuilt and checked with this commit.
