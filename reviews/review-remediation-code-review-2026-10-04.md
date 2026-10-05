# Review remediation — code review — 2026-10-04

Scope: uncommitted remediation on `codex/enrichment-add-runs`, based on `92b317b`, for the October 3 demo sweep and October 4 branch-wide review. Their historical review bodies are preserved. This review supersedes their code dispositions; acceptance limits below remain open. Tracker: [todo/55](../todo/55-review-remediation-2026-10-04.md).

**Verdict: all scoped code findings repaired; tests/build and isolated live checks PASS. Full release acceptance remains open.** No commit or push performed in this remediation pass.

## Findings and dispositions — P2

No additional blocking finding was identified in the reviewed remediation. Fixed original findings:

1. **S1 — retry history loss.** `app/api/jobs/[id]/retry/route.ts:107-120` constructs a fresh pending request without `run_id`, then `await prepareDramaHandoff(prev, previousDrama.run_id)` and `await updateJob(..., { persist: true })` before accepting. Fresh generations preserve prior published results. Host transcripts are copied using `COPYFILE_EXCL` (`lib/drama/workspace.ts:64-75`) without changing original files or overwriting a current host edit. Route and workspace regressions cover these boundaries; isolated live metadata snapshot verified earlier synopsis/script survived.
2. **S2/D1 — unowned running marker.** `lib/drama/safe-dto.ts:14-16` keys interruption on absence of `isDramaWorkActive` and in-memory `pipelineRunning`; `:128-150` returns failed/retryable with `Enrichment interrupted; retry to start a new run`. Shared start reservation protects prepared handoffs, and Library Start allows unowned markers. Final job state is durably written (`lib/drama/runner.ts:531`, `:556`, `persist: true`). Tests cover final write failure/top-level throw and release; browser fixture showed failed and Enrichment options. This is single-process ownership, not durable multi-replica coordination.
3. **U1 — stale Group save.** `components/EditMetadataFlyout.tsx:1509` adds `selectedGroup` to the save dependencies. Production browser changed only Group, saved `review-fixture-group`, and displayed Metadata saved; no existing user asset was edited.
4. **U2 — stale/colliding operator hint.** `components/EditMetadataFlyout.tsx:999` includes `operatorHint`; `app/api/library/[videoId]/meta/suggest/route.ts:164-193` passes the same normalized raw hint into cache identity and the research request (`operatorHint ?? null`). Actual route/cache test distinguishes two unparsed hints and reuses a trimmed equivalent.
5. **U3 — no exit after terminal failures.** `app/ingest/page.tsx:948-957` computes busy from active job/drama statuses (`isDramaActive`), not retained-row count. Finished retained batches expose Clear and terminal partial/failed single enrichment can be cleared. Related stream callbacks use batch epochs/terminal guards and reset retry accounting. Source reviewed; full browser terminal-retry flow remains owed.

## Findings and dispositions — P3

- **S3/S4:** terminal state is durable; shared `reserveDramaStart` (`lib/drama/run-lease.ts:11`) covers retry, Library Start and ingest handoff. Both concurrent-start orderings and marker-write rollback are tested. No new private route-only starting set.
- **S5:** drama start and drama-media validate malformed JSON/path escapes and return 400. Five request/media regressions exercise bad inputs and Markdown MIME.
- **S6:** `lib/drama/index-subtitles.ts:42-57` hashes provider/model/task/passage role/dims/normalization and checks dense-vector mapping before inference. `:87` writes `text_embedding_variant` with vectors. Compatible strict mappings gain the keyword field; incompatible/unreadable mappings retain every cue lexically. Text embeddings do not use video proxy settings. Existing untagged vectors remain legacy; any future vector retrieval must filter compatible identity and exclude untagged vectors. Tests cover changed model identity, dimension mismatch, mapping update and inspection failure.
- **S7:** `lib/es/asset-rename.ts:128-131` checks `timed_out`, `version_conflicts` and `failures`, returning a retryable incomplete-propagation error. Guarded Painless compares expected/current title atomically, accepts already-renamed asset for same-request retry, and updates only chunk `video_title`. Same-process job title is synchronized. Live kNN fixture retained result ID, score and variant. Cross-process stale ingest-title persistence remains an existing wider concurrency boundary, not a solved claim here.
- **S8:** new artifact paths are run-relative; `lib/drama/artifact-path.ts:2-11` converts legacy absolute paths only with the exact video/run anchor and rejects traversal. DTO/media access share this helper, with existing published allowlist/realpath checks intact. A legacy `/app/data/...` script was served from the current host root with HTTP 200.
- **U4/U6/U7:** new batches clear retention/counts, all-rejected route responses preserve collected per-file errors, and key actors requires director script before submission. Route regressions cover all-rejected local/upload and validation before copy.
- **U5:** adopted the user's no-filesystem-deletion rule instead of the review's proposed unlink. `lib/ingest/sources.ts:177-182` runs `acceptProbe?.(probe)` before promoting the staged file and quarantines rejection. Local validation precedes copy. Quarantine failure preserves staging rather than deleting it. Regression verifies retained bytes and no accepted original, plus successful plain-upload parity.
- **U8:** current stored country/type/language values are appended to native-select options even when a catalog is unavailable. Forced outage browser check remains owed.
- **D2/D3:** `lib/metadata/group-availability-ui.ts:118` deduplicates by ID; `lib/metadata/exact-lookup.ts:69` matches normalized IDs and localized labels. Browser `tra`/`预告` showed matching options with no false warning; selecting the actual Chinese catalog label resolves to `trailer`. The review's illustrative `预告片` synonym is not in the actual catalog and was not fabricated.
- **D4/D5:** Markdown scripts use `text/plain; charset=utf-8` (`lib/media/serve-file.ts:40`); browser-facing retry callback uses `t.dramaRetryStarted` (`app/library/page.tsx:646`). HTTP headers also retain `nosniff`. Retry toast click-through remains owed.
- **todo/46 polling extension:** `components/DramaResultsFlyout.tsx:74-119` validates sequence tickets and accepts the new run generation; stale failed snapshots cannot terminate fresh-run polling. Pure guard tests cover stale generations/out-of-order responses and invalidation on close. Ingest callback epochs/terminal guards protect reset and retry accounting. Component-level delayed-response coverage remains open.

## Checked and rejected / limitations

- New run IDs would otherwise break the documented Mac-host ASR retry workflow; copied host SRT inputs address this, with preservation regression. No new ASR provider or paid inference was used in these checks.
- Genuine base-ingest pending work and reserved handoffs must not appear interrupted; the DTO checks and tests retain those states.
- Portable legacy paths must not authorize raw/audit/other-video artifacts. Shared path parsing, allowlist and traversal/media tests retain denial.
- Existing file/live/search suites passed; editorial title/group changes do not touch embedding vectors. The isolated live rename check additionally verified kNN score parity.
- A parallel test/build attempt hit an existing five-second key-scene test timeout. Sequential final suite passed without increasing its timeout or suppressing the failure.
- Extra `yarn exec tsc --noEmit` diagnostic was unsuccessful due to preexisting test-only typing errors; remediation test typing issues encountered in that diagnostic were corrected. The required Next production build passed. Standalone tsc is not claimed PASS.
- No Docker image rebuild performed; browser evidence comes from fresh final production build on port 3032. Port 3031 and other worktrees/voice PR were untouched.
- Temporary isolated live indices and one labeled UI fixture asset were removed after checking. All filesystem fixture/media files preserved. No real video documents were changed.
- Existing open long-video/ASR/human-quality/performance/multi-replica and Next migration work is not closed by these fixes. No whole-repository release-ready claim.

## Gates

Environment: Node 22.20.0, pinned Yarn 1.22.22. Final source tested before documentation-only dispositions.

| Gate | State / evidence |
| --- | --- |
| Full tests | **PASS** `yarn test --maxWorkers=4`: 115 files / 846 tests; `/private/tmp/jina-review-tests-final-20261004.log` |
| Production build | **PASS** `yarn build`; `/private/tmp/jina-review-build-final-20261004.log` |
| Whitespace | **PASS** `git diff --check` after documentation |
| Live ES marker/history/interruption | **PASS** isolated fixture; `/private/tmp/jina-review-live-20261004.log` |
| Live guarded rename and kNN parity | **PASS** same log; identical ID/score/variant; idempotent retry |
| Browser Group-only save | **PASS** production preview; `/private/tmp/jina-review-group-save-20261004.png` |
| Browser Group options/partial localized lookup | **PASS** scoped English/Chinese checks |
| Browser unowned run recovery controls | **PASS** labeled fixture failed badge/Enrichment options; no actual restart |
| Portable script / Markdown response | **PASS** production HTTP 200, UTF-8 text, nosniff |
| Live real-video retry/restart/failure-injection flow | **NOT RUN** |
| Browser hint provider request, terminal import clear/retry, catalog outage, retry toast | **NOT RUN** |
| Delayed-response component/stream harness | **NOT RUN** pure guard/route tests cover scoped logic |
| Docker rebuild | **NOT RUN** host production preview used |
| Representative ASR/subtitle human quality/1001-cue acceptance/p95/cost/multi-replica | **NOT RUN** existing acceptance trackers remain open |
| Standalone tsc diagnostic | **FAIL** existing test-source typing debt; production build PASS |
| Lint | **NOT RUN** unconfigured in this repository |
