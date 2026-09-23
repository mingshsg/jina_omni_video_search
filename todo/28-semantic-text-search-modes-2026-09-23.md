status: Description mode implemented and passing gates below; All mode and
Phase 3.5 removal deferred — see `plan/11-semantic-text-search-modes.md` for
the reasoning and the decision needed from the user.

# Semantic-text search modes (item 4) — 2026-09-23

## What changed

- `lib/es/asset-meta-mapping.ts` — `videoAssetsMetaMappingProperties(inferenceId?)`
  adds three `semantic_text` fields (`meta.description_semantic`,
  `meta.abstract_semantic`, `meta.work_title_semantic`) bound to the given
  inference id; omitted when no id is passed (back-compat with existing
  tests/behavior).
- `lib/es/indices.ts` — three call sites now pass `cfg.EMBED_INFERENCE_ID`.
- `lib/es/asset-meta.ts` — new `deriveSemanticMirrorFields()` (exported);
  `patchAssetMeta` mirrors description/abstract/work_title.en into the
  semantic siblings on write, with the same strict_dynamic_mapping soft-fail
  retry already used for the Phase 3.5 channel. `CLEARABLE_META_KEYS` gained
  the three mirror keys.
- `lib/es/description-search.ts` (new) — `searchDescriptionAssets()`,
  asset-level `semantic` query over the three mirror fields, scoped by the
  existing `enumerateEligibleAssetIds()` filter/facet/variant eligibility.
- `app/api/search/route.ts` — `modality` enum gained `'description'`;
  new `handleDescriptionSearch()` branches before the existing
  hybrid/parse/sort_by logic and never calls `searchChunks`.
- `app/page.tsx` — 4th "Description" button; `Modality`/local
  `ModalityBadge` widened additively; description-mode API responses mapped
  to synthetic full-span `SearchHit`s client-side so the existing
  card/grouping/timeline UI renders them without a new card component;
  hybrid-text/parse-query/sort-by controls disabled while active.
- `lib/i18n/ui.ts` — `modalityDescription` key, EN + ZH.
- Tests: `lib/es/asset-meta.test.ts` gained 3 mapping tests (omits fields
  with no inference id; declares all three with one; existing lexical fields
  untouched) and 4 `deriveSemanticMirrorFields` tests (full mirror, null
  clears, untouched fields produce no mirror, defensive missing-`en` case).

## Gates run

- `yarn test` — 423/423 passed.
- `yarn build` — succeeded, typecheck clean, all 20 routes generated.

## Gates NOT RUN

- **No live Elasticsearch cluster verification of any kind.** This is the
  biggest gap in this pass:
  - `yarn setup-indices` was not run against a live cluster — the
    `semantic_text` mapping property has only been verified via unit tests
    asserting the JSON shape the mapping-builder function produces, never
    against an actual `PUT .../_mapping` call. It is unverified whether
    Elasticsearch accepts this `semantic_text` mapping shape as written, and
    whether `cfg.EMBED_INFERENCE_ID`'s referenced endpoint is actually usable
    as a `semantic_text` backing inference endpoint (its task_type is
    `embedding`, which the docs say is supported — but "supported per docs"
    and "verified working against this project's actual endpoint" are
    different claims, and only the former is true right now).
  - The `semantic` query type's exact behavior/scoring for this field type
    has not been exercised at all — no live PATCH → live search round trip.
  - The write-path mirror (`deriveSemanticMirrorFields` + the
    strict_dynamic_mapping retry) has unit coverage for the pure derivation
    logic only; the actual ES `update` call with a real `semantic_text`
    field has never run.
- **No manual/browser QA of the new Description button** — layout, the
  disabled-control states, or whether the synthetic full-span hit renders
  sensibly in the existing card/timeline UI (my reasoning that it "just
  works" is based on reading the rendering code, not seeing it rendered).
- **No test for the new `/api/search` `description` branch itself**
  (`handleDescriptionSearch`) — it isn't covered by an integration test; only
  its dependencies (`searchDescriptionAssets`'s helper logic is not directly
  unit-tested either, since it requires a live/mocked ES client and no
  existing test harness for that pattern was found in this codebase's
  `lib/es/*.test.ts` files, which test pure builder functions like
  `buildBm25Should` rather than functions that call `getEsClient()`).

## Explicitly deferred (see plan doc for full reasoning)

1. **"All" mode** — not built. Needs a user decision: rename "Both"
   in-place vs. add a genuinely new 4th mode with an explicit (and honestly
   documented) chunk+asset fusion or side-by-side section design.
2. **Phase 3.5 (`description_embedding` dense_vector) removal** — not done.
   Coexists harmlessly with the new mechanism (was always
   `ASSET_SEMANTIC_ENABLED`-gated off in production). Scoped as its own
   follow-up per this repo's "one concern per PR" convention.

## Follow-ups

- Once a live cluster is available: run `yarn setup-indices`, confirm
  `assetsMapping.addedProperties` includes the three `*_semantic` paths,
  PATCH a real asset's description, and confirm a `Description`-mode search
  actually returns it — this is the single most important unverified claim
  in this whole pass.
- Decide and implement "All" mode (see plan doc's two options).
- Schedule the Phase 3.5 deletion pass once the new mechanism has live
  confidence behind it.
