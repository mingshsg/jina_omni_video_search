# Phase 4a/4b post-rebuild review — 2026-09-22

**Verdict: still not ready for sign-off.** Rebuilding confirms the current local Suggest route and Library UI run in the container, but it does not close the eight findings in the [initial implementation review](./hybrid-metadata-search-phase4a-4b-review-2026-09-22.md). Runtime evidence strengthens F4-01, F4-05, F4-06, and F4-08. F4-02/F4-03/F4-04 remain code findings requiring targeted interaction/integration tests; F4-07 still needs a labeled quality audit.

## Rebuild and deployment evidence

- Command: `docker compose up -d --build app` in the repository. **PASS.** Image production `yarn build` compiled, type-checked, generated static pages, and included `/api/library/[videoId]/meta/suggest`.
- Compose recreated only `jina_video_embedding-app-1`; the rebuilt container was running on `127.0.0.1:3000`. `docker inspect` confirmed the same `/Users/ming.shen/Downloads/jina_video_embedding/data` → `/app/data` bind mount. No media files or Elasticsearch documents were deleted.
- `GET http://127.0.0.1:3000/library`: **200**. `GET /api/library`: **200**, 26 indexed assets.
- `POST /api/library/{videoId}/meta/suggest` on an existing asset: **200**, `provider: local`, unsaved suggestions. A browser Suggest click filled the editor; closing and reopening the same asset showed `meta_revision: 0` and blank description/abstract, confirming that Suggest alone did not persist anything.
- `yarn test`: **PASS**, 57 files / 333 tests. `git diff --check`: **PASS**.

## Post-rebuild observations

1. **F4-01 search-content pollution confirmed in the UI.** On the existing `18_JurassicPark` asset, Suggest displayed `Title indicates: “18 JurassicPark”. This draft restates the title clue only — it does not claim scenes, dialogue, cast, or events in this file.` as the actual Description field. The warning is therefore positioned for storage in searchable `meta.description`, not merely shown as review guidance. No Save was performed.
2. **Current library title coverage is poor (F4-06/F4-07).** Applying the deployed local extraction logic to the 26 titles returned by `/api/library` produced description drafts for **26/26**, each containing the same disclaimer; **20/26** residual work titles still began with a numeric filename prefix; **0/26** produced year, video type, or tag drafts. This is a coverage/noise probe, **not** a correctness or unique-work match audit. It does not close the Phase 4b labeled-sample gate. The title cleanup needs a real corpus with expected work/title/type outcomes before these drafts should be promoted.
3. **F4-05 review evidence absent in the UI.** The editor showed only a generic “Filled empty fields…” callout, not the per-field source/confidence/evidence returned by the API. The browser displayed the description and abstract values but no supporting clue alongside either field.
4. **F4-08 caller-controlled language confirmed on the running route.** A read-only POST with `media_language: "en"` returned a language suggestion with `source: "media_tag"` even though that tag was supplied by the caller rather than retrieved from the asset. The ordinary editor does not send a media tag.

## Remaining limits

- No metadata PATCH/Save was issued against existing assets. F4-02/F4-03 are supported by the React/PATCH code path and a local parser reproduction in the initial review, but were not re-demonstrated end-to-end in the rebuilt browser.
- No artificial network stall was injected. F4-04 remains open based on missing timeout/abort logic and Save being disabled while `suggesting`.
- No external catalog or LLM is configured or called. Phase 4b remains a local title-clue subset.
- No labeled relevance/accuracy, false-match, cost, or search-result comparison was run. A working endpoint and green build/tests do not establish metadata quality.

## Disposition

Keep [F4-01–F4-08 follow-up](../todo/14-hybrid-phase4a-4b-review-2026-09-22.md) open. Prioritize removing disclaimer text from indexed fields, fixing provenance across Suggest/Save, and creating a labeled title sample. Rebuild the app again only after product-code fixes; the current rebuild contains the reviewed defects.
