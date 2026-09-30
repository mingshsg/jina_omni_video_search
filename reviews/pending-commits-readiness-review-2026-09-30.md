# Pending commits readiness review — 2026-09-30

Scope: `codex/drama-enrichment-complete` at `39abb06` versus GitHub `origin/codex/drama-enrichment-complete` at `7226d22` (17 local commits). Reviewed Group search, naming/rename, metadata editor/Suggest, and chunk presets/custom; checked repository trackers and current build/test output. The two pre-existing untracked ` (1).md` documents were left untouched.

**Verdict: hold the 17-commit code push. The build and 744 tests pass, but four user-visible failure paths need repair and live acceptance remains NOT RUN.**

## P2 — should fix before pushing

1. **A long CJK source name exceeds the filesystem component limit.** `lib/ingest/media-name.ts:44` uses `return [...cleaned].slice(0, MEDIA_FILENAME_STEM_MAX).join('')` with `MEDIA_FILENAME_STEM_MAX = 80` (`:10`), then `lib/ingest/paths.ts:43` adds `-<12 hex><ext>`. Eighty three-byte Han characters plus `-123456789abc.mp4` produce **257 UTF-8 bytes**, while `getconf NAME_MAX /private/tmp` returned **255**. The upload path adds `.part` (`lib/ingest/sources.ts:170`), making even shorter names fail on the temporary write. Upload, URL download, and local copy all now call this filename helper. Cap by UTF-8 bytes, reserving room for suffix, extension, and `.part`, and cover multibyte names in tests.

2. **The metadata editor can stay on a false loading state after a request failure.** `components/EditMetadataFlyout.tsx:479-500` awaits `Promise.all` and throws on a non-OK catalog response before `setCatalogs` and `applyDto`; `:514-520` sets an error only if `metaLoadFailed` was set by a non-OK metadata *response*. A rejected fetch/JSON parse leaves that flag false, and a catalog failure deliberately leaves `catalogs` null. The render condition at `:1637` is `loading || !catalogs ? ...metaLoading...`, so the operator sees an endless loading message with no usable form or retry after loading becomes false. Handle the two requests independently; apply a valid metadata DTO even when catalogs fail, show an explicit error/retry when metadata fails, and make `!catalogs` a failure state after loading finishes.

3. **An older Group availability response can overwrite a newer selection.** `components/SearchGroupFilter.tsx:90-111` starts a new `fetch` whenever `selectedKey` changes and unconditionally calls `setData(body)` or `setData(null)` when each request settles. Unlike the exact-name lookup, this main load has no request sequence or cancellation. If the first selection's request finishes last, the component evaluates the second selection against the first response and can show a false missing/incompatible notice. Ignore or abort stale loads and test rapid selection plus out-of-order responses at the component boundary.

4. **URL ingest can store an encoded filename as its display title.** `app/api/ingest/route.ts:171-174` passes `result.provenance.source_origin_path` to `titleFromFilename`, which only splits paths and strips the extension (`lib/ingest/media-name.ts:19-23`). `sanitizeUrlProvenance` stores `url.pathname` (`lib/ingest/url-sanitize.ts:22`), which is percent encoded for non-ASCII path segments. Thus a URL ending in a Chinese filename can produce `%E7...` as the asset title while the client preview decodes that segment (`app/ingest/page.tsx:579-583`). Decode the last URL path segment safely before deriving the title; retain the sanitized provenance and test encoded CJK and malformed escapes.

## P3 — hygiene

- `git diff --check origin/codex/drama-enrichment-complete..HEAD` exits 2: `todo/41-naming-and-group-fixes-2026-09-30.md:179` has a new blank line at EOF. Remove it in a later correction commit; do not rewrite historical review bodies.
- The 17-commit branch mixes Group search, naming migration, Suggest UI, and chunk presets. `AGENTS.md` asks for one concern per PR. Split review/merge units by concern before opening a PR; pushing the branch as a backup would not make the combined diff acceptance-ready.

## Checked and rejected

- **No regression in the legacy `20s` preset definition:** `lib/ingest/chunk-presets.ts:55-57` gives new `20s_3s` its own id and keeps legacy `20s` at 20s/2s, consistent with the user's recorded decision in `todo/42`.
- **Rename helper does not re-embed chunks:** `lib/es/asset-rename.ts:91-117` updates the asset title and only the chunk `video_title`. The one-off script is dry-run by default and pins ids and expected titles. This static check does not verify its earlier live execution record.
- **Manual Group backfill remains opt-in:** no new automatic backfill path was found in this diff. A real per-video write is an acceptance gate, not evidence from the unit tests.
- **Untracked duplicate historical documents are not part of the 17 commits:** `git status --porcelain` shows only the two ` (1).md` copies. They were not changed or deleted.

## Gates

| Gate | Result | Evidence / remaining work |
| --- | --- | --- |
| GitHub branch comparison | PASS | `git ls-remote origin`: `7226d22`; local HEAD `39abb06`, 17 commits ahead. |
| Full Node 22 test suite | PASS | `PATH=/usr/local/bin:$PATH yarn test --maxWorkers=4`: 98 files, 744 tests passed at HEAD. |
| Production build and typecheck | PASS | `PATH=/usr/local/bin:$PATH yarn build`: compiled, typechecked, generated routes at HEAD. |
| Whitespace check | FAIL | `git diff --check` reports blank line at `todo/41:179`. |
| Long multibyte filename / failed editor fetch / stale Group response / encoded URL title regressions | NOT RUN | No tests cover these failure paths yet; see findings. |
| New availability aggregation against target Elasticsearch mapping | NOT RUN | Mocked tests do not prove server acceptance or actual ready-variant buckets. |
| Rebuilt container and browser Group/metadata/custom-chunk flows | NOT RUN | Current running demo is not proof of this checkout until rebuilt and checked. |
| Grouped text/image/live regression, real custom ingest/search, Suggest Agent Builder, and one-video manual backfill | NOT RUN | Separate live/quality acceptance gates in `todo/40`–`todo/42`. |
| Push or PR | NOT RUN | Held pending P2 repairs and scoped acceptance. |

Follow-up: [`todo/43-pending-commits-readiness-2026-09-30.md`](../todo/43-pending-commits-readiness-2026-09-30.md).
