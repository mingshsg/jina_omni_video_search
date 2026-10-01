# Existing-only subtitle retry recovery review — 2026-10-01

Scope: failed run `ab78f39452ea` for the uploaded Docker Sandbox video,
the subtitle retry route and results flyout, and the repaired local runtime.

**Verdict: the reported run is recovered and the explicit retry choice is ready to commit; human subtitle quality remains unverified.**

## Findings and dispositions

### P2 — unchanged retry policy repeated a deterministic failure (fixed)

`app/api/jobs/[id]/retry/route.ts:114-116` now applies
`subtitleSource: retryPolicy?.subtitleSource ?? prev.drama.subtitleSource` and
the analogous spoken-language field. The previous bare retry retained
`existing_only` even though `lib/drama/resolve-bilingual-subtitles.ts:39`
skips host/ASR when `opts.subtitleSource !== 'existing_only'` is false.
`components/DramaResultsFlyout.tsx:99-108` now sends an explicit choice;
`lib/drama/retry-policy.ts:26-55` rejects an ASR-capable EN+ZH retry without
an EN or ZH spoken-language selection. A body-free retry remains unchanged.

### P3 — missing-source error implied ASR could run (fixed)

`lib/drama/resolve-bilingual-subtitles.ts:50-53` now says
`Existing-only skips host transcripts and ASR` and tells the operator to
select Auto plus the spoken language or supply a timed sidecar. This matches
the actual source-resolution policy. The results flyout shows the same
guidance when the missing-source error is present.

## Checked and rejected

- Media decoding was not the failure: `ffprobe` found a 707.641-second video
  with an English-tagged audio stream. No subtitle stream was present.
- Retrying the base ingest was not needed. The recovered run kept the same
  video ID, job ID, run ID and chunk variant; only enrichment was retried.
- Auto alone was not accepted for this bilingual request: the live API
  returned HTTP 400 `DRAMA_SPOKEN_LANGUAGE_REQUIRED`, leaving the run failed.

## Gates

| Gate | Result |
| --- | --- |
| Full tests | PASS: 106 files / 789 tests under Node 22 |
| Production build and runtime image | PASS: `docker compose up -d --build app` |
| Explicit live retry | PASS: HTTP 200, then `succeeded` for run `ab78f39452ea` |
| Files and timing | PASS: 121 EN + 121 ZH timed cues, identical timestamps to 11:47.120 |
| Elasticsearch | PASS: 121 unique segments per language; EN `mlx_host`, ZH `translated_en` |
| Browser and file access | PASS: results flyout shows both links; EN/ZH HTTP 200, private host SRT HTTP 404 |
| Failed-state selector interaction | NOT RUN in browser; API override and production build passed |
| Human transcription/translation quality | NOT RUN; operator review owed |
| Multi-replica retry lease | NOT RUN; pre-existing architecture gate |

Follow-up: [`todo/48`](../todo/48-existing-only-retry-recovery-2026-10-01.md).
