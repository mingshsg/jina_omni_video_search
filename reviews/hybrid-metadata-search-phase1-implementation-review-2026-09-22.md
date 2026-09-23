# Hybrid metadata search — Phase 1 implementation review

Reviewed 2026-09-22, branch `live-video-search` at `b303e15` plus the current
uncommitted Phase 1 worktree. Scope: asset mapping and the live Elasticsearch
instance, metadata validation/PATCH/GET, ingest write ownership, catalog,
editor, and deployment. This review made **no writes to Elasticsearch** and
did not modify the implementation or existing plan/todo.

**Verdict: Phase 1 is substantially implemented, but not ready to mark
complete.** The deployed schema matches the intended Phase 1 fields and the
one populated metadata example is searchable. A supported language choice is
rejected on save; mapping upgrades silently accept an incomplete or wrong
existing `meta` mapping; and the write/concurrency and container acceptance
claims have not been exercised end to end.

## Findings

### P1 — The editor offers two language values that PATCH always rejects

`lib/metadata/catalogs.ts:58–63` includes `zh-Hans` and `zh-Hant`; the catalog
API returns that same list and `EditMetadataFlyout` submits the selected value.
`lib/metadata/validate.ts:279–281` lowercases input, then checks membership in
the case-sensitive set. Thus `zh-Hans` becomes `zh-hans`, which is absent. A
direct call to `parseMetaPatchBody` confirmed both variants return
`META_INVALID_LANGUAGE`, while `zh` succeeds. An operator cannot save two
visible options.

**Fix:** resolve language tags case-insensitively to a canonical catalog spelling
(`zh-Hans`/`zh-Hant`) and test every value returned by the catalog API through
the PATCH validator. If lowercase storage is intended, make the pinned catalog
and API agree on that representation.

### P1 — Mapping setup only checks the top-level `meta` name, not its schema

`lib/es/indices.ts:205–229` marks `meta` “alreadyPresent” whenever any
property with that name exists. It never compares or adds missing `meta.*`
children, `actor_aliases.copy_to`, `search_text.cjk`, or analyzer/type
settings. An interrupted/older partial migration can therefore produce a
successful no-op setup even when later metadata writes fail or search silently
loses recall. The deployed instance happens to have the expected fields;
this is a migration/idempotency bug, not an observed live mismatch.

**Fix:** recursively compare the desired mapping with the existing mapping.
Add legal missing children in a checked `putMapping`, and fail clearly on
incompatible field types/analyzers/copy targets that require reindexing.
Exercise fresh, complete-existing, partially migrated, and conflicting
mapping fixtures; report exact added/existing/conflicting paths.

### P2 — Blank tag elements violate the advertised clear rule

The validator accepts `tags: [" "]` because length is checked before trim
(`lib/metadata/validate.ts:156–162`). It then writes `tags: []` and
`tags_key: []` with `review.tags.confirmed=true` (lines 307–317). A direct
call reproduced this. The API contract says an empty array clears the field
and its provenance. **Fix:** normalize before validating; if all tags become
empty, clear both fields and the review entry, or reject the input explicitly.

### P2 — An exhausted transport conflict is reported as a stale editor revision

`lib/es/asset-meta.ts:228–234` returns `META_CONFLICT`/409 after update-version
retries are exhausted even if the subsequent read shows the same
`meta.revision` the editor submitted. `docs/api-contract.md:679` defines that
code as a stale `expected_revision`. The bounded retries are appropriate, but
this final case needs a distinct retryable error/status or a conditional retry
based on the unchanged metadata revision. Test concurrent ingest/editor writes
with forced version conflicts.

### P2 — Catalog refresh and Phase 1 acceptance are still open

`config/people.json` is correctly outside ignored `data/`, and the Dockerfile
copies it into the standalone runner. `lib/metadata/people.ts` expands aliases
on save, but no bounded backfill exists when catalog aliases change; old asset
docs retain old `actor_aliases`/`actor_keys`. The Phase 1 todo marks the person
catalog item complete while saying the backfill is deferred. Either implement
and test the backfill, or explicitly move catalog-change support to a later
phase and mark it as such.

The todo also checks off the Docker-copy item while noting built-image runtime
verification is still open. New tests cover pure catalog/validation functions
only; there is no automated PATCH script, 404/409/clear, ingest-interleaving,
mapping-upgrade, or built-container catalog-load test. These are acceptance
gaps rather than observed failures.

## Live instance schema and retrieval evidence

Read-only requests to the configured Elasticsearch project on 2026-09-22:

| Check | Result |
| --- | --- |
| `video-assets` mapping | `dynamic: strict`; `meta` has description/abstract/year, actor IDs/aliases/keys/display, type/language/country/tags, fixed review children, revision/date, and `search_text.cjk` with `cjk` analyzer |
| `actor_aliases.copy_to` | Deployed as `meta.search_text`; the sample alias matches a `match_phrase` query on that field |
| Index counts | 26 assets, 2,164 chunks; all 26 assets currently have root `status=ready` |
| Metadata coverage | 1 asset has `meta.revision`; 1 has `meta.actor_ids` |
| Populated sample | Revision 1; one actor ID, five aliases, seven derived keys; `review` entries present; `search_text` absent from `_source` as expected for `copy_to` |
| Retrieval | Exact actor-ID filter, copied alias phrase, and Han alias on `meta.search_text.cjk` each returned one hit |

This confirms that the mapping is installed and one saved metadata document is
indexed. It does **not** establish migration behavior on a partially upgraded
index, edit/retry concurrency, or preservation of metadata during new ingest.
No instance mutations were used to test those paths.

## Verification status

- **PASS:** `yarn test` — 48 files, 252 tests, including 9 new metadata tests.
- **PASS:** deployed mapping and read-only alias/ID/CJK retrieval checks above.
- **FAIL:** `yarn tsc --noEmit --pretty false` — 41 errors, all in unchanged
  `lib/live/*.test.ts` files (missing `NODE_ENV` in `ProcessEnv` fixtures); no
  Phase 1 file was named, but the repository-wide gate remains red.
- **NOT RUN:** production build/container runtime, browser editor flow,
  scripted PATCH concurrency and ingest-preservation checks, and partial-index
  migration. `CI=1 yarn lint` opened the interactive ESLint setup prompt, so
  it was not a usable lint gate.
- **FAIL (hygiene):** `git diff --check` reports trailing whitespace in the
  current `docs/data-model.md` edit. No user-owned edits were changed here.

Follow-up tasks: [`todo/05-hybrid-phase1-implementation-review-2026-09-22.md`](../todo/05-hybrid-phase1-implementation-review-2026-09-22.md).
