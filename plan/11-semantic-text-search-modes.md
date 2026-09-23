status: item 4 fully implemented across two passes — Description mode and
All mode both ship end-to-end. Phase 3.5 (`description_embedding` dense_vector
mechanism) remains deferred as its own follow-up; see "Deferred" below.

# Semantic-text search modes (item 4)

## Goal

Requested directly by the user, alongside item 3 (work title):

> the description and abstract can be a semantic_text field using
> jina_v5_embedding_omni_small also. so you when you search, there is Video,
> Audio, Description, and All
>
> semantic_text can do on description + title + abstract so it can find it
> better. you plan on this

Two parts: (1) make `meta.description`/`meta.abstract`/`meta.work_title.en`
searchable via Elasticsearch's native `semantic_text` field type, reusing the
existing Jina v5 omni embedding inference endpoint; (2) expose that as new
search modes in the UI.

## Key findings this design rests on (already verified, not re-derived here)

- **`semantic_text` can reuse the existing embedding endpoint.** Per
  `reference/elastic-semantic-field.md`, `semantic_text` accepts inference
  endpoints with task type `embedding`/`text_embedding`/`sparse_embedding`.
  `cfg.EMBED_INFERENCE_ID` (jina-embeddings-v5-omni-small, `task_type:
  embedding`) is exactly the first of these — no new inference endpoint is
  created.
- **This assumes `EMBED_PROVIDER=eis`.** `semantic_text` embeds *inside*
  Elasticsearch using the referenced inference endpoint at query/write time —
  it does not use the app's own embedding provider HTTP calls at all. If a
  deployment runs `EMBED_PROVIDER=jina` or `local` (no ES-side inference
  endpoint registered), `cfg.EMBED_INFERENCE_ID` is typically empty and this
  mapping/write-path code deliberately no-ops (see "Defensive design" below)
  rather than referencing a non-existent endpoint. This repo's actual
  deployment uses `EMBED_PROVIDER=eis` (`docs/operations.md`), so in practice
  this isn't a blocker today, but it's a real constraint or the next agent
  will see silently-skipped semantic fields on a jina/local deployment and
  wonder why.
- **Do not retype the existing lexical `meta.description`/`meta.abstract`
  fields.** Unverified whether `match` queries against a `semantic_text`
  field behave identically to plain `text` for BM25 purposes — retyping
  would risk the existing lexical contract (hard invariant #1). Instead this
  adds NEW sibling fields (`meta.description_semantic`,
  `meta.abstract_semantic`, `meta.work_title_semantic`) populated with the
  same text at write time. Purely additive; the lexical fields are completely
  untouched.
- **This is the intended replacement for the old Phase 3.5 `dense_vector`
  mechanism** (`meta.description_embedding` / `description_embedding_meta`,
  `publishDescriptionEmbedding`, `searchSemanticAssets()`'s knn branch,
  `mark_semantic_stale` Painless logic — all gated behind
  `ASSET_SEMANTIC_ENABLED`, default off, never enabled in production).
  **This pass does NOT delete that mechanism** — see "Deferred" below.

## What this pass implements

### Mapping (`lib/es/asset-meta-mapping.ts`)

`videoAssetsMetaMappingProperties(inferenceId?: string)` gained an optional
parameter. When a non-empty `inferenceId` is passed, three
`semantic_text` properties are added under `meta`:
`description_semantic`, `abstract_semantic`, `work_title_semantic`, each
`{ type: 'semantic_text', inference_id: inferenceId }`. When omitted/empty,
none of the three are added (see "assumes eis" above) — existing behavior
(and existing tests, which call the function with no args) is unchanged.
`lib/es/indices.ts`'s three call sites (`videoAssetsMapping`,
`upgradeVideoAssetsMapping`, `ensureIndices`) now pass
`cfg.EMBED_INFERENCE_ID || undefined`.

### Write path (`lib/es/asset-meta.ts`)

New `deriveSemanticMirrorFields(fields)` (exported for testing): given the
`fields` map already built by `parseMetaPatchBody`, returns
`{ description_semantic, abstract_semantic, work_title_semantic }` mirrors —
only for keys actually present in `fields` (an unrelated PATCH, e.g. `tags`
only, does not rewrite untouched text), and using `work_title.en` (or `null`)
for the work-title mirror. `patchAssetMeta` merges this mirror into the
fields sent to the Painless script only when `cfg.EMBED_INFERENCE_ID` is
configured, and — reusing the exact soft-fail pattern already used for the
old `mark_semantic_stale` Phase 3.5 channel — retries without the mirror on
`strict_dynamic_mapping_exception` (an index that hasn't had
`yarn setup-indices` re-run since these fields were added must not fail the
editorial save). `description_semantic`/`abstract_semantic`/
`work_title_semantic` were added to `CLEARABLE_META_KEYS` so nulling the
lexical field also clears its mirror via the existing per-key
`ctx._source.meta.remove(key)` script branch. No `REVIEW_FIELD_KEYS` entries
— these are internal mirrors, not directly user-reviewable.

### New search axis: "Description" mode

New standalone module `lib/es/description-search.ts`,
`searchDescriptionAssets()` — asset-level (not chunk-level) query:
1. `enumerateEligibleAssetIds()` (existing, reused) applies the requested
   `variant_id`/`video_id`/facet filters to get the eligible video-id set.
2. A `bool.should` of three `{ semantic: { field, query } }` queries (one per
   mirror field, ES's native query type for `semantic_text`), filtered to
   those eligible ids.
3. Returns `{ video_id, title, work_title, score, thumb_url, duration_ms }`
   per hit — whole-video, no time window, thumbnail from chunk 0 of the
   asset's first variant.

Deliberately **not** folded into `searchChunksHybrid`'s chunk-level RRF
fusion — plan/03's already-decided "Result grain" principle says asset text
identifies videos, it makes no scene-presence claim, so a description match
should render as a whole-video result, not a fake moment.

**API** (`app/api/search/route.ts`): `bodySchema.modality` gained
`'description'` (additive-only enum value). A new `handleDescriptionSearch()`
branch runs before any of the existing hybrid/parse/sort_by logic and never
calls `searchChunks` — the existing visual/audio/both code path is
byte-for-byte unchanged. Response shape for `modality=description` is
intentionally different (`hits` are asset-level, no `chunk_id`/`start_ms`)
since there's no existing contract for this modality value to preserve.

**UI** (`app/page.tsx`): added a 4th "Description" button next to Video/
Audio/Both (`Modality`/local `ModalityBadge` types widened additively; no
change to the shared `SearchModality`/`ModalityBadge` types in
`lib/es/search-core.ts`, so live video is untouched). Rather than building a
bespoke whole-video card component, the description-mode API response is
mapped client-side into synthetic full-span `SearchHit`s (`start_ms: 0`,
`end_ms: duration_ms`, `chunk_id: 'description:' + video_id`,
`modality_badge: 'description'`) so the existing card/grouping/timeline
rendering is reused unchanged — clicking a result plays from the start of
the video and the timeline strip shows one full-width block. This is a
deliberate simplification versus the plan's earlier "no timestamp, dedicated
whole-video card" sketch; flagged here rather than silently substituted.
Hybrid-text / parse-query / sort-by controls are disabled (not hidden) when
Description mode is active, since none of those axes apply to it.

## Deferred / explicitly NOT done in this pass

**"All" mode: implemented in a follow-up pass (see
`todo/29-all-mode-2026-09-23.md`).** The user chose option (b) below
directly ("直接把 both=>all。但是要加入 text semantic 的部份" — rename
Both→All, and fold in the description-semantic channel). Shipped design:
`modality: "all"` runs the unchanged chunk-level `modality=both` RRF search
plus `searchDescriptionAssets` concurrently, and merges them as the
"separate section" framing from option (b) — chunk RRF hits first, then
description-only matches (deduped by `video_id` against the chunk hits)
appended as a distinct `description_hits` array, never blended into one
re-ranked score. The wire value `both` is kept as a deprecated alias for the
chunk-only behavior (no description merge), so nothing that already sends
`modality: "both"` breaks. The reasoning below (1–3) for why this needed a
separate pass, and why a naive blended score was rejected, still holds and
is preserved as the record of that decision.

The original three reasons this was deferred out of the first pass:

1. Fusing chunk-level results (visual/audio, which carry `start_ms`/`end_ms`)
   with asset-level results (description, which doesn't) is architecturally
   novel in this codebase — there is no existing precedent for mixing result
   grains in one ranked list, and the plan/03 "Result grain" principle was
   established specifically to keep them separate.
2. A naive interleave/merge (e.g. round-robin by rank) is easy to build but
   would be a made-up relevance heuristic with no tuning or evaluation behind
   it — shipping that silently and calling it "All" risks the user trusting
   a ranking that hasn't earned that trust.
3. This pass already delivered two full features (item 3 work_title, and
   Description mode end-to-end) plus 11 new unit tests; bundling an
   under-designed fusion mode into the same pass risked rushing exactly the
   piece most likely to need a redo.

**Recommended next step**: decide whether "All" should (a) literally rename
the existing "Both" button (visual+audio RRF only, unchanged semantics, just
a label change) — cheapest, but doesn't include description matches in "All"
despite the name; or (b) be a new fourth mode that runs the existing
`searchChunksHybrid`-equivalent visual+audio query and `searchDescriptionAssets`
concurrently and merges them with an explicit, documented heuristic (e.g.
score-normalized interleave, or "chunk hits first, description hits appended
below as an *also matched by plot* section" — a different result *section*
rather than a blended ranking, which sidesteps the cross-grain scoring
problem entirely). Recommend (b) with the "separate section" framing — it's
honest about the grain difference rather than hiding it in a merged score.

**Phase 3.5 (`description_embedding` dense_vector mechanism) was not
deleted.** It still coexists with the new semantic_text mirror fields.
Deleting it touches `lib/es/asset-meta.ts`, `lib/es/asset-meta-mapping.ts`,
`lib/es/hybrid-search.ts` (`searchSemanticAssets` + its call site in
`searchChunksHybrid`'s fusion), `lib/metadata/description-embed.ts` (whole
file), and their four test files, plus `docs/operations.md` /
`docs/api-contract.md`. Per this repo's "one concern per PR" convention
(explicit in `AGENTS.md`), that removal is corrected scope for a *separate*
pass, not bundled with adding the replacement. It is safe to defer: Phase 3.5
was never enabled in production (`ASSET_SEMANTIC_ENABLED` default off), so
its continued presence costs nothing beyond mapping/code size.

## Explicitly out of scope regardless

- Any relevance tuning or evaluation of `semantic` query results — the three
  `bool.should` clauses use ES defaults with no boost tuning.
- A dedicated whole-video card design (see "simplification" note above).
- Any change to live video search (`lib/live/*`) — confirmed unaffected;
  `SearchModality`/`ModalityBadge` in `lib/es/search-core.ts` (the ones
  `lib/live/search.ts` imports) were never touched.
