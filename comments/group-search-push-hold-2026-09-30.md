# Why the Group code was not pushed — 2026-09-30

The five Group implementation commits (`3b787fb` through `9c48842`) are committed locally on `codex/drama-enrichment-complete`. The branch is held because the following P2 behavior is still incorrect:

1. **A compatible Variant can be unreachable.** The new Group endpoint sees assets beyond the newest 200, but the Variant selector still gets its choices from `/api/library`'s `listAssets(200)`. A group on an older video can have a ready variant that the user cannot select (`app/api/library/route.ts:12-20`; `components/SearchGroupFilter.tsx:276-295`).
2. **Unknown availability can be reported as no ready video.** When a selected group is missing from a failed or incomplete response, the UI adds a placeholder with `ready_variant_ids: []`, then treats that empty list as confirmed incompatibility (`lib/metadata/group-availability-ui.ts:45-59,97-111`; `components/SearchGroupFilter.tsx:123-169`).
3. **Group changes can submit an unsubmitted draft and multiply provider calls.** After one search, changing the query text and then a Group silently runs the new text. Three rapid Group selections make three requests; the test currently asserts this behavior (`app/page.tsx:378-386,858-869`; `lib/metadata/search-request-gate.test.ts:29-46`).
4. **A person-catalog failure silently empties actor choices.** `/api/metadata/catalogs` now returns HTTP 200 with `people: []` and `people_status: unavailable`, while existing actor clients check only `res.ok`. The response also copies the raw exception text into `people_error` (`lib/metadata/catalogs-payload.ts:41-61`; `components/SearchFacets.tsx:47-56`; `components/EditMetadataFlyout.tsx:480-499`).

Node 22 tests passed (92 files, 653 tests) and `yarn build` passed on `9c48842`. Those gates do not cover the four paths above. The new Elasticsearch aggregation, rebuilt-container browser behavior, real grouped search, and manual per-video backfill remain **NOT RUN**.

**Push status:** the review/todo documents were pushed separately on `codex/group-search-review` at `08d04a7`. No new application code was pushed. Fix and re-review R1–R4 in [`todo/40`](../todo/40-group-search-followup-2026-09-30.md) before pushing the Group code stack. The detailed evidence is in the [follow-up review](../reviews/group-search-followup-code-review-2026-09-30.md).
