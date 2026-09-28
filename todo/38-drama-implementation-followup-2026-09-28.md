# todo/38 — Drama implementation follow-up (2026-09-28)

Source: [`reviews/drama-implementation-followup-code-review-2026-09-28.md`](../reviews/drama-implementation-followup-code-review-2026-09-28.md). This tracker records defects found after the `todo/37` F1–F7 fixes; those earlier code changes remain useful, but their acceptance claims are narrowed here.

## P1 — fix before drama acceptance

- [x] **I1 Strict mapping/payload parity:** map `meta.drama.modules_done`, `meta.drama.error` and `meta.drama.key_actors.role_en` (plus any other serialized fields) in create and upgrade paths; add a mapping/payload contract test; verify a terminal scripted update on the live target before an E2E claim.
  **Fixed 2026-09-28.** Added `modules_done` (keyword), `error{code,message}` and `key_actors.role_en` to `lib/es/asset-meta-mapping.ts`. Create (`videoAssetsMapping`) and upgrade (`upgradeVideoAssetsMapping`) share the same sources, so both paths are covered. New `lib/es/drama-mapping-contract.test.ts` walks a fully-populated `DramaMetaPayload` against the mapping and fails naming the missing leaf (sensitivity verified by removing one field). Live terminal `_update` still owed below.
- [x] **I2 Subtitle retry reconciliation:** remove stale same-run cue IDs when count/timing changes; never retire the last complete generation on a partial multilingual run. Test shrinking and failed-language retries against real ES document counts.
  **Fixed 2026-09-28 (unit contract; live ES counts still owed).** `indexDramaSubtitles` returns `segIds`; new `reconcileSubtitleLang` deletes same-(video,run,lang) docs outside the fresh ID set (refuses empty keep-sets); `retireOldSubtitleGenerations` takes a `lang` scope and is now called per successfully indexed language only — a failed language keeps its previous generation, and the whole-video terminal retirement is removed. Tests: shrink/changed-set query shapes, empty refusal, lang-scoped switch, runner asserts retire/reconcile fire for the succeeded language and never for the failed one.
- [x] **I3 Outcome UI:** suppress green success for drama partial/failed; keep batch failed rows/errors until explicit reset or retry; browser-test single and batch outcomes after container rebuild.
  **Fixed 2026-09-28 (code; browser run still owed).** Success callout now gated on `isDramaSuccess` (no drama / succeeded / skipped) instead of merely terminal. Batch: any base/drama failure or skipped-file errors set a retain flag — `maybeFinishBatch` no longer auto-clears; the finished banner turns warning (`batchFinishedWithErrors`) with an explicit Clear-results button (`batchClearResultsLabel`, EN/ZH). Per-row retry already existed and is unchanged. Verified via `yarn build` typecheck; browser run still owed below.
- [x] **I4 Durable marker failure:** persist enough drama request/status for retry when the handoff marker write fails; hydrate it after process restart; test the failure branch through asset state.
  **Fixed 2026-09-28.** New durable `job.drama` record (`status/languages/modules/modules_done/run_id/error_*`) written by `jobToAssetDoc` on every base persist (create + partial patch; never touches editorial `meta`); mapped in a shared `videoAssetsJobMappingProperties()` used by both create and an extended upgrade diff. Hydrate prefers `meta.drama`, falls back to the job record (`running`→`pending`), so the marker-failure branch now survives restart and is retryable. Runner's outer catch persists (`persist: true`). Tests: handoff-failure restore, meta-wins precedence, running→pending — all through `resolveIngestJob`/asset state.

## P2

- [x] **I5 Audit scope:** verify the published synopsis and all script content labeled audited, or mark unreviewed spans provisional; require visual evidence for visual acceptance.
  **Fixed 2026-09-28.** The auditor now receives the full synopsis in-prompt (verdict covers synopsis + sample), and every answered outcome records `scope{synopsisChars, scriptSampleChars, cues per lang, stills}` in `directors_audit.json`. Unreviewed script beyond the 4000-char sample stays explicitly out of scope; `synopsis_status: audited` therefore means the synopsis itself was reviewed. Zero-still audits are visible in scope (auditor may return insufficient); no stronger block, to keep text-only flows working. Test asserts prompt contains the synopsis and scope values.
- [x] **I6 Korean and Thai source-language code boundary:** `ko` and `th` pass through request/UI, sidecar/embedded matching, ASR API/CLI with native `transcribe` language, timed index payload, and director/audit evidence. Node 22 build and bounded full suite passed. Human transcript quality is a separate review; live provider and ES checks remain open below.
- [x] **I7 Orphan GC:** add a bounded scheduled or operator sweep for aged crash artifacts, independent of a later run for the same video.
  **Fixed 2026-09-28.** New `sweepAgedDramaOrphans` (`lib/drama/frame-gc.ts`): scans `media/*/drama/*`, deletes only aged disposable dirs (the age gate is the active-run exclusion), caps scanned runs (500) and deletions (100). Operator entry `yarn drama-gc-sweep [--media-root= --max-dirs= --max-runs=]` (`scripts/drama-gc-sweep.ts`). Tests: aged/fresh/keep + bound/stoppedEarly.

## Acceptance gates

- [x] Node 22 `yarn test`: 82 files / 546 tests pass on 2026-09-28.
- [x] Node 22 `yarn build`: compile/typecheck/routes pass on 2026-09-28.
- [x] `yarn test`: 83 files / 573 pass on 2026-09-28 (I1–I5, I7; Homebrew Node 25 — Node 22 unavailable in this shell, nvm has only 20.x which cannot run Vitest).
- [x] `yarn build`: compile/typecheck/routes pass on 2026-09-28 (I1–I5, I7).
- [x] Read target assets mapping and verify terminal `meta.drama` `_update` plus subtitle bulk/delete-by-query live.
  **Verified 2026-09-28 (evening).** `yarn setup-indices` upgraded `video-assets` (no conflicts) and created `video-drama-subtitles`. Live mapping readback confirms every I1 field: `meta.drama.modules_done`, `error{code,message}`, `key_actors.role_en`, `synopsis_status`, plus durable `job.drama`. A disposable asset received a fully-populated terminal `persistDramaMeta` scripted `_update` (succeeded status, all optional fields) — accepted and persisted; asset deleted afterwards. Subtitle live check: bulk index by stable `_id` (g1 3 cues → g2 shorter/retimed → 4 docs, 2 overwritten + 1 stale + 1 new seg), `reconcileSubtitleLang` deleted exactly the 2 stale docs (count 4 → 2), `retireOldSubtitleGenerations` lang-scoped kept the previous `ko` generation while retiring `zh`. All test docs cleaned up.
- [ ] Chinese and Korean representative episode checks, with manual evidence review and source-language boundary recorded.
- [ ] Operational integration: run one Korean and one Thai sample through the configured ASR provider and live subtitle index; verify `lang: ko` / `lang: th` and no mismatched-stream assignment.
- [x] Rebuild/restart app with `docker compose up -d --build app` (2026-09-28 **evening**, after the I1–I7 fixes); replacement container is running, `GET /ingest` returned HTTP 200. Build output chunk `78929.js` (50753 B) is byte-identical to the host build and contains the I2 reconcile (`keepSegIds` + `deleteByQuery` `must_not`/`terms`/`seg_id`), I3 (`batchFinishedWithErrors`), I4 (`job.drama`) logic. Earlier 2026-09-28 10:02 rebuild predates the afternoon fixes; the evening rebuild supersedes it. Worker image was not changed.
- [x] Node 22 `yarn build` passed for ko/th code (2026-09-28); `yarn test --maxWorkers=4` passed 82 files / 560 tests. Unrestricted `yarn test` had one unrelated 5-second `key-scenes` timeout; that file passed alone and in the bounded full run.
- [ ] Standalone `yarn tsc --noEmit` reports 45 existing test-file errors outside the ko/th files; the ko/th tests touched here have no reported errors. Reconcile this optional whole-tree check separately from the passing required `yarn build` gate.
- [ ] Separate human quality round: review representative Korean and Thai transcripts and timestamps. This is not a code-development acceptance gate.
- [ ] Restart after handoff success/failure; sequential and changed-cue retry on ES; browser SSE/outcome test against rebuilt container.
- [ ] p95/inference cost and multi-replica ownership/progress if deployed with replicas.

## Follow-up disposition (2026-09-28 evening)

The drama core (P0–P3) was committed as `03932da` on `live-video-search`; the
P4 drafts (`lib/drama/start-existing.ts`, `app/api/library/[videoId]/drama/`)
and the unrelated suggest/group worktree changes were intentionally left out.
Post-commit `yarn build` and `yarn test` (83 files / 573) both pass on the
working tree.
