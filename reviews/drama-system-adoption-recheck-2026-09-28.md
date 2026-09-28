# Drama system adoption recheck — 2026-09-28

Scope: recheck `todo/36` R1–R12 against the current working tree, including ingest, retry, SSE/UI, Elasticsearch writes, and new tests. The worktree is uncommitted on `live-video-search` at `db23b88`; this is a source review, not a deployed-system acceptance test.

**Verdict: materially improved, but not acceptance-ready.** The 526 tests and production build pass. Several fixes are sound, but retry is not idempotent, the default audit does not gate publication, durable handoff has a crash gap, and the UI still presents failed enrichment as success.

## P1 — blocking

### F1 — Retry duplicates subtitle documents and can overlap an active run

`app/api/jobs/[id]/retry/route.ts:51-65` retries any ready drama state other than `succeeded`/`skipped`, including `running`, with no lock or compare-and-set: `startDramaEnrichmentAsync(prev)`. Each run allocates a new ID at `lib/drama/workspace.ts:18-22` (`randomUUID()`), while `lib/drama/index-subtitles.ts:73-79` indexes `_id = videoId_runId_segId`. Therefore a partial retry writes another full set of subtitle documents rather than replacing the old set, and two retry requests may race to replace `meta.drama` and the shared `job.drama` state. The route comment at line 50, “Module writes are idempotent,” is false for the subtitle index. Test only same-run bulk counts (`lib/drama/index-subtitles.test.ts:41-61`); it never retries with a new run ID.

Use an atomic per-video run lease or equivalent guard, define one active subtitle generation per video, and retire/switch old generations safely. Cover sequential retry and concurrent requests with assertions on document visibility and final status.

### F2 — Audit can be skipped or fail while generated synopsis is published as successful

`lib/drama/directors-script.ts:227-235` returns `status: 'skipped'` when the audit ID is unset; `:289-293` returns `status: 'failed'` on transport errors. `:465-470` only vetoes `failed` **with a parsed verdict**. A default run or an auditor outage therefore returns `synopsisZh/En` at `:473-487`, and `lib/drama/runner.ts:197-205,305-339` can mark `directors_script` done and the whole enrichment `succeeded`. This conflicts with `plan/12-drama-ingest-enrichment.md:126-128` (“an audit that is skipped/failed/contradicted must not become a successful … synopsis”). The audit prompt at `directors-script.ts:249-267` also supplies subtitles and window ranges, but no sampled images, so it cannot independently verify visual/action claims. The tests cover negative parsed verdicts, not skipped/unparseable/transport failures (`lib/drama/directors-script-audit.test.ts:84-145`).

Either require a successful configured audit before publishing accepted synopsis metadata or persist an explicit provisional/review-needed state and withhold it from accepted search/editor fields. If visual claims remain, supply visual evidence or limit the audit claim to dialogue/timing.

### F3 — Requested drama work is not durably handed off at the base `ready` transition

`lib/ingest/pipeline.ts:453-489` emits/persists base `ready` and then starts drama. `lib/ingest/job-store.ts:322-325` persists the base asset, while `:421-440` can hydrate drama only from `meta.drama`. The first drama marker is written later by `lib/drama/runner.ts:77-90`, and its failure is silently ignored. A process exit between ready persistence and that marker leaves a ready asset with no recoverable drama request; `resolveIngestJob` then returns no `drama` state. The `running → pending` hydration test (`lib/ingest/job-store-drama.test.ts:76-89`) starts with a marker already present and does not cover this handoff gap. Multi-replica progress is also still memory-local.

Persist the requested drama state with the ready transition (or before it), make marker failure visible/retryable, and verify restart at each handoff point. Keep the multi-replica claim explicitly open until shared run ownership/progress exists.

### F4 — Failed or partial drama still gets a green success callout and disappears

`app/ingest/page.tsx:302-314` closes the stream and schedules a form reset for every base `ready` state once drama is no longer `pending/running`; `:1105-1108` renders the green `ingestSuccess` callout under the same condition. That includes `drama.status === 'partial'` or `'failed'`, despite the new error line at `:1086-1089`. After 2.5 seconds, the job status is cleared. In batch mode, `:372-384` counts these rows as successful and removes them. This undoes the user-facing intent of R1/R9. Keep base-ingest success distinct from enrichment outcome, persist a visible partial/failed result and retry action, and count batch outcomes accordingly.

## P2 — should fix

### F5 — Director coverage describes planned span, including failed windows

`lib/drama/directors-script.ts:413-421` excludes failed window text, which is a real improvement. But `:440-445` calculates `coverageSec` from the first and last *planned* windows, and the cover says “sampled …” even if only one of eight windows succeeded. `:425-429` only rejects zero successes; `:452-455` still summarizes one successful slice. Track successful ranges/seconds separately, mark gaps, and make publication policy explicit when most windows fail.

### F6 — Empty actor/scene outputs can still count as completed modules

`lib/drama/key-actors.ts:430-436` returns `actors: []` after all proposals fail, and `lib/drama/key-scenes.ts:216-218` returns `scenes: []` after all stills fail. `lib/drama/runner.ts:237-241,268-272` nevertheless pushes both modules into `modules_done`; with no caught error, `:305-315` reports `succeeded`. An empty result should be `empty`/review-needed or a module failure, not accepted key content. For scenes, the uniform still-only fallback at `key-scenes.ts:135-148` also lacks a selection quality claim.

### F7 — Existing cleanup and stream timeout gaps remain

`lib/drama/runner.ts:282-295` invokes frame cleanup once immediately, but `lib/drama/frame-gc.ts:60-64` skips fresh runs under the default 1-hour age guard; no later sweep is scheduled (prior R10). `lib/drama/eis-chat.ts:62-85` clears the abort timer before `reader.read()` at `:103-105`, so a stalled body can hang indefinitely (prior R11). R12's empty/still-only scene case is covered by F6. These remain open in `todo/36`.

## Rechecked fixes and rejected concerns

- **R1:** `partial` is now represented in job state and terminal metadata (`lib/drama/runner.ts:305-378`). The internal status fix holds; F4 is a separate presentation defect.
- **R2:** all cues are indexed and only the first configured maximum are embedded (`lib/drama/index-subtitles.ts:37-94`); the 401-cue test passes. F1 concerns the identity/lifecycle of retries, not this cap.
- **R3:** all-error director output now throws and failed text is excluded (`lib/drama/directors-script.ts:413-429`). F5 remains for mixed success.
- **R5:** `key_actors` without `directors_script` is rejected at request validation (`lib/ingest/drama-request.ts:89-94`); this avoids the known guaranteed failure.
- **R6:** published actor cards have `verified: false`, no `person_id`, and candidate role names are whitelisted (`lib/drama/key-actors.ts:199-204,404-414`). This is correctly a review-state result, not an upstream-equivalent verification claim.
- **R8:** untimed ASR text throws (`lib/drama/asr.ts:83-90`), and embedded subtitle selection uses a matching stream language tag (`lib/drama/extract-subs.ts:67-120`). The previous invented timestamps and positional language assignment are gone.
- **R9:** the client now listens through pending/running enrichment (`app/ingest/page.tsx:298-339,364-409`). The server closes after base `complete` (`app/api/jobs/[id]/stream/route.ts:51-66`), so EventSource must reconnect; single-process eventual status should work, but browser/container and cross-replica behavior were not exercised. F4 is still actionable.

## Gates

| Gate | Result | Evidence / limit |
| --- | --- | --- |
| `yarn test` | PASS | 80 files, 526 tests, 2026-09-28 |
| `yarn build` | PASS | Next.js 14.2.35 compile, typecheck and route build, 2026-09-28 |
| Live index setup / mapping / subtitle bulk | NOT RUN | No cluster mutation in this source review |
| Real Chinese/Korean episode E2E and human evidence audit | NOT RUN | Required to assess subtitle timing, visual claims, faces and scenes |
| Repeated/concurrent retry with actual ES | NOT RUN | F1 demonstrated by document-ID construction; live behavior still needs proof |
| Browser and rebuilt container SSE flow | NOT RUN | Build alone does not show running image or UI behavior |
| p95 latency, token/inference cost, multi-replica recovery | NOT RUN | No representative measurements or shared-state test |

Follow-up: [`todo/37-drama-system-adoption-recheck-2026-09-28.md`](../todo/37-drama-system-adoption-recheck-2026-09-28.md).
