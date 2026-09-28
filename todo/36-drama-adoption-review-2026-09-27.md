# todo/36 — Drama adoption code review (2026-09-27)

Source: [`reviews/drama-episode-processing-adoption-code-review-2026-09-27.md`](../reviews/drama-episode-processing-adoption-code-review-2026-09-27.md).

The Node adoption is intentional; this tracker closes gaps between its
current behavior, the plan's claims, and the upstream episode/face gates.

## P1 — close before calling drama enrichment accepted

- [x] **R1** — represent partial module completion honestly in job status,
      SSE/UI, and retry; the current test expects a partial run to be
      `succeeded`. Ensure a failed module remains retryable.
      **Fixed 2026-09-28.** `DramaEnrichmentStatus` gains `partial`
      (`lib/ingest/drama-options.ts`); the runner persists it to
      `job.drama.status` instead of collapsing to `succeeded`
      (`lib/drama/runner.ts`); only `succeeded` short-circuits reruns, so
      partial/failed stay retryable. Test updated + partial-retry test.
- [x] **R2** — index every validated subtitle cue; apply
      `DRAMA_SUBTITLE_EMBED_MAX` only to vector inference, report coverage,
      and test >400 cues.
      **Fixed 2026-09-28.** `indexDramaSubtitles` loops all cues, embeds
      only the first 400 (`lib/drama/index-subtitles.ts`); the runner
      reports `indexed/embedded` from the return value. New
      `index-subtitles.test.ts` covers 401 cues (401 indexed, 400
      embedded, tail doc lexical-only).
- [x] **R3** — record director-script coverage and successful windows;
      reject all-error output, never describe the default first ~16 minutes
      as a whole-episode script/synopsis, and test a long episode.
      **Fixed 2026-09-28.** Failed windows stay on disk only (excluded
      from body/synopsis); zero successes throws
      (`lib/drama/directors-script.ts`). Result carries
      `windowsPlanned/coverageStartSec/coverageEndSec/coverageSec`;
      `windowsDone` is now successes; covers read "(sampled … of …)".
      New `directors-script-coverage.test.ts` (45-min → 8 windows/960s,
      all-error throws).
- [ ] **R4** — audit generated claims against timed ASR/frame evidence,
      parse supported/insufficient/contradicted, and prevent failed/skipped/
      contradicted audit from becoming accepted synopsis metadata.
      **Fixed 2026-09-28 (scoped).** The auditor now receives timed cue
      evidence + window ranges; `parseAuditVerdict` parses the verdict and
      `insufficient`/`contradicted` veto publication (throw, script stays
      on disk). `skipped` (audit id unset, the default) and call-error
      `failed` are recorded but do not veto — deliberate, else default
      config could never succeed. New `directors-script-audit.test.ts`.
      **Superseded 2026-09-28 by `todo/37` F2:** skipped/failed-call/
      unparseable now persist the synopsis as `provisional`
      (`synopsis_status`), and the auditor also receives sampled stills.
      **Reopened 2026-09-28:** this scoped behavior still violates the
      plan's acceptance gate; see `todo/37` F2. The audit also lacks frame
      evidence for visual claims.
- [x] **R5** — honor independent `key_actors` selection by resolving
      reviewed role evidence, or reject missing `directors_script` dependency
      before ingest acceptance with a clear response.
      **Fixed 2026-09-28 via rejection.** `resolveDramaOptions` throws new
      `INGEST_DRAMA_NEEDS_DIRECTORS` (400, EN/ZH messages) when
      `key_actors` is selected without `directors_script`; wired into
      `app/api/ingest/route.ts` status map. Reuse-a-reviewed-script stays
      future work (needs R7 durability, now landed for terminal states).
- [x] **R6** — implement/validate upstream-equivalent face crop, role-window,
      costume, refinement, and lookalike gates before publishing
      `verified: true`; enforce role whitelist and distinguish characters
      from performer `person_id`. Otherwise use a weaker review state.
      **Fixed 2026-09-28 via the weaker-review-state path.** Cards commit
      with `verified: false` (character-name candidates, `person_id`
      never set); `proposeFace` enforces the script-candidate whitelist.
      Full OpenCV/upstream gates remain future work — nothing may set
      `verified: true` until they land. Extended `key-actors.test.ts`.
- [ ] **R7** — persist drama job/run state, recover or retry interrupted
      work idempotently, and keep progress visible after process restart or
      from another replica.
      **Fixed 2026-09-28 (single-replica).** Runner persists a best-effort
      `running` marker at start; `hydrateFromAsset` restores `drama` from
      durable `meta.drama` (`running` → retryable `pending`); retry on a
      `ready` job resumes drama-only, base retry carries unfinished drama.
      New `job-store-drama.test.ts`. Live multi-replica progress (shared
      polling) remains future work.
      **Reopened 2026-09-28:** the ready-to-running marker handoff can lose a
      requested run on crash, and retry lacks ownership/idempotency; see
      `todo/37` F1/F3. The single-replica hydration test still passes.
- [x] **R8** — refuse untimed ASR text or align it before writing timed SRT
      and subtitle-index segments; select embedded subtitle streams by
      verified language rather than assigning the first stream to the first
      requested language. Test text-only ASR and multiple softsub languages.
      **Fixed 2026-09-28 via refusal (no alignment stage).** Untimed ASR
      text throws instead of fabricating a 0–1000ms cue; embedded
      extraction is tag-matched per language (`0:s:<n>`), never `0:s:0`
      by position — untagged/mismatched streams fall through to ASR/error.
      Removed the deleted-by-position helper; runner probes per language.
      New `asr.test.ts` + `extract-subs.test.ts`.
- [ ] **R9** — keep ingest UI/SSE subscribed after base `ready` while drama is
      running; display distinct enrichment running/partial/failed/succeeded
      status and keep batch rows until drama is terminal.
      **Fixed 2026-09-28.** `ProgressSnapshot` carries `drama`; both
      single and batch handlers stay subscribed while drama is
      pending/running; single panel shows a drama status line + error and
      defers the success callout; batch rows show drama status. New
      `dramaStatusLabel` EN/ZH. No component tests exist repo-wide
      (vitest covers `lib/**`/`worker/**` only) — verified via `yarn
      build` typecheck.
      **Reopened 2026-09-28:** terminal partial/failed drama still receives
      a green success callout and 2.5-second reset; see `todo/37` F4.

## P2

- [x] **R10** — schedule frame cleanup after the age gate; current immediate
      invocation skips fresh runs and no later caller exists.
      **Closed 2026-09-28 by `todo/37` F7:** own terminal run bypasses the
      guard (`ignoreAgeGuard`, lease-held) + a guarded orphan sweep runs
      at every terminal enrichment.
- [x] **R11** — retain the EIS abort timer through streamed body reading and
      cover mid-stream stalls.
      **Closed 2026-09-28 by `todo/37` F7:** every `reader.read()` races
      the remaining deadline with `reader.cancel()` on timeout; timer
      cleared in `finally`. Stalled-stream test added.
- [x] **R12** — define valid key-scene fallback and mark empty/still-only
      output appropriately; do not report an empty set as selected key scenes.
      **Closed 2026-09-28 by `todo/37` F6:** empty scenes throw; fallback
      qualified via `selection` in result + `key_scenes.json` + progress.

## Acceptance gates still owed

- [x] `yarn test` (80 files / 526 pass) and `yarn build` (incl. typecheck)
      pass on 2026-09-28 after R1–R9. Verified with a repaired Homebrew
      Node (restored `libllhttp.9.3.dylib` alongside 9.4.3; recommend
      `brew reinstall node` to heal properly) + yarn 1.22.22 via corepack.
      **Update:** 82 files / 546 pass after `todo/37` F1–F7 (same day).
- [ ] Run index setup and verify live schema and subtitle bulk request shape.
- [ ] Run at least one representative Chinese/Korean episode end to end,
      checking timing, script coverage, EIS audit, faces, scenes, metadata,
      editor display, and recovery after restart.
- [ ] Measure p95 and inference cost; rebuild the container before browser
      acceptance against current code.
