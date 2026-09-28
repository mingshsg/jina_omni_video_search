# Drama implementation follow-up code review — 2026-09-28

Scope: inspect the follow-up code for `todo/37` F1–F7 and its ingest, Elasticsearch mapping, retry, SSE/UI and subtitle interfaces on `live-video-search` at `db23b88` plus uncommitted changes. This supersedes the implementation-status verdict in the earlier 2026-09-28 recheck; it does not claim live-instance or browser acceptance.

**Verdict: the fixes improve single-process behavior, but the implementation still needs repair before a drama run can be accepted.** Node 22 `yarn test` passes (82 files / 546 tests) and `yarn build` passes. The strict asset mapping omits fields written by every completed run; retry can retain stale cues; and failed enrichment still gets a green success UI.

## P1 — blocking

### I1 — Terminal `meta.drama` payload does not match the strict asset mapping

`lib/es/indices.ts:29-34` declares `dynamic: 'strict'`. The `meta.drama` mapping at `lib/es/asset-meta-mapping.ts:80-129` has no `modules_done` or `error`, and nested `key_actors` has no `role_en`. Yet `lib/drama/runner.ts:436-465` always sends `modules_done` and may send `error` and `key_actors[*].role_en` through `persistDramaMeta` (`lib/drama/persist-meta.ts:50-77`, `ctx._source.meta.drama = params.drama`). A successful stage produces a nonempty `modules_done`; an actor with an English role adds `role_en`. On an index created or upgraded solely from this mapping, the terminal scripted update should be rejected as an unknown field, leaving the durable running marker in place while the in-memory job becomes partial. Elastic documents that inner objects inherit `dynamic` and `strict` rejects documents with new fields: [dynamic mapping reference](https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/dynamic); see also the [Update API](https://www.elastic.co/docs/reference/elasticsearch/rest-apis/update-document). The current deployed mapping was **not** read, so this is a source-contract failure, not a claim about the instance's present mappings.

Declare every persisted field, update both create and migration mappings, add a payload-versus-mapping contract test, and verify one terminal `_update` against the target cluster. This must precede an end-to-end acceptance run.

### I2 — Stable run IDs do not remove stale cues from a shorter retry

`lib/drama/index-subtitles.ts:42-79` `_index`es current cues by `videoId_runId_lang_index_startMs`. Reusing `runId` overwrites matching IDs, but cannot remove old IDs when a retry has fewer cues, a cue start time changes, or one language no longer resolves. `retireOldSubtitleGenerations` at `:103-122` excludes the **current** run ID and cannot remove those stale same-run documents. Moreover `lib/drama/runner.ts:489-498` calls retirement whenever *any* subtitle language completed, even when another language failed or the run is `partial`; that can remove an older complete generation while the new generation is incomplete. The current tests assert stable IDs and the delete query shape (`lib/drama/index-subtitles.test.ts:78-116`), but do not test shrinking/changed cue sets or multilingual partial retry.

Stage a complete generation and switch the active run only after all requested subtitle languages succeed, or delete/reconcile obsolete IDs per video/run/language after successful replacement. Test both shorter retry and partial multilingual failure with ES document counts.

### I3 — Partial/failed drama still renders success and batch results auto-clear

`app/ingest/page.tsx:1194-1199` renders `EuiCallOut color="success"` whenever base status is `ready` and drama is terminal; that includes `partial` and `failed`. The new warning/danger callout at `:1200-1224` appears **alongside** the green one. In batch, `:388-405` keeps the failed row initially, but `maybeFinishBatch` at `:350-357` calls `resetBatchForm()` after 2.5 seconds, and `resetBatchForm` clears both rows and errors at `:185-200`. Thus `todo/37` F4's “partial/failed is not a success” and “rows stay visible” claims are not met.

Gate the success callout on successful/skipped drama, and retain failed/partial batch results until an explicit reset or retry. Exercise single and batch terminal states in a browser against a rebuilt container.

### I4 — Handoff-marker failure is still lost after restart

`lib/ingest/pipeline.ts:458-469` catches `prepareDramaHandoff` failure and sets `job.drama.status = 'failed'` only in memory, then persists base `ready` at `:472-503`. But `lib/ingest/job-store.ts:263-315` does not put drama options/status in `jobToAssetDoc`; `:421-440` can hydrate a drama job only when `meta.drama` exists. If the marker write fails and ready persistence succeeds, the user sees a retryable failure only until memory is dropped; after restart the ready asset has no drama request. This is the exact failure branch the new handoff was meant to cover. The runner's outer catch also emits `persist: false` (`lib/drama/runner.ts:525-545`), so an unexpected top-level error is not durably recorded.

Persist a minimal requested/failed drama record through a reliable path before or with ready, and make retry discover it after restart. Test the marker-failure branch through asset hydration, not only the thrown handoff helper.

## P2 — should fix

### I5 — `audited` describes more than the auditor checks

`lib/drama/directors-script.ts:181` lets the synopsis draw on 12,000 characters, but the audit prompt sees only `opts.sample.slice(0, 4000)` at `:302-303`, at most 60 early cues per language (`:253-260`), and up to eight stills (`:222-273`). `lib/drama/runner.ts:305-308,443-451` marks the whole synopsis `audited` on a single supported verdict. Later script claims or the synopsis itself can therefore escape review. Visual stills are a real improvement, but an auditor response with zero readable stills can still mark visual claims supported. Audit the actual synopsis and every published section, or name the narrower reviewed span and keep the rest provisional.

### I6 — Native Korean subtitle processing is absent from the drama path

`lib/ingest/drama-options.ts:4` allows only `['zh','en']`; the UI mirrors that at `app/ingest/page.tsx:224-227`, and `lib/drama/asr.ts:15-17` maps every non-`zh` request to English. That leaves no `ko` extraction/ASR choice for a Korean-language episode without Chinese/English subtitles, despite this demo's Chinese and Korean drama focus. If Korean-source dialogue is in scope for this phase, add `ko` end to end, including stream tags, sidecars, ASR, timed index and script evidence. Otherwise document the explicit zh/en-only boundary and use a Korean episode with a suitable sidecar for acceptance.

### I7 — Orphan frame cleanup still depends on a later run of the same video

`lib/drama/runner.ts:400-408` cleans the current run immediately and sweeps old runs only when another enrichment run for that video reaches this code. `lib/drama/frame-gc.ts:65-68` correctly age-gates orphans, but no scheduled sweep exists. A crash orphan for a video never processed again remains indefinitely. Own-run cleanup is fixed; the stated backend cleanup-job requirement (`todo/35` P3) is still open. Add a bounded periodic/operator sweep over eligible drama roots with active-run exclusion.

## Checked and not raised as new defects

- The in-process per-video lease is acquired before the runner's first await (`lib/drama/runner.ts:70-74,143-146`), and retry checks it (`app/api/jobs/[id]/retry/route.ts:58-85`). This addresses same-process overlap. Cross-replica ownership remains an acknowledged acceptance gap, not a new finding here.
- Director coverage now sums successful ranges and names failed gaps (`lib/drama/directors-script.ts:486-515`); the mixed-success test passes. The policy is sampled publication, not whole-episode coverage.
- Empty actor and scene output now throw, and scene fallback is labeled in progress and the workspace (`lib/drama/key-actors.ts`, `lib/drama/key-scenes.ts`). The proposed `ko` and audit issues above are separate.
- A stalled EIS body now times out in the unit test (`lib/drama/eis-chat.test.ts:54-64`). The per-read timeout promises at `lib/drama/eis-chat.ts:125-139` are not cancelled after successful reads; this is timer hygiene to revisit if profiling shows cost, not an acceptance blocker.

## Gates

| Gate | Result | Evidence / limit |
| --- | --- | --- |
| `yarn test` under Node 22.13.1 | PASS | 82 files, 546 tests on 2026-09-28 |
| `yarn build` under Node 22.13.1 | PASS | Next.js 14.2.35 compile, typecheck, route build on 2026-09-28 |
| `yarn test` under default Node 20.15.1 | FAIL (environment) | Vitest startup `ERR_REQUIRE_ESM`; rerun under project-required Node 22 passed |
| Live assets mapping and scripted terminal update | NOT RUN | I1 is based on current source mapping; instance may differ |
| Real subtitle retry / delete-by-query, Chinese/Korean episode | NOT RUN | Need ES counts, source-language evidence and human review |
| Rebuilt-container browser SSE, batch outcome and restart recovery | NOT RUN | Unit/build do not verify I3/I4 runtime paths |
| p95, inference cost, multi-replica ownership | NOT RUN | No representative measurement or shared lease |

Follow-up: [`todo/38-drama-implementation-followup-2026-09-28.md`](../todo/38-drama-implementation-followup-2026-09-28.md).
