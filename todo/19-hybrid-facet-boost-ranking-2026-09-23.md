# Todo — Hybrid extracted-facet ranking boost (2026-09-23)

User note: `no_effect` when no candidate matches is fine; when country/etc.
does match, it must be a **numeric** hybrid boost so similar videos prefer
the matching ones (not a hard filter).

## Done

- [x] Investigate: boosts only apply inside the fusion candidate pool;
  `no_effect` was reporting-only and did not zero scores
- [x] Fix: score fusion with `deriveExtractedBoostEffects().applied` only so
  `no_effect` sibling facets do not dilute `matched/selected`
- [x] Unit tests: similar visual ranks → KR ranks higher; dilution guard;
  `no_effect` when pool has no KR
- [x] Plan §C note: `n_selected` = pool-effective facets only
- [x] Re-verified 2026-09-23: `yarn test` 362 passed; `yarn build` PASS
  (clean `.next`)

## Boost behavior (current)

- Full facet match adds `w_facet / (C+1)` ≈ `0.2/61` on the hybrid RRF score
- Enough to flip near-peer visual ranks in the same fusion batch
- Zero assets matching a facet → `rejected` with `no_effect` (OK; no hard filter)

## Out of scope

- Suggest / Wikidata
- Auto-commit
- Changing `w_facet` magnitude (still 0.2 on RRF scale)
