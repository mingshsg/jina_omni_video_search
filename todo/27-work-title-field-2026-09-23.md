status: implemented; see `plan/10-work-title-field.md` for design.

# Work title field — 2026-09-23

Item 3 of the session (items 1-2 shipped earlier; item 4 tracked separately).

## What changed

- `lib/metadata/catalogs.ts` — `META_BOUNDS.workTitleNameMax` (200),
  `workTitleNativeLangMax` (16).
- `lib/metadata/validate.ts` — `WorkTitle` type; `work_title` threaded through
  `MetaReviewMap`, `AssetMeta`, `AssetMetaEditorDto`, `metaPatchBodySchema`
  (incl. `field_sources`/`field_provenance`), `EDITABLE_KEYS`,
  `parseMetaPatchBody`, `toEditorDto`.
- `lib/es/asset-meta.ts` — `work_title` added to `CLEARABLE_META_KEYS` and
  `REVIEW_FIELD_KEYS`. No Painless script edit needed.
- `lib/es/asset-meta-mapping.ts` — `meta.work_title` object mapping
  (`en`/`zh` text, `native.lang` keyword, `native.name` text) +
  `review.work_title`.
- `lib/es/hybrid-search.ts` — `buildBm25Should()` gained three boost-2 `match`
  clauses for `meta.work_title.en` / `.zh` / `.native.name`.
- `components/EditMetadataFlyout.tsx` — new "Work title" form row (4 inputs),
  state, `applyDto`/`save()` wiring, Suggest auto-fill from
  `data.web.candidates[0].title` (new `candidates` field added to the
  component's local `SuggestResult.web` type to match what the API already
  returns), `applyPendingSuggestion` branch.
- `lib/i18n/ui.ts` — 6 new keys, EN + ZH.
- Tests: `lib/es/mapping-diff.test.ts`'s "implicit object" fixture updated to
  include `work_title` (it asserts a full-match snapshot of the whole `meta`
  mapping, so it needed the new field added to stay in sync); 6 new
  `parseMetaPatchBody` tests added to `lib/metadata/people.test.ts` (full
  object with review, en-only, null-clears, missing-`en`-rejected,
  overlong-name-rejected).

## Gates run

- `yarn test` — 417/417 passed (was 412 before this change; +5 net after
  fixing the mapping-diff fixture and adding 6 new tests, review found no
  regressions in unrelated suites).
- `yarn build` — succeeded, typecheck clean, all 20 routes generated.

## Gates NOT RUN

- **No live Elasticsearch cluster mapping upgrade.** `yarn setup-indices` was
  not run against a live cluster in this session — the new `meta.work_title`
  mapping property has only been verified via the in-memory
  `diffMappingProperties` unit test, not an actual `PUT .../_mapping` call.
  Before this ships to an environment with existing indices, run
  `yarn setup-indices` and confirm `assetsMapping.addedProperties` includes
  `meta.properties.work_title`.
- **No browser QA.** The new form row (4 `EuiFieldText` inputs in a wrapping
  `EuiFlexGroup`) has not been visually checked — layout at narrow flyout
  widths, tab order, and whether `native-lang` placeholder text ("ko / ja /
  th") is a clear-enough affordance were not verified interactively.
- **No relevance/regression check on BM25 ranking** now that `work_title.*`
  participates in `buildBm25Should()`. The three new clauses reuse the same
  boost (2) as `title`, so in principle a query matching only a work title
  should rank comparably to one matching only the filename-derived `title` —
  but no search relevance fixture was run to confirm actual result ordering
  with a populated `work_title` on real documents.
- **No Suggest end-to-end smoke test.** The `data.web.candidates[0].title` →
  `workTitleEn` auto-fill path was reviewed by reading code, not exercised
  against a live Suggest run (unlike item 2's live smoke test in
  `todo/26-suggest-description-depth-2026-09-23.md`).

## Follow-ups

- Consider whether `work_title` should also participate in `search_text`
  denormalization for the CJK analyzer path (`meta.search_text.cjk`) the way
  `actor_aliases` does via `copy_to` — deferred because `title`/`description`/
  `abstract` don't do this either, so `work_title` staying consistent with its
  closest siblings seemed like the safer default; revisit if native-script
  work titles turn out to need CJK-bigram matching that plain `text`/`keyword`
  on `native.name` doesn't give them.
- No facet/filter UI for work_title yet (see plan doc's "out of scope").
