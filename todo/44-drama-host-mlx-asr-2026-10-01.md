# todo/44 — Host MLX Whisper for drama subtitles (2026-10-01)

Goal: use the Mac's MLX Whisper installation with the existing container demo,
without a cloud ASR key or a long-running host service.

- [x] Add a minimal host command that converts one extracted audio file into
  language-specific, timed SRT and preserves any existing transcript.
- [x] Have `auto` and `force_asr` drama retries consume an explicitly supplied
  `host_<lang>.srt`; keep `existing_only` semantics and other ASR routes.
- [x] Document host command, shared path, language selection and retry flow.
- [x] Run a full host MLX transcription on the current video. It produced 263
  English timed cues from 0 to 1003.24 seconds; the project SRT parser found
  no invalid or backwards times. The opening and ending text are coherent
  English; human review of the full transcript remains open.
- [x] Rebuild the app container with Node 22, confirm the host SRT is mounted,
  `mlx_host` appears in the built server chunk, and `/library` returns HTTP 200.
- [ ] Retry with a language-correct request; confirm live Elasticsearch
  subtitle indexing, `mlx_host` provenance, and browser status. The current
  run selected `en` and `zh` for English speech, so a full retry would still
  lack valid Chinese cues.
- [x] Review the current run's `en`/`zh` request against transcript evidence.
  The recorded audio yielded coherent English technical narration, while the
  original request selected both `en` and `zh`. Do not force a Chinese SRT from
  English speech. Retry retains both selections, so this run cannot reach a
  complete two-language subtitle result with the current options.

## Gates

| Gate | State |
| --- | --- |
| Host script syntax and SRT formatting | PASS (AST parse, help, formatter sample) |
| `yarn test --maxWorkers=4` | PASS (101 files / 761 tests, Node 25) |
| `yarn build` | PASS on host Node 25 and container Node 22 |
| Full MLX transcription | PASS (263 cues); full human quality review NOT RUN |
| Container rebuild and `/library` HTTP | PASS; new container running, SRT visible, HTTP 200 |
| Browser/Elasticsearch subtitle retry | NOT RUN (current request includes the wrong spoken language) |
