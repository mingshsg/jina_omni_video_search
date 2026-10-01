# todo/45 — Drama retry and EN/ZH subtitle translation (2026-10-01)

User correction: `en` + `zh` should yield a timed original transcript plus a
translation of the missing language, rather than forcing two ASR languages on
one audio track. The failed results view must offer a visible retry action.
This corrects the earlier source-language-only rule in `plan/12`.

- [x] Add Retry enrichment inside failed/partial Drama results; preserve the
  existing job/run ID and show the asynchronous accepted state.
- [x] Probe genuine EN/ZH timed originals before ASR; retain two real sources
  when both exist, or translate only the missing language through configured
  EIS chat. Preserve cue indices and times, validate complete model output,
  and mark `translated_en` / `translated_zh` in subtitle index provenance.
- [x] Keep a successful original language indexable when translation fails;
  never publish a partial translated SRT.
- [x] Split malformed/incomplete EIS translation batches and retry each half,
  down to one cue. The first live retry returned an incomplete 12-cue batch
  starting at cue 49; English remained indexed and the job became `partial`.
- [x] Expose explicit spoken language for new EN+ZH runs, preserve it across
  job persistence and retry, and use configured ASR for that language only
  if no timed source exists. Existing failed runs can use a host transcript.
- [ ] Inspect full machine translation quality on representative bilingual
  content, including names, technical terms and timing fit.
- [x] Validate the failed-run retry through the rebuilt app and live ES:
  `succeeded`, two subtitle files, 263 EN and 263 ZH cues, `mlx_host` and
  `translated_en` provenance, 263 unique segments per language, and exact
  cue-index/time alignment. The Library row visibly shows `succeeded`.

## Gates

| Gate | State |
| --- | --- |
| Focused tests | PASS (new source-language, persistence and mapping tests; 45 tests across four files) |
| Full `yarn test --maxWorkers=4` | PASS (103 files / 772 tests, Node 25) |
| Node 22 `yarn build` | PASS in Docker build; rebuilt app serves `/library` with HTTP 200 |
| Live EIS translation | PASS for 263 English cues to 263 Chinese cues; human linguistic review remains open |
| Live retry | PASS: same job/run, `succeeded`, 2 subtitle files, 263 unique ES segments per language, original/translation provenance correct |
| Browser acceptance | PASS for Library succeeded row; retry button and flyout interaction NOT RUN after success |
