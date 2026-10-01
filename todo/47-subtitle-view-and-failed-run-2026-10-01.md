# todo/47 — View subtitles and recover a failed EN/ZH run (2026-10-01)

User report: the results flyout for run `2520b2ba6429` still shows `failed`,
and asks how to view the subtitle text.

- [x] Identify the run and root cause: video `69eac188-e543-4eaf-9766-87d35520989f`
  had no timed English/Chinese source, no host transcript, and no
  `source_language` in its original EN+ZH request. Retry preserves that
  request, so another click alone repeats the failure.
- [x] Confirm spoken language from a 30-second audio sample: MLX Whisper
  detected English and produced English dialogue.
- [x] Transcribe the full extracted English audio on the Mac host; preserve
  the 143-cue `host_en.srt` in the shared run workspace.
- [x] Retry enrichment using the same job and run ID, without re-embedding.
- [x] Verify terminal status, two final SRT files, ES subtitle counts,
  language/provenance, and cue alignment.
- [x] Expose only the published final SRT files as safe browser-viewable links
  in Enrichment results; keep host source, audio, metadata, and unpublished
  artifacts private.
- [x] Run full tests, Node 22 build, rebuild the app after the active run
  finishes, and verify both links with the running app.

## Gates

| Gate | State |
| --- | --- |
| Full host tests | PASS: 105 files / 783 tests |
| Node 22 build | PASS: `docker compose up -d --build app` |
| Live run | PASS: same job/run `succeeded`, two final SRT files |
| Cue/index parity | PASS: 143 EN + 143 ZH, aligned timestamps, 143 unique ES segments each |
| Provenance | PASS: EN `mlx_host`, ZH `translated_en` |
| Browser | PASS: Enrichment results shows EN/ZH links; both return HTTP 200 `text/plain`; host source returns 404 |
| Human translation quality | NOT RUN |

## Follow-up

- [ ] For legacy EN+ZH requests lacking `source_language`, make retry
  guidance actionable before another click. The current retry route cannot
  change the original request, and container ASR is not configured here.
- [ ] Human-check the translated Chinese text and timing before calling
  the subtitle output quality accepted.
