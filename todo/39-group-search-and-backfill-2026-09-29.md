# todo/39 — Group search and manual backfill follow-up (2026-09-29)

Source: [`reviews/group-search-and-backfill-code-review-2026-09-29.md`](../reviews/group-search-and-backfill-code-review-2026-09-29.md). This is the next update plan and work tracker. No application code was changed in the review. Keep the existing explicit per-video backfill; never run bulk or automatic group assignment as part of these tasks.

## Next update — implementation order

- [ ] **G1 (P2) Variant compatibility:** Preserve the explicit `variant_id` search contract and `variant_id` vector identity. Add a server-backed group/ready-variant availability result that is not limited by `/api/library`'s newest 200 assets. When selected groups have no ready assets in the current variant, show that state and compatible variant choices before or with the empty result; do not silently switch a user's selected variant. Cover one group with only a nondefault variant, groups spanning variants, and a genuinely empty group. Verify file and live search contracts stay unchanged.
- [ ] **G2 (P2) Selection bound:** Cap the primary Group ComboBox at 20 selected IDs, show why further selection is unavailable, and keep All/clear/reset usable. Add a focused UI/helper and request-schema test for 20 accepted vs 21 rejected/blocked.
- [ ] **G3 (P2) Catalog reliability:** Make group lookup independent of people-catalog loading; return an explicit incomplete/error status when ES group enumeration fails. Show loading, failure, and retry in the search control while keeping All usable. Cover people-catalog failure, ES aggregation failure, recovery, and preservation of selected IDs.
- [ ] **G4 (P3) Search trigger:** Group changes before the first explicit Search should only update filters. For a previously submitted query, choose and document either one debounced rerun or explicit Search; avoid one provider request per rapid selection. Test request counts and stale-response handling.
- [ ] **G5 (P3) Catalog scale:** Replace fixed top-200-only selection with searchable/paginated group lookup or a visible incomplete state before the catalog exceeds 200 distinct IDs. Test that an older/low-frequency group remains selectable. This may follow G1–G4 if the current index remains below that limit.

## Acceptance after implementation

- [ ] Run `yarn test` and `yarn build` under Node 22 on the exact update revision; record counts and failures, not just a prior run.
- [ ] Rebuild the app container after code changes, then browser-check Group = All by default, single/multiple selection, reset, 20-group bound, catalog failure/retry, Variant compatibility messages, and Search request count.
- [ ] On a deliberately grouped fixture, verify text file-search results for one and multiple groups, ungrouped videos under All, and zero matches for a genuine mismatch. Regression-check the image-search filter API and unchanged live-search behavior. Record request, response, and expected video IDs without secrets.
- [ ] With a user-chosen eligible video, submit one manual backfill; verify exactly its `meta.group_id` and revision changed, its chunks/variants did not, an existing-group repeat returns conflict, and another video stayed unchanged. No automatic or bulk write.
- [ ] Keep labeled relevance, representative p95/cost, drama episode quality, and multi-replica durability in their existing trackers; these gates do not pass from unit/build or the Group UI smoke.

## Decision and scope notes

- Recommended behavior for G1: explain the mismatch and offer compatible Variant choices. A cross-variant “All variants” search would need a separate API/ranking design because variants can differ by provider, model, dims and normalization; do not add it as a shortcut here.
- This tracker does not supersede the open acceptances in `todo/34`, `todo/35`–`todo/38`, or the auth decision in `todo/30` S7/S8. Reconcile their status when those paths are actually verified.
