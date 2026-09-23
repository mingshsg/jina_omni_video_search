# Reviews

Active reviews only. Each one has a follow-up tracker in `todo/`; the tracker,
not the review, is where open work lives — so archiving a review body never
loses an action item.

## Current — project level

- [`project-level-review-2026-09-23.md`](./project-level-review-2026-09-23.md)
  — **repository as a whole.** `next@14.2.35` carries a critical
  unauthenticated RCE (image optimizer route on by default, no 14.x patch
  exists); six P1s from `todo/22`/`todo/30` were built over for eleven
  commits and six new plans; `app/api`, `lib/embed` and `components` have
  zero tests; README predates the hybrid feature; 104 open items across 20
  trackers with no rollup. → [`todo/31`](../todo/31-project-level-review-2026-09-23.md)

## Current — hybrid metadata search

- [`hybrid-suggest-pipeline-review-2026-09-23.md`](./hybrid-suggest-pipeline-review-2026-09-23.md)
  — **Suggest pipeline.** Write-safety holds (never writes, cancellation safe,
  no secret leak) but the trust boundary does not: failure is displayed as
  success, an *ambiguous* agent answer is auto-applied with a fabricated 0.7
  confidence, fetched page content can be parsed as the agent payload, and an
  unauthenticated route writes model-derived aliases into the search hot path.
  → [`todo/30`](../todo/30-suggest-pipeline-review-2026-09-23.md)
- [`hybrid-metadata-search-independent-code-review-2026-09-23.md`](./hybrid-metadata-search-independent-code-review-2026-09-23.md)
  — **Whole worktree.** Gates are green but do not cover the highest-risk
  path: the guaranteed-recall floor sends `retriever` in an `_msearch` body
  the installed client does not type (`as never` suppresses it), reachable
  only through a silent `catch`, with no test and no live-cluster evidence.
  → [`todo/22`](../todo/22-hybrid-independent-code-review-2026-09-23.md)
- [`hybrid-code-recheck-2026-09-23.md`](./hybrid-code-recheck-2026-09-23.md)
  — independent re-confirmation of the three `todo/22` P1s against current
  source. Supersedes the status wording of the archived phase reviews.
- [`hybrid-metadata-search-holistic-review-2026-09-23.md`](./hybrid-metadata-search-holistic-review-2026-09-23.md)
  — cross-phase verdict and the exact local-only Suggest internet boundary.
  → [`todo/16`](../todo/16-hybrid-holistic-review-and-internet-suggest-2026-09-23.md)
- [`hybrid-internet-suggest-code-review-2026-09-23.md`](./hybrid-internet-suggest-code-review-2026-09-23.md)
  — Agent Builder / Jina tool wiring for Phase 4b. → [`todo/16`](../todo/16-hybrid-holistic-review-and-internet-suggest-2026-09-23.md)
- [`hybrid-suggest-post-rebuild-smoke-2026-09-23.md`](./hybrid-suggest-post-rebuild-smoke-2026-09-23.md)
  — post-rebuild smoke evidence for the Suggest path.

## Archive

`reviews/archive/` holds resolved and superseded reviews. It is **on disk but
not tracked by Git** (`.gitignore`), so it does not appear in diffs, clones or
PR reviews. Treat it as a local record: a fresh clone will not have it.

| Folder | Contents |
| --- | --- |
| `2026-09-10-file-video-search/` | readiness rounds and E2E verification for the original file-video baseline |
| `2026-09-10-live-video-planning/` | superseded live-video architecture and readiness planning rounds |
| `2026-09-12-live-video-code-and-readiness-reviews/` | Phase 1–9 code review and Phase 10 readiness review |
| `2026-09-13-live-video-implementation/` | live-video batch reports, RTSP/E2E run manifests, completion audits — the feature shipped in `93425bc` |
| `2026-09-22-hybrid-planning/` | hybrid plan review rounds 1, 2 and the r3 readiness review; corrections landed in `2043ada` |
| `2026-09-22-hybrid-phase-reviews/` | per-phase hybrid implementation reviews and their fix reports, superseded by the holistic review and the recheck above |

## Policy

- A review produces two files: `reviews/<scope>-<kind>-<YYYY-MM-DD>.md` and a
  numbered `todo/NN-<scope>-<YYYY-MM-DD>.md`. Add the review here on top.
- Review bodies are evidence and are never edited. Supersede them with a new
  dated review instead.
- Move a review to `archive/` when its scope has shipped or a later review has
  superseded it. Open items stay in `todo/`, which is tracked — so archiving
  is safe.
- Keep run artifacts (`*.json` manifests) with the review that produced them.
