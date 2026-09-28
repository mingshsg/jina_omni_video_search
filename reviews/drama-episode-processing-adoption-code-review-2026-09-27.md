# Drama / episode_processing adoption code review — 2026-09-27

Scope: the current uncommitted drama-ingest implementation (`lib/drama/*`,
ingest hook, mapping, UI, plan/12) against the pinned
`vendor/episode_processing` submodule at
`142543619f2faa18e798f5ebecebdd15434532e9` (also the upstream `main`
commit checked 2026-09-27). The upstream repository is a design reference;
the chosen runtime is Node/ffmpeg rather than the Python orchestrator.

**Verdict: the integration boundary is sensible and unit/build gates pass, but drama enrichment is not acceptance-ready: several paths report success for incomplete or unverified output.**

## P1 — blocking

### R1. Partial enrichment is reported as a succeeded job

`lib/drama/runner.ts:291-301` correctly derives `enrichment_status: 'partial'`
when a selected module fails, but `lib/drama/runner.ts:345-350` then sets job
status with `dramaMeta.enrichment_status === 'failed' ? 'failed' : 'succeeded'`.
The test codifies this mismatch (`lib/drama/runner.test.ts:148-163`): one of
two selected modules fails and `job.drama.status` is expected to be
`'succeeded'`. `runDramaEnrichment` immediately returns on a succeeded drama
job (`lib/drama/runner.ts:47-48`), so a partial run cannot be retried through
that path. Represent `partial` distinctly in the API/job model, or make the
job failed while retaining completed-module detail; test UI/SSE and retry.

### R2. The “embedding cap” silently truncates the subtitle index

`lib/drama/env.ts:60-61` calls `DRAMA_SUBTITLE_EMBED_MAX` a maximum **to
embed**, yet `lib/drama/index-subtitles.ts:37-42` uses
`opts.cues.slice(0, maxEmbed)` to build **all** documents. For any SRT with
more than 400 cues at the default, every later cue is absent from both lexical
and vector search, while `lib/drama/runner.ts:147-154` marks the subtitles
module done and reports the full `resolved.cues.length`. The plan promises
timed multilingual segments in a dedicated index
(`plan/12-drama-ingest-enrichment.md:199-213`). Index all validated cues;
limit embedding separately and report indexed/embedded/omitted counts. Test a
401-cue input and a long representative episode.

### R3. Director-script output can be a short, error-filled excerpt labeled complete

The default is 120-second windows capped at eight
(`lib/drama/env.ts:72-75`). `planDirectorWindows` takes consecutive windows
from the beginning of the body (`lib/drama/directors-script.ts:123-137`), so
a 45-minute episode gets about 16 minutes of body coverage. Each failed EIS
window is caught and written as `> ERROR generating ...` into the script
(`lib/drama/directors-script.ts:341-357`); the function still returns
`windowsDone: windows.length` and the runner marks `directors_script` done
(`lib/drama/directors-script.ts:386-396`, `lib/drama/runner.ts:190-195`). A
wholly failed or truncated run can therefore become `meta.drama.synopsis_*`
and `succeeded`. Require explicit coverage and successful-window counts,
fail when no valid scenes are produced, and label sampled coverage rather
than a whole-episode script/synopsis. The upstream pipeline treats episode
scope and validation as separate facts
(`vendor/episode_processing/docs/episode_pipeline.md:3-31`).

### R4. The “groundedness audit” does not audit against evidence and cannot veto publication

`lib/drama/directors-script.ts:213-228` sends only a generated script sample
to the auditor (`"Given this directors-script sample"`), not the source
frames or timed subtitles. Any returned text, including
`VERDICT: contradicted`, becomes `status: 'ok'`; skipped/failed audits are
also returned without blocking (`lib/drama/directors-script.ts:202-234`).
`lib/drama/runner.ts:183-190` persists synopsis and marks the module done
without reading `result.audit`. This is weaker than the upstream requirement
that the auditor compare script with ASR/frames
(`vendor/episode_processing/docs/episode_pipeline.md:24-31,53-56`). Pass
actual evidence with IDs and timing, parse the verdict, and keep unsupported
output in review state instead of treating it as accepted metadata.

### R5. `key_actors` alone is offered but cannot succeed

The UI/plan says modules are independently selectable
(`plan/12-drama-ingest-enrichment.md:49-58`), and request validation does not
require `directors_script` with `key_actors`
(`lib/ingest/drama-request.ts:77-90`). The runner supplies only the script
created in **this run** (`lib/drama/runner.ts:212-218`); when directors was
not selected, `rawScript` is undefined and `generateKeyActors` throws
`"No cast roles found in directors script SLUGLINE (ZH) blocks"`
(`lib/drama/key-actors.ts:288-291`). A supported single-module selection
therefore always fails. Either resolve/reuse a reviewed script, derive role
candidates independently, or reject the combination before accepting the
ingest request with an explicit dependency message.

### R6. Local `verified` face cards do not meet the upstream face gates

The upstream requires an OpenCV face crop, role-specific time/costume gates,
nearby-frame refinement, independent verification, and lookalike audit before
publishing `status: verified`
(`vendor/episode_processing/docs/face_id_verification_pipeline.md:37-89`).
The Node path samples and scales a **whole frame**
(`lib/drama/key-actors.ts:299-329`, `lib/drama/extract-stills.ts:16-29`),
trusts model-reported frontal/eye values and one yes/no audit
(`lib/drama/key-actors.ts:351-382`), then sets `verified: true`
(`lib/drama/key-actors.ts:384-392`). It does not enforce that the proposed
role is in `roleCandidates` (`lib/drama/key-actors.ts:180-196`) and does not
implement the upstream crop, role-window, costume, refinement, or lookalike
gates. It also stores a character `role_zh`, not a resolved performer
`person_id`. Do not label/publish these as equivalent upstream-verified actor
cards until the omitted gates or a deliberately weaker review state are
implemented and checked against labeled Chinese/Korean episode frames.

### R7. Drama progress is process-local and does not survive restart

The follow-on is launched as `startDramaEnrichmentAsync(job)` without a
durable queue (`lib/ingest/pipeline.ts:486-489`); it is a fire-and-forget
promise (`lib/drama/runner.ts:368-389`). Progress uses
`updateJob(..., { persist: false })` (`lib/drama/runner.ts:32-41,353-365`).
`lib/ingest/job-store.ts:134-142` keeps jobs in a Map with a five-minute
terminal TTL, and `hydrateFromAsset` does not restore `drama`
(`lib/ingest/job-store.ts:401-462`). A restart or another replica can show
no drama state, with no resume for an interrupted run. Persist a run record
and state transitions, recover/retry idempotently, and distinguish base ingest
`ready` from follow-on drama completion in the UI.

### R8. Subtitle time and language labels can be false

When an OpenAI-compatible provider returns `text` without timed `segments`,
`lib/drama/asr.ts:83-89` emits one cue with `startMs: 0` and `endMs: 1000`
containing the
whole transcript. That cue is written to SRT and indexed as a timed subtitle
(`lib/drama/resolve-subtitles.ts:58-69`,
`lib/drama/index-subtitles.ts:52-63`). A search hit would jump to the start
of the video for dialogue that could occur anywhere. Require timed segments
or an explicit alignment stage; do not manufacture a precise timestamp for
untimed text.

The embedded-subtitle path separately takes `0:s:0` without checking its
language (`lib/drama/extract-subs.ts:27-45`). The runner tries that stream
for the first selected language and then disables embedded extraction for
later languages (`lib/drama/runner.ts:122-139`), so an English softsub stream
can be stored and indexed as `zh` simply because `zh` was selected first.
Probe stream language tags and select the matching stream; if the language is
unknown, require review or mark it unknown rather than assigning a chosen
language.

### R9. The ingest UI stops listening before drama enrichment starts

The base ingest emits `complete` and reaches `ready` before calling
`startDramaEnrichmentAsync` (`lib/ingest/pipeline.ts:455-489`). On that first
`ready` snapshot (`if (data.status === 'ready')`), the single-item UI calls
`closeStream()` and schedules a
form reset (`app/ingest/page.tsx:286-299`); batch UI closes each stream and
removes the row (`app/ingest/page.tsx:348-366`). Its `ProgressSnapshot` type
does not include `drama` (`app/ingest/page.tsx:55-69`). Consequently the
follow-on running/partial/failed events are never shown, despite the plan's
progress requirement (`plan/12-drama-ingest-enrichment.md:59-69`). Keep
watching until both base ingest and selected drama modules reach terminal
states, and show separate statuses so base `ready` does not imply enrichment
success.

## P2 — should fix

### R10. The frame cleanup call normally does nothing

The runner invokes cleanup immediately after generation
(`lib/drama/runner.ts:268-289`), but the default age gate is one hour
(`lib/drama/env.ts:94-95`) and cleanup skips fresh runs
(`if (now - stat.mtimeMs < minAge) continue`,
`lib/drama/frame-gc.ts:60-64`). No later scheduler/caller exists outside
the runner (`rg cleanupDramaFrames`). Intermediate frames therefore remain
until an operator invokes cleanup manually or another mechanism is added.
Schedule a later sweep with an explicit completed-run guard and retention
policy; test that a newly finished run is eventually cleaned.

### R11. EIS stream timeout stops after response headers

`lib/drama/eis-chat.ts:62-85` starts an abort timer, calls `fetch`, then
`clearTimeout(timer)` immediately after headers. The subsequent
`reader.read()` loop (`lib/drama/eis-chat.ts:103-130`) has no deadline, so a
server that stalls mid-stream can hold an enrichment indefinitely. Keep the
abort controller active through the entire stream and cancel it in `finally`.

### R12. Key scenes can succeed with no scene stills or summaries

Without a director script, `parseSceneCandidates` creates uniform windows
with no `summaryZh`/`summaryEn` (`lib/drama/key-scenes.ts:135-149`). Still
extraction failures are silently skipped (`/* skip still failure */`), and an empty `scenes` array is
returned (`lib/drama/key-scenes.ts:184-218`); the runner then marks the
module done (`lib/drama/runner.ts:244-259`). Define whether still-only
fallback is a valid product result and fail or mark partial when no scene
artifact survives. Do not present uniform windows as selected “key” scenes.

## Checked and rejected

- The submodule is pinned and clean; its `origin` is the linked GitHub repo,
  and the pinned SHA matched upstream `main` during this review. A Node
  implementation is an explicit plan decision, not an accidental missing
  Python dependency (`plan/12-drama-ingest-enrichment.md:99-121`).
- `persistDramaMeta` uses a partial Elasticsearch `_update`
  (`lib/drama/persist-meta.ts:41-68`), so this path does not replace unrelated
  editorial metadata or re-embed video chunks. The main pipeline calls it
  only after base ingest becomes `ready` (`lib/ingest/pipeline.ts:455-489`).
- The upstream five-content-requirements document is explicitly a future
  design specification (`vendor/episode_processing/docs/content_requirements_implementation.md:1-5`).
  Clips/briefs/theme discovery are outside this adoption phase, not missing
  implemented dependencies.
- Existing unit tests cover parsing and mocked runner branches, but the
  mocked runner test explicitly accepts R1, and there is no current-tree
  representative episode/ES/EIS acceptance evidence.

Follow-up: [`todo/36-drama-adoption-review-2026-09-27.md`](../todo/36-drama-adoption-review-2026-09-27.md).

## Gates

| Gate | Result |
| --- | --- |
| `yarn test` | PASS — 74 files / 502 tests |
| `yarn build` | PASS — production build and typecheck |
| Upstream submodule pin vs GitHub `main` | PASS — `142543619f2faa18e798f5ebecebdd15434532e9` |
| Live `yarn setup-indices` / mapping acceptance | NOT RUN |
| One local Chinese/Korean episode through upload → drama → ES → UI | NOT RUN |
| EIS director/audit and ASR provider integration | NOT RUN |
| Labeled face identity, scene relevance, and groundedness | NOT RUN |
| Restart/multi-replica recovery and retry | NOT RUN |
| Representative duration, cost, p95, and Docker rebuild | NOT RUN |
