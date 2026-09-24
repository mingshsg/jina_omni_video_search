# todo/32 — Suggest metadata-editor session review (2026-09-23)

Source review:
[`reviews/suggest-metadata-editor-session-review-2026-09-23.md`](../reviews/suggest-metadata-editor-session-review-2026-09-23.md).

Scope: the uncommitted working tree covering `reference_urls`, the todo/30 S6
citation relaxation, the "Known as" alias editor + new `PATCH` route, the
image-search `filters` fix, two UI fixes, and the Agent Builder prompt
rebalance.

One defect found in that review was fixed during it and needs no entry here:
the IMDb worked example omitted `candidates` while the UI depends on it —
corrected, redeployed, snapshot regenerated.

## P1

- [x] **R1** — actor candidates are still silently dropped when the URL is
      not name-allowlisted (`lib/metadata/suggest-web.ts:107-117`,
      `return []`). Same defect class as todo/30 S6, which this session
      fixed for all seven scalar fields but not for actors. Keeping the
      gate is defensible; dropping **silently** is not. Minimum fix:
      report the dropped-candidate count via the existing `web.reason` /
      `web.notes` channel so the operator knows research was discarded.
      Relaxing the gate itself is a separate product decision — do not
      bundle it.
      **Fixed 2026-09-23.** `normalizeAgentActorCandidates` now returns
      `{ candidates, dropped_uncited }` (`lib/metadata/suggest-web.ts`)
      rather than a bare array, the count rides through
      `SuggestWebMeta.actor_candidates_dropped`, and the editor renders an
      explicit warning callout naming the count and why the names were
      withheld. The allowlist gate is unchanged, by design. A candidate
      missing `names.en` is malformed agent output, not a policy drop, and
      is deliberately not counted. Two regression tests added.

## P2

- [x] **R2** — "Known as" add/remove writes immediately
      (`components/EditMetadataFlyout.tsx:1688,1695`), bypassing the
      flyout's draft-then-Save model and the `expected_revision` guard,
      and mutates a **global** alias list that feeds `findContainedAliases`
      in the search hot path for every query. Decide: defer to Save, or
      keep immediate but label it as a catalog-wide edit and provide undo.
      **Fixed 2026-09-23 (labelled + confirmed, still immediate).** Help text
      in both locales now states the edit writes to the shared catalog
      immediately — not on Save — and affects every video. Removal, the
      destructive and irreversible direction, now goes through an
      `EuiConfirmModal` following the existing `app/library/page.tsx`
      pattern; adding stays frictionless. Deferring the write to Save was
      considered and rejected: the catalog is global, so it has no coherent
      per-asset draft state and cannot participate in `expected_revision`.
- [x] **R3** — the new `PATCH /api/metadata/catalogs/people/{id}` has no
      auth, rate limit, or removal path, doubling the exposure already
      tracked as S7 in
      `reviews/hybrid-suggest-pipeline-review-2026-09-23.md:100-107`.
      Update S7 to name both routes so a future fix cannot miss one.
      **Fixed 2026-09-23.** `todo/30` S7 rewritten to enumerate both routes,
      flag the PATCH route as additionally *destructive*, and list the
      partial mitigations already in place (single-source bounds, 409 on
      collision, UI confirm) while stating none substitutes for auth.
- [x] **R4** — document `reference_urls` and the known-as route in
      `docs/api-contract.md` + `docs/data-model.md`. Currently zero
      mentions anywhere under `docs/`.
      **Fixed 2026-09-23.** `docs/api-contract.md` documents `reference_urls`
      on the PATCH meta body (incl. why its validation is looser than
      `source_url`) plus full sections for `POST /api/metadata/catalogs/people`
      and `PATCH /api/metadata/catalogs/people/{personId}` with error tables
      and the global-effect/unauthenticated cautions.
      `docs/data-model.md` adds the mapping entry, the `index: false`
      rationale, and a deployment note that an un-migrated strict index
      silently discards the field.
- [ ] **R5** — split the tree before committing. Suggested order, smallest
      and most independent first:
      1. image-search `filters` nullable fix (+ its 3 regression tests) —
         pre-existing bug, unrelated to everything else, land alone
      2. UI-only fixes: `EuiDescriptionList` column width, Suggest elapsed
         timer, search-input label
      3. `reference_urls` end-to-end
      4. todo/30 S6 citation relaxation
      5. "Known as" feature + new route
      6. Agent Builder prompt rebalance (already deployed live — commit so
         the repo matches the server)
      Note the tree also holds **pre-existing third-party work** (semantic
      mirror fields + strict-dynamic retry in `lib/es/asset-meta.ts`,
      `SUGGEST_WEB_TIMEOUT_MS` 60s→180s): confirm ownership before
      committing any of it.
- [ ] **R5a** — the tree was modified by another actor *during* the review
      (`lib/es/asset-meta.test.ts`, `lib/config.ts`, `.env.example`
      appeared mid-session; suite moved 445→446). Re-run `git status` and
      `yarn test` immediately before committing; do not trust this
      review's file list as final.

## P3

- [x] **R6** — `KNOWN_AS_MAX = 30` (`lib/metadata/people.ts:321`) vs
      `.max(50)` in the route zod
      (`app/api/metadata/catalogs/people/[personId]/route.ts:15`). Import
      the constant or drop the duplicated bounds.
      **Fixed 2026-09-23.** `KNOWN_AS_MAX` and `KNOWN_AS_NAME_MAX_LEN` are
      exported and imported by the route schema, so the advertised and
      enforced limits cannot drift. Verified live: 31 entries now returns
      `aliases: Array must contain at most 30 element(s)`, and a
      whitespace-only entry is rejected at the schema.
- [x] **R7** — rename `cited()` → `readField()`
      (`lib/metadata/suggest-web.ts:327`); it no longer gates on citation.
      **Fixed 2026-09-23** — renamed, all 7 call sites updated.
- [x] **R8** — `AGENTS.md:157-161` claims todo/22 has three open P1s; F1–F3
      are all `[x]` and fixed at `lib/es/hybrid-search.ts:426-433`. Correct
      the "Current state" paragraph.
      **Fixed 2026-09-23** — corrected to say F1–F3 are fixed (citing
      `lib/es/hybrid-search.ts:426-433`), that ten non-P1 items remain, and
      added a line for `todo/32`.
- [x] **R9** — add the "not safe against concurrent writers" caveat to
      `setPersonAliases`, matching `addPersonToCatalog`
      (`lib/metadata/people.ts:363`).
      **Fixed 2026-09-23** — caveat added, naming the lost-update case
      explicitly (atomic rename protects against a torn file, not a lost
      update).

## Owed verification (from the review's gates table)

- [ ] No component-level test runs at all (`vitest.config.ts` covers only
      `lib/**`, `worker/**`) — the Known-as chips, the Suggest timer, and
      the `reference_urls` editor wiring are untested by construction.
- [ ] Unproven that relaxing citations improves output quality; needs a
      labeled set, not a unit test.
- [ ] IMDb unblocking measured on **one** title (Parasite) via keyless Jina
      Reader; no before/after over a corpus.
- [ ] The `reference_urls` silent-drop retry path
      (`lib/es/asset-meta.ts:372-381`) was never exercised — the live index
      was already migrated. A fresh/un-migrated deployment would silently
      discard the field on save.
