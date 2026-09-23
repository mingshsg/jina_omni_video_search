status: implemented in this pass; see `todo/27-work-title-field-2026-09-23.md`
for the verification checklist and what remains unverified (no live ES
cluster mapping upgrade run, no browser QA of the new form row).

# Work title field

## Goal

Requested directly by the user, as item 3 of a four-item session (items 1-2
already shipped; item 4 — semantic_text search — is documented separately in
`plan/11-semantic-text-search-modes.md`):

> title=filename, so you can give a name for it. then also can semantic it

Confirmed with the user: the existing `title` field on `video-assets` is
filename-derived (set at ingest time from the uploaded/imported file name,
never edited), not the actual production/work title. This pass adds a new,
independently-editable `meta.work_title` field for the real work title, and
wires it into the same lexical (BM25) search path that `title`/`description`/
`abstract` already use. The semantic (embedding) side of "also can semantic
it" is item 4's scope, not this one — `meta.work_title.en` is one of the three
text sources item 4 feeds into `semantic_text`.

## Design

`work_title` mirrors the actor `native` name convention already established
in `lib/metadata/people.ts` (`PersonEntry.native: { lang, name }`) rather than
inventing a new shape:

```ts
interface WorkTitle {
  en: string;                              // required if the field is set at all
  zh?: string;                             // optional
  native?: { lang: string; name: string }; // optional, verbatim original-script title
}
```

`en` is required whenever `work_title` is present at all — there is no
"native-only" state — because English is the fallback used everywhere else in
the app (`displayNameForPerson` for actors falls back to `en` the same way).
Bounds: `workTitleNameMax: 200` (matches `NEW_PERSON_NAME_MAX_LEN` in
`people.ts` — same display-name class of string) and
`workTitleNativeLangMax: 16` (BCP-47-ish tag), both added to `META_BOUNDS` in
`lib/metadata/catalogs.ts`.

### Backend

- `lib/metadata/validate.ts` — `WorkTitle` interface; `work_title` added to
  `MetaReviewMap`, `AssetMeta`, `AssetMetaEditorDto.meta`; `metaPatchBodySchema`
  gets `work_title: z.union([workTitleSchema, z.null()]).optional()` plus
  matching `field_sources.work_title` / `field_provenance.work_title` entries;
  `'work_title'` added to `EDITABLE_KEYS`; `parseMetaPatchBody` handles it with
  the same simple pattern as `year`/`description` (object in → set + review
  entry; `null` in → clear, no review entry) since — unlike `actor_ids` — there
  is no server-side ID resolution to do; `toEditorDto` passes it through.
- `lib/es/asset-meta.ts` — `'work_title'` added to `CLEARABLE_META_KEYS` and
  `REVIEW_FIELD_KEYS`. No Painless script change needed:
  `META_UPDATE_SCRIPT`'s per-key set/clear loop
  (`ctx._source.meta[key] = val` / `ctx._source.meta.remove(key)`) is already
  generic over any value shape, confirmed by reading the script — the same
  loop already handles nested object values today for nothing in particular,
  but arrays (`actor_ids`, `tags`) prove the loop doesn't care about value
  shape.
- `lib/es/asset-meta-mapping.ts` — `meta.work_title` mapping added as a plain
  `object` (not `nested`, since there's exactly one work title per asset — no
  multi-value matching pitfall to avoid): `en`/`zh` as `text`,
  `native.lang` as `keyword`, `native.name` as `text`. `review.work_title`
  added using the existing shared `reviewField` const.
- `lib/es/hybrid-search.ts`'s `buildBm25Should()` — three new explicit `match`
  clauses (`meta.work_title.en`, `meta.work_title.zh`,
  `meta.work_title.native.name`), boost 2, matching how `title` already gets
  boost 2. Deliberately explicit clauses like `title`/`description`/`abstract`
  rather than `copy_to: meta.search_text` (kept consistent with how those
  three fields already work, not with how `actor_aliases` denormalizes).

### Frontend (`components/EditMetadataFlyout.tsx`)

Follows the existing scalar-field pattern (like `description`/`abstract`), not
the object/array pattern used for actors — four independent
`useState<string>('')` locals (`workTitleEn`, `workTitleZh`,
`workTitleNativeLang`, `workTitleNativeName`) rather than one nested-object
state, because every other field in this component is stored that way and the
diffing/PATCH-body-assembly logic in `save()` already expects flat locals.

- New "Work title" `EuiFormRow` rendered above Description, with four
  `EuiFieldText` inputs in an `EuiFlexGroup` (EN / 中文 / native-lang-code /
  native-name).
- `save()` assembles the four locals into a `{ en, zh?, native? }` object (or
  `null` if `en` is empty) and only includes `work_title` in the PATCH body
  when it differs from the loaded baseline (`JSON.stringify` comparison,
  consistent with how this field's "no partial nested diff" requirement
  differs from every other scalar field here).
- **Suggest wiring**: reuses the existing scalar `ScalarSuggestKey` /
  `SuggestField` / `PendingSuggestions` machinery (auto-apply when the field
  was empty at request time, otherwise render a pending-suggestion callout)
  by adding `'work_title'` as a new key. Its `SuggestField.value` is always a
  plain string — the English work title only. Unlike every other scalar
  suggestion here, the source isn't `data.suggestions.*` (the agent's
  structured field drafts don't include a work title — the agent already
  *starts* from a work title given by the caller, it doesn't propose one).
  Instead it's derived from `data.web?.candidates?.[0]?.title` — the
  work-identification candidate list the agent/Jina search already returns
  (`SuggestWebMeta.candidates`, `lib/metadata/suggest-web.ts`), which the UI
  did not previously render anywhere. Confidence is fixed at `0.7` (not
  provided by the candidate structure) and evidence falls back to the
  candidate's snippet or a generic string when no snippet is present.
  `zh`/`native` remain manual-entry-only for this pass — the agent doesn't
  currently research work-level zh/native titles, only actor names get that
  treatment (plan/06).
- i18n: `metaWorkTitle`, `metaWorkTitleHelp`, `metaWorkTitleEn`,
  `metaWorkTitleZh`, `metaWorkTitleNative`, `metaWorkTitleSuggestEvidence`
  (EN + ZH) added to `lib/i18n/ui.ts`.

## Explicitly out of scope for this pass

- Any zh/native work-title research by the Suggest agent itself (only the
  existing work-identification candidate's `en`-ish title is surfaced).
- The semantic/embedding side of "also can semantic it" — see
  `plan/11-semantic-text-search-modes.md` (item 4), which treats
  `meta.work_title.en` as one of the three text sources fed into
  `semantic_text`.
- A dedicated "work title" facet/filter in the search UI (existing facet
  filtering is unaffected; work_title only participates in free-text BM25
  scoring for now).
