Plan: [`plan/08-actor-free-text-catalog-growth.md`](../plan/08-actor-free-text-catalog-growth.md).
Requested directly by the user (not a review finding).

## Backend (`lib/metadata/people.ts`, `app/api/metadata/catalogs/people/route.ts`)

- [x] `validatePeopleCatalog` extracted from the loader, reused by the write
      path.
- [x] `PersonCatalogError` (`code: 'invalid' | 'conflict'`).
- [x] `slugifyPersonId` — NFKD-strip-diacritics → lowercase → kebab-case.
- [x] `writePeopleCatalogAtomic` — temp file + `fs.renameSync`.
- [x] `addPersonToCatalog` — length checks, alias set, id-collision
      suffixing, whole-catalog re-validation (catches alias collisions
      independent of id collisions), atomic write, cache reset + warm reload.
- [x] `POST /api/metadata/catalogs/people` — zod body validation, maps
      `PersonCatalogError` to 400/409.

## Frontend (`components/EditMetadataFlyout.tsx`)

- [x] `createPerson` helper — POSTs, folds the new option into
      `actorOptions`, surfaces failure via the existing error banner.
- [x] `addUnresolvedCandidate` — wired to a new "Add to catalog" button
      (`metaActorCandidateAddToCatalog`) rendered when
      `!candidate.matched_person_id`; on success selects the person and
      patches that candidate's `matched_person_id` in place so the row
      switches to the existing matched-path button.
- [x] `createActorFromFreeText` — wired to `onCreateOption` on the main
      Actors `EuiComboBox`. Verified against the installed EUI source
      (`node_modules/@elastic/eui/lib/components/combo_box/combo_box.js`,
      v119.1.0) that `onCreateOption` fires on **both** Enter and blur-away
      with unmatched leftover text (`onContainerBlur` → `setCustomOptions`),
      so no separate `onBlur` handler was needed to satisfy "leaves the box
      → becomes a value."
- [x] `metaActorsHelp` copy corrected (EN+ZH) — no longer claims free text is
      rejected.
- [x] New i18n keys: `metaActorCandidateAddToCatalog`, `metaActorCatalogAddError`
      (EN+ZH).

## Tests (`lib/metadata/people.test.ts`)

- [x] **Isolation solved**: every `addPersonToCatalog` test redirects
      `process.cwd()` (`vi.spyOn`) to a `fs.mkdtempSync` temp directory seeded
      with its own throwaway `config/people.json`, restored in `afterEach`.
      Verified with `git --no-pager diff --stat config/people.json` showing
      no diff after the full run — the real catalog file was never touched.
- [x] 10 new tests added: happy path + persists to disk + reload picks it up;
      zh/native alias folding; id-slug-collision numeric suffixing (using two
      different names that slugify to the same base, since two *identical*
      names correctly hit the alias-conflict rejection instead — this was a
      bug in the test's first draft, not the product, caught by actually
      running it); alias-conflict rejection; empty/over-long name rejection;
      `slugifyPersonId` diacritic-stripping + CJK-only fallback;
      `validatePeopleCatalog` duplicate-alias / missing-prefix / non-object
      rejection.
- [x] `yarn vitest run lib/metadata/people.test.ts` — 27/27 passed (17
      pre-existing + 10 new).
- [x] `yarn test` (full suite) — 412/412 passed (62 files).
- [x] `yarn build` — passed; `/api/metadata/catalogs/people` present in the
      route table.
- **NOT RUN**: no browser/E2E check of the actual combobox interaction (typing,
  blurring, seeing the pill appear, reopening the flyout and seeing the new
  person in future autocomplete). The EUI blur-triggers-`onCreateOption`
  behavior was verified by reading the installed library's compiled source,
  not by driving a real browser.
- **NOT RUN / not attempted**: concurrent-writer race (two editors adding a
  person with the same name at the same moment) — unchanged from the
  pre-existing single-instance assumption documented in AGENTS.md; not
  something this pass tried to fix or test.
- **NOT RUN**: no route-level (HTTP) test for
  `app/api/metadata/catalogs/people/route.ts` — consistent with this repo's
  existing convention that `vitest.config.ts` only collects `lib/**` and
  `worker/**` (AGENTS.md trap #6); route correctness here rests on
  typecheck/build plus the `addPersonToCatalog` unit tests it thinly wraps.

## Follow-ups not done in this pass

- No UI to edit/rename/remove a catalog entry once created — a bad free-text
  commit (typo, wrong slug) currently requires a manual edit of
  `config/people.json`.
- `slugifyPersonId` falling back to the literal `"person"` for CJK-only input
  (giving ids like `person:person`, `person:person-2`, …) is functionally
  fine (ids are opaque, aliases carry the real names) but reads oddly in
  `config/people.json` if that path gets used often — flagged, not fixed.
