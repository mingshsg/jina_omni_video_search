# Asset index group (ingest select + search filter) — 2026-09-24

Tracker for organizational `meta.group_id`: choose / type a group when
indexing, hard-filter by group at search. Not multi-tenant auth.

Code committed **b6388f6** (ingest side, 2026-09-29) and **8d291c2**
(search facet + editor wiring, 2026-09-29).

## Status

| Item | Status |
| --- | --- |
| Free-form `group_id` (≤ 64 chars) + suggestions `trailer` / `demo` | Done |
| Mapping `meta.group_id` + review | Done |
| Ingest UI — creatable ComboBox (committed `b6388f6`) | Done |
| Search facet (`SearchFacets`) + editor (`EditMetadataFlyout`) creatable UI + `group_id` API filter wiring | **Code committed `8d291c2`** (build + tests green on that tree) |
| Backfill script: 10 s/`fine` → `trailer`, 2 s/`2s` → `demo` | Done |
| Docs (`api-contract`) | Done |
| `yarn setup-indices` on target cluster | Done (verified 2026-09-29, no conflicts, `meta.group_id` keyword present) |
| Existing-video backfill | Per-video Library group selector requested 2026-09-29; bulk backfill will not run automatically. Real writes not run. |
| Browser smoke: import with custom name → search facet filters it | **NOT RUN** (manual, needs running container) |

## Notes

- Ingest seeds `group_id` only on first asset create.
- Catalogs endpoint returns suggested starters **plus** distinct values
  already stored in ES.
- Backfill prefers `demo` when an asset has both 10 s and 2 s variants.
- User decision 2026-09-29: expose the inferred group on each eligible Library
  video with an explicit confirmation action; leave the bulk backfill script
  operator-only and do not execute it automatically. Existing groups are never
  overwritten by the Library action.
- User correction 2026-09-29: the Library backfill dialog must offer the group
  catalog and a custom group entry. The inferred group is a preselected
  suggestion, not a forced assignment. Show the action on any ungrouped video,
  including one with no inference. Preserve per-video manual confirmation and
  the existing-group guard. The API accepts a selected `group_id` and retains
  `expected_group_id` for legacy callers.
- Browser smoke 2026-09-29 against the rebuilt Drama app (`db97b58`): opened
  the Library action for an ungrouped video; `demo` was preselected, clearing
  it showed `trailer`/`demo`, and entering `drama` created a selected custom
  option that enabled confirmation. Confirmation was **not** submitted; no
  existing video was modified. The guarded live-write acceptance below remains
  **NOT RUN**.
- `yarn setup-indices` verified 2026-09-29: reports `"conflicts": []` and
  "All indices already exist — mapping already current."; read back
  `GET video-assets/_mapping` → `meta.group_id` is `{"type":"keyword"}` and
  `meta.review.group_id` exists.
- `yarn backfill-group-id --dry-run` verified 2026-09-29: `ok: true`,
  scanned 35, would update 35 (`trailer` 20 / `demo` 15); no writes made.
- Search/editor wiring landed in **8d291c2** (`lib/metadata/search-filters.ts`,
  `lib/metadata/facets-ui.ts`, `app/api/metadata/catalogs/route.ts`,
  `components/SearchFacets.tsx`, `components/EditMetadataFlyout.tsx` + the two
  unit tests). The suggest-only edits to `EditMetadataFlyout.tsx` (todo/33 R3)
  were deliberately left uncommitted; the group hunks carry no reference to
  the suggest-only `isUncited` / `nextPending` code, and the reverse holds, so
  the split is self-contained. Verified by building and testing the staged-only
  tree (`git stash --keep-index`): 85 files / 595 tests, `yarn build` green.

## Checklist

- [x] Free-form validation + search filter
- [x] Ingest creatable UI (committed `b6388f6`)
- [x] SearchFacets / EditMetadataFlyout creatable UI + `group_id` filter wiring
      (committed `8d291c2`; staged-only tree builds and tests green)
- [x] `scripts/backfill-group-id.ts` (+ `yarn backfill-group-id`)
- [x] `yarn setup-indices` verified on target cluster (2026-09-29, no conflicts,
      `meta.group_id` keyword in mapping) — `yarn backfill-group-id --dry-run`
      also verified; the real bulk backfill is **not** run.
- [x] Add a per-video Library confirmation action and a guarded API that
      writes the selected group when `meta.group_id` is absent.
      No automatic or bulk write is wired into the app. The combined staging
      tree passed 87 files / 610 tests and build on 2026-09-29; this is not a
      live Elasticsearch script or browser acceptance result. The subsequent
      selector change requires its own fresh test/build and browser gates.
- [x] Focused `codex/group-filter-complete` branch, based on the pushed
      `codex/url-safety-suggest` prerequisite: Node 22.13.1
      `yarn test --maxWorkers=4` passed 66 files / 473 tests and `yarn build`
      passed on 2026-09-29. The mapping fixture was updated to include
      `meta.group_id`; no real asset was changed by these gates.
- [ ] Verify the per-video action against a rebuilt app and target index:
      accept one eligible ungrouped video, reject an existing group, and
      verify no other video changed. **NOT RUN**.
- [ ] Smoke: import with custom name → search facet filters it (**NOT RUN** —
      browser facet smoke still owed; needs the running container)
