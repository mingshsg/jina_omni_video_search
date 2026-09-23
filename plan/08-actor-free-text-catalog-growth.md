status: implemented in this pass; see `todo/25-actor-free-text-catalog-growth-2026-09-23.md`
for the verification checklist and what remains unverified (browser QA of the
combobox interaction, concurrent-writer safety).

# Actor free-text catalog growth

## Goal

Requested directly by the user (not a review finding), in two parts across
the same session:

1. In the Suggest actor-candidate list, a candidate that doesn't match the
   controlled person catalog showed "Not in the controlled person catalog"
   with no action — the user wanted a button to add it.
2. In the main **Actors** field (`EuiComboBox` fed only from
   `config/people.json`), the user wanted free text: type a name, leave the
   box, it becomes a value; once committed it is added to the catalog so it
   appears in future autocomplete.

Both share one constraint that does not change: **actors are catalog-IDs
only, no free text server-side** (`lib/metadata/validate.ts`'s
`parseMetaPatchBody` calls `getPerson(id)` and throws `META_UNKNOWN_ACTOR_ID`
for anything not in `config/people.json`). So "free text" here means: typing
an unmatched name triggers *catalog growth* (a new `person:<slug>` entry),
not a bypass of that invariant. The value that ultimately gets PATCHed to
`/api/library/[videoId]/meta` is always a real catalog id.

## What's in Elasticsearch vs. what's a file

The user's phrasing ("committed into Elastic", "query Elastic to get a
list") could be read as "move the person catalog into an Elasticsearch
index." That is **not** what this implements. `config/people.json` stays the
source of truth — it's a small, versioned, git-reviewable file (see
AGENTS.md trap #7: durable/curated resources belong in `config/`, not a
runtime-mutable store), and the existing alias-uniqueness validation
(`validatePeopleCatalog`) depends on being able to load and check the whole
file synchronously. Elasticsearch already has the fan-out of this catalog —
`meta.actor_ids`/`meta.actors`/`meta.actor_aliases` on every asset — so nothing
about search or filtering changes; only the ability to grow the file from the
running app is new.

## Design

### Backend (already existed before this session's final turn)

- `lib/metadata/people.ts`:
  - `validatePeopleCatalog(catalog)` — the loader's inline checks, extracted
    so the write path can reuse them (unique aliases across all people,
    case/NFKC-insensitive; ids must start with `person:`).
  - `slugifyPersonId(en)` — NFKD-strip-diacritics → lowercase → kebab-case.
    Falls back to the literal string `"person"` when the input has no ASCII
    letters (e.g. a CJK-only name), which the numeric-suffix loop then turns
    into `person:person`, `person:person-2`, etc. This is a known, accepted
    corner case (see `todo/25`), not a made-up ID scheme.
  - `writePeopleCatalogAtomic(catalog)` — temp file + `fs.renameSync` (atomic
    on the same filesystem; this app is single-instance, see AGENTS.md).
  - `addPersonToCatalog(input)` — validates lengths, builds an alias set
    (`en` + optional `zh` + optional `native.name`), generates
    `person:<slug>` with `-2`, `-3`, … suffixes on id collision, re-validates
    the *whole* merged catalog (catching alias collisions even when the id
    itself didn't collide — two different names can't share an alias),
    writes atomically, resets the in-process cache, and reloads it so the
    new id is immediately selectable.
- `app/api/metadata/catalogs/people/route.ts` — `POST { en, zh?, native? }`
  → `addPersonToCatalog` → `{ id, display }` (201), or the `PersonCatalogError`
  code mapped to 400 (`invalid`) / 409 (`conflict`), matching the existing
  `app/api/metadata/catalogs/route.ts` style.

### Frontend (this session's final turn)

Both surfaces now go through the same new `createPerson` helper in
`components/EditMetadataFlyout.tsx`, which POSTs, folds the returned option
into `actorOptions` (so it appears in the dropdown without a refetch), and
surfaces failures via the existing `setError` banner.

1. **Suggest actor-candidate list** — the `!candidate.matched_person_id`
   branch now renders an "Add to catalog" button (`metaActorCandidateAddToCatalog`)
   next to the existing "Not in the controlled person catalog" text. On
   click, `addUnresolvedCandidate` calls `createPerson` with the candidate's
   full `names` (en/zh/native), then on success both selects the person
   (`selectedActors`) and patches the *same* candidate list entry's
   `matched_person_id`, which flips the row to the pre-existing matched-path
   button ("Add matched person" / "Added") for free — no new UI state needed
   for that transition.
2. **Main Actors combobox** — added `onCreateOption` to the existing
   `EuiComboBox`. EUI's combobox already calls `onCreateOption` both on
   Enter *and* on blur-away with unmatched leftover text (`onContainerBlur`
   → `setCustomOptions(true)` → `addCustomOption` → `onCreateOption`, verified
   by reading `node_modules/@elastic/eui/lib/components/combo_box/combo_box.js`
   rather than assumed) — so "type a name, leave the box, it becomes a
   value" was mostly free once the callback existed; no need to add a
   separate `onBlur` handler. `createActorFromFreeText` calls `createPerson({
   en: trimmed })` and, once the POST resolves, adds the new id to
   `selectedActors`. The callback returns non-`false` immediately (not
   `false`), so EUI clears the typed text right away rather than leaving it
   stuck in the input until the network round-trip finishes; the pill then
   appears a moment later once the server confirms the id.
   `metaActorsHelp` copy updated (EN+ZH) to say free text is accepted, since
   it previously said the opposite ("IDs only — no free-text names").

Only one field (`en`) is asked of free text — no split UI for "is this a
Chinese name" at commit time. Whatever the user typed becomes
`display.en` verbatim (even if it's actually a CJK string); this is safe
because `displayNameForPerson(id, 'zh')` falls back to `display.en` when
`display.zh` is absent, so a Chinese name typed into the single free-text box
still displays correctly for zh-locale users. This keeps the "type it, it
just works" promise without asking the user two questions for the common
case; anyone who wants an explicit English/Chinese/native split still has
that available through the "Add to catalog" path off a Suggest candidate,
which already carries all three name fields.

## Explicitly out of scope for this pass

- Editing or removing an existing catalog entry from the UI.
- Any UI to fix a bad free-text commit after the fact (e.g. wrong slug) short
  of directly editing `config/people.json`.
- Concurrent-writer safety beyond what already existed (single-instance
  deployment assumption, unchanged).
