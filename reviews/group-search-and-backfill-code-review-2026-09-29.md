# Group search and manual backfill code review — 2026-09-29

Scope: `codex/drama-enrichment-complete` at `6a92a01`; inspect the primary Group search control, its catalog/filter contract, and the per-video Library backfill path. This is a focused review of the recent Group changes, not a new whole-repository or drama-enrichment acceptance verdict. No application code was changed for this review.

**Verdict: the Group filter and guarded manual backfill are structurally wired, but grouped-search acceptance is not ready.** Variant/Group combinations can silently exclude matching videos, selecting more than 20 groups produces a 400, and catalog failures hide available groups. Node 22 tests and build pass; real grouped-search and guarded backfill writes remain unverified.

## P2 — should fix before Group search acceptance

### G1 — Default Variant can silently exclude the selected Group

`app/page.tsx:260-264` chooses the first library variant with `setVariantId((prev) => prev || ids[0])`. The Group selection at `app/page.tsx:845-853` updates only `facets.group_id`; `runSearch` sends both `variant_id: variantId` and the Group filter (`app/page.tsx:429-437`). The server intentionally combines a ready variant clause with `terms: { 'meta.group_id': filters.group_id }` (`lib/metadata/search-filters.ts:237-250,282-284`). A group whose ready assets use a different variant therefore returns zero hits even when the group has matching videos. `LibraryAsset` on the search page lacks `group_id` (`app/page.tsx:95-106`), and the library response contains only the newest 200 assets (`app/api/library/route.ts:12`), so this page cannot reliably explain variant compatibility from its current client data.

Keep the server's explicit variant contract. Add an availability/compatibility path that covers the indexed groups, show compatible variants or a clear no-match reason, and prevent an unexplained empty result. Preserve the user's explicit Variant choice; do not silently change vector identity. Test a group with only a nondefault ready variant and a group spanning multiple variants.

### G2 — The control allows more selected groups than the API accepts

`components/SearchGroupFilter.tsx:49-55` passes every ComboBox selection through `selectedSearchGroupIds`, which returns all distinct values without a limit (`lib/metadata/group-filter-ui.ts:2-6`). The request includes that array (`lib/metadata/facets-ui.ts:70`), but `searchFiltersSchema` caps `group_id` at `META_BOUNDS.facetArrayMax` (`lib/metadata/search-filters.ts:32-57`), currently 20 (`lib/metadata/catalogs.ts:155`). The 21st selection yields `SEARCH_INVALID_REQUEST`/400 (`app/api/search/route.ts:98-105`) instead of a usable search. Enforce the limit in the control and explain it in the UI; test 20, 21, and the All reset.

### G3 — Catalog failure can leave the required Group control looking complete

`SearchGroupFilter` updates options only on `res.ok` and ignores fetch/parse failure (`components/SearchGroupFilter.tsx:24-35`); its default state is `groups=[]` and therefore only All is visible (`:22,38-41`). The shared catalogs route returns 500 if `loadPeopleCatalog()` fails *before* reading groups (`app/api/metadata/catalogs/route.ts:18-34`). Separately, `listGroupCatalogEntries` swallows an Elasticsearch aggregation failure and returns only starter suggestions (`lib/metadata/groups.ts:30-31,41-68`). A stored group can thus disappear from this non-creatable search selector with no loading/error indication. Decouple group availability from unrelated people-catalog failure, distinguish a partial/unavailable catalog from a complete one, and give the user a retry path. Test both failure branches; All must remain usable.

## P3 — hygiene / scale

### G4 — Group clicks can submit a query before Search is pressed

The Group change handler calls `runSearch` whenever the input has text and a variant exists (`app/page.tsx:847-852`). The page separately presents a Search button (`app/page.tsx:713-731`) and tracks the last submitted query (`app/page.tsx:237-244,375-384`), but the handler does not check that a query was submitted. Selecting several groups while composing a query can start several embedding/search requests; the request sequence prevents stale rendering (`app/page.tsx:393,455`) but cannot undo upstream work. Rerun only a previously submitted query, or require an explicit Search action for filter changes. Test the pre-submit and post-submit behavior.

### G5 — Group catalog enumerates only the top 200 stored values

`lib/metadata/groups.ts:48-51` uses a terms aggregation with `size: 200`; `SearchGroupFilter` offers only returned options and cannot create a search option (`components/SearchGroupFilter.tsx:38-55`). Once the index has more than 200 distinct groups, some existing nonstarter groups will be inaccessible from search. This is a scale limit, not evidence that the current demo exceeds it. Before that scale, provide paginated/searchable lookup or a visible incomplete-catalog state and test a catalog beyond 200 groups.

## Checked and not raised as new defects

- All means an empty group selection (`lib/metadata/group-filter-ui.ts:1-6`), and the API omits `group_id` for that state (`lib/metadata/facets-ui.ts:70`). Nonempty Group selection reaches the server's asset eligibility filter (`app/api/search/route.ts:30,116-131,328-335`; `lib/metadata/search-filters.ts:282-284`). This review found no missing filter-wire step.
- The Library action remains explicit per video. `backfillAssetGroup` rejects an already-set group and uses a scripted concurrent-write guard (`lib/es/group-backfill.ts:20-23,35-67`); it updates asset metadata rather than chunk vectors. The tests mock the ES update and inspect the script; they do not prove that a live cluster accepts and executes it.
- The backfill selector is single-select despite holding an array (`components/CreatableGroupCombo.tsx:38-44`), so reading `selected[0]` in `components/GroupBackfillModal.tsx:76-78` is intentional.
- Existing auth, drama, relevance, latency and multi-replica work stays in the earlier trackers (`todo/30`, `todo/35`–`todo/38`). It is not silently declared closed by this focused review.

## Gates

| Gate | Result | Evidence / limit |
| --- | --- | --- |
| `PATH=/usr/local/bin:$PATH yarn test --maxWorkers=4` | PASS | Node 22.13.1; 88 files / 616 tests on 2026-09-29 |
| `PATH=/usr/local/bin:$PATH yarn build` | PASS | Node 22.13.1; Next compile, typecheck, routes on 2026-09-29 |
| Default Variant + selected Group with real grouped assets | NOT RUN | Current prior browser smoke covered control selection/reset, not grouped results (`todo/34`) |
| 21-group selection, catalog error, >200-group browser/API cases | NOT RUN | Findings are source-contract analysis; no live fixture for these cases |
| Manual single-video backfill against the target index, existing-group conflict, other-video isolation | NOT RUN | User will choose a video and submit explicitly; this review made no index writes |
| Representative relevance, p95/cost, drama episode quality | NOT RUN | Separate acceptance gates in existing trackers |

Follow-up: [`todo/39-group-search-and-backfill-2026-09-29.md`](../todo/39-group-search-and-backfill-2026-09-29.md).
