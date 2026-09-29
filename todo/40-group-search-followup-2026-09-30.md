# todo/40 — Group search follow-up before push (2026-09-30)

Source: [`reviews/group-search-followup-code-review-2026-09-30.md`](../reviews/group-search-followup-code-review-2026-09-30.md). The five `todo/39` development commits are already local; hold the stacked push until P2 items and gates below are addressed. This tracker supersedes `todo/39`'s checked implementation status where the review found gaps. Do not auto-backfill groups.

## P2 — code and regression checks

- [ ] **R1 Complete Variant choices:** make a compatible ready variant selectable even if its asset is older than `/api/library`'s 200-result window. Keep variant identity explicit and user-controlled. Test >200 newer assets plus an older grouped ready asset.
- [ ] **R2 Availability truth:** distinguish unresolved/failed selected-group availability from a verified group with zero ready variants. Compose the same merged entry/status path used in the component in tests; cover loading, unavailable, truncated, starter-only, and verified-empty responses.
- [ ] **R3 Query submission and cost:** changing Group while the current input differs from the last submitted query must not submit the new draft. Choose explicit Search or debounce for rapid post-submit selections so three quick changes do not cause three provider calls. Verify request counts and stale-response behavior through an actual UI/request boundary.
- [ ] **R4 Shared catalog error contract:** preserve Group availability when people loading fails, while `SearchFacets` and `EditMetadataFlyout` visibly handle `people_status: unavailable` or retain the old HTTP error for their requests. Return only a fixed safe public error; test route and both actor clients.

## P3

- [ ] **R5 Lookup race/load:** invalidate in-flight exact lookup when input clears or locale changes; avoid a full 1000-group aggregation on every typed character. Test stale response ordering and type-clear behavior.

## Gates before push / acceptance

- [ ] Run the full Node 22 test suite and production build on the repaired exact revision; record counts and any remaining failures.
- [ ] Execute the new availability aggregation against the target ES mapping with a read-only grouped fixture; verify ready variant IDs and selected-group include behavior. Do not infer ES compatibility from mocked results.
- [ ] Rebuild the app image and browser-check Group default/selection/reset, Variant mismatch and explicit switch, catalog failure/retry, 20/21 selection, changed draft, and rapid-click request count.
- [ ] Verify grouped text search plus image/live regression against appropriate fixtures. Keep real manual backfill as a separate per-video confirmation gate from `todo/34`/`todo/39`; no bulk or automatic write.
- [ ] Re-review the repaired diff and push the branch only when the P2 items are closed. Keep unrelated untracked duplicate documents out of the commit.
