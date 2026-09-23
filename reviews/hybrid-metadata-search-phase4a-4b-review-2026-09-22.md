# Hybrid metadata search — Phase 4a/4b implementation review (2026-09-22)

**Verdict:** Do not sign off Phase 4a/4b yet. The local suggestion API is read-only and the deterministic extractor has unit coverage, but the editor can lose suggestion provenance, a pending request can strand an unsaved form, and title-only description text contaminates search. Phase 4b's online catalog and optional text model are explicitly deferred; its sample audit and quality gates lack evidence. The tracker completion claims for those gates were reopened as part of this review.

**Scope:** Current `live-video-search` working tree. Reviewed `lib/metadata/suggest-local.ts`, the Suggest route, Library editor, PATCH validation/storage, ranking/embedding consumers, plan/todo/docs. Existing unrelated working-tree edits were not modified. Review findings refer to current uncommitted files.

## Findings

### P1 — F4-01: The title-clue disclaimer becomes searchable content

`suggestDescriptionFromTitle` puts “does not claim scenes, dialogue, cast, or events” in the *description value* (`lib/metadata/suggest-local.ts:301-316`), and the abstract duplicates the title (`:320-335`). On Save, `meta.description`/`meta.abstract` are queried by BM25 (`lib/es/hybrid-search.ts:167-179`) and embedded when the optional semantic channel is on (`lib/metadata/description-embed.ts:31-39,63-68`). Thus queries about “dialogue”, “cast”, or “events” can match videos solely because of the disclaimer; identical boilerplate also enters embeddings. This undermines the search feature that metadata is meant to improve. Keep the caveat in the suggestion UI/evidence, not indexed text. For filename-only evidence, consider leaving description/abstract empty unless a concise, non-duplicative description can be grounded.

### P1 — F4-02: Multi-field Suggest can fill fields without marking them as suggestions

`onSuggest` mutates `nextSources` and `applied` inside six `setState` updater callbacks, then reads them immediately (`components/EditMetadataFlyout.tsx:287-366`). React may eagerly evaluate the first updater but defer later ones after scheduling a render; updater callbacks may also be re-run. The displayed values can therefore be applied while `fieldSources` omits some fields or the UI reports “empty.” A subsequent Save labels those fields manual (`lib/metadata/validate.ts:227-236`). Compute one immutable merge result and provenance together (or use a reducer), then test a response with several suggestions plus user typing during the request.

### P1 — F4-03: A later Save overwrites prior suggestion provenance

The flyout loads existing values and resets `fieldSources` to `{}` (`components/EditMetadataFlyout.tsx:126-136`), then submits **every** field on Save (`:402-415`). `parseMetaPatchBody` creates a new review entry for each non-null submitted value and defaults missing sources to `manual` (`lib/metadata/validate.ts:227-255,285-356`); the ES script replaces those review entries (`lib/es/asset-meta.ts:120-123`). Editing only an actor on a later visit silently changes an unchanged suggested year/description to manual. Reproduction with `parseMetaPatchBody({expected_revision:1, year:1961, description:'Title clue', field_sources:{}})` returned both sources as `manual`. PATCH already supports omitted fields; send only changed fields or preserve unchanged review entries, and add a two-save regression test.

### P1 — F4-04: A stalled Suggest request blocks Save without timeout or cancellation

`onSuggest` calls `fetch` without `AbortController` or timeout (`components/EditMetadataFlyout.tsx:239-277`), while Save is disabled for the entire `suggesting` state (`:615-620`). If the request hangs, the editor cannot save its existing work. The Cancel button closes the whole flyout (`:598-603`), losing the draft instead of cancelling only Suggest. Add a bounded request timeout and Cancel Suggest, or keep Save usable while safely ignoring a late response. The Phase 4a tracker currently marks timeout/cancellation handling done (`todo/02-hybrid-metadata-search-todo.md:196-199`).

### P2 — F4-05: Per-field evidence is discarded before review/save

The API returns `value`, `source`, `confidence`, and `evidence` (`lib/metadata/suggest-local.ts:20-27`), but the flyout uses only each `value` and a generic callout (`components/EditMetadataFlyout.tsx:289-365,589-595`). PATCH carries only `field_sources` (`:402-415`), and stored review entries contain generic `source: suggestion`, `confirmed`, and no confidence or evidence (`lib/metadata/validate.ts:10-26,230-236`). The operator cannot assess why a year/type/description was proposed, and the saved record cannot identify the title clue. The plan explicitly requires source/confidence/evidence before accepting a draft (`plan/03-hybrid-metadata-search-plan.md:795-801`). Show per-field evidence in the editor; preserve appropriate bounded provenance on Save (with mapping migration if stored shape changes).

### P2 — F4-06: Title parsing produces weak or misleading work titles

The extractor removes each type token wherever it occurs (`lib/metadata/suggest-local.ts:165-173`) and treats different matched types as a conflict (`:260-277`). Direct local calls produced `Official Trailer Breakfast at Tiffanys 1961.mp4` → work title `Official Breakfast at Tiffanys`; `Interview with Alice 2024.mp4` → `with Alice`; `My Movie Trailer 2024.mp4` → work title `My` and no video type. These feed descriptions/abstracts and undermine catalog matching. Separate filename decorations from words inside a work title, define trailer-over-work-type precedence, and evaluate a labeled title corpus before enabling drafts broadly.

### P2 — F4-07: The “small library sample” and quality gates are marked complete without results

`todo/02-hybrid-metadata-search-todo.md` had checked off a library-title audit and grounded-field/abstention/cost gates, but cited only local heuristics; this review reopened those items. `todo/13-hybrid-phase4b-progress-2026-09-22.md:21` says accuracy/abstention/cost gates are deferred, and no sample counts or thresholds appear in the reviewed files. Keep these items open until a frozen sample, match/abstention results, and acceptance thresholds are recorded. The online catalog and text-only LLM remain explicitly unimplemented (`lib/metadata/suggest-local.ts:5-8`; `docs/api-contract.md:744-745`), so Phase 4b is currently a **local title-clue subset**, not the full planned phase.

### P2 — F4-08: Caller-supplied language is labelled as an observed media tag

The Suggest route accepts `media_language` directly from the POST body (`app/api/library/[videoId]/meta/suggest/route.ts:27-42,97-101`) and passes it to `suggestLanguageFromMediaTag`, which returns `source: media_tag` with 0.7 confidence (`lib/metadata/suggest-local.ts:280-295`). No media tag is read from the asset; the normal editor does not send one. A caller can claim any supported language and receive apparently media-grounded provenance. Either derive the tag server-side from stored probe metadata, or label a caller-provided hint honestly and lower/omit its confidence. Keep 4a language incomplete until actual tags are available.

## Validation and limits

- `yarn test`: **PASS**, 57 files / 333 tests; local suggestion unit tests pass.
- `yarn build`: **PASS** (Next.js compile, types, static pages).
- `git diff --check`: **PASS** before review artifacts.
- Direct `node --import tsx` calls reproduced the work-title/type examples above and the PATCH provenance default. `tsx -e` was blocked by sandbox IPC (`listen EPERM`), so `node --import tsx -e` was used instead.
- **NOT RUN:** browser interaction for concurrent typing/Suggest, live POST→PATCH→search on an indexed asset, Docker rebuild/runtime check, relevance evaluation on a labeled library sample, external catalog or LLM calls. A green unit/build gate does not close those findings.

## Container answer

The production app is copied into the image in `Dockerfile` and Compose mounts media only (`docker-compose.yml`). To test a fixed app in Docker, use the same `APP_PORT` and `VIDEO_DATA_DIR` values as the current deployment and run `docker compose up -d --build app`; this recreates the app service without removing the media bind mount. No rebuild was performed during this review. Do not use `down -v` for this task.
