# Subtitle viewing and failed-run diagnostic — 2026-10-01

Scope: screenshot run `2520b2ba6429`, video `69eac188-e543-4eaf-9766-87d35520989f`, the EN+ZH resolver, retry route, subtitle publication boundary, and results flyout.

**Verdict: the reported run is recovered and its subtitle files are valid and indexed; browser viewing was missing and is fixed in this change. Legacy retry guidance and human translation quality remain open.**

## P2 — reported failure, recovered

1. **The failed video had no timed original and no spoken-language policy.** `lib/drama/resolve-bilingual-subtitles.ts:38-51` only enters configured ASR after failed timed-source probes when `opts.sourceLanguage` is present. The screenshot's run had no source-language field, and its shared run workspace contained `audio/asr_en.mp3` and `audio/asr_zh.mp3` but no SRT. `app/api/jobs/[id]/retry/route.ts:77-85` preserves `sourceLanguage: prev.drama.sourceLanguage`; another button click alone could only repeat the failure. A 30-second MLX sample detected English. Host MLX generated 143 English timed cues as `host_en.srt`; retrying the same job/run succeeded with 143 EN and 143 ZH cues. The final SRT time spans match cue by cue. Elasticsearch has 143 unique segments per language with `mlx_host` and `translated_en` sources.

2. **The results flyout could not show subtitle text.** It displayed only `subtitle_count` at `components/DramaResultsFlyout.tsx:294-305`; `lib/drama/media-access.ts` previously excluded every SRT from the published-artifact allowlist. The update exposes links for final, indexed `subtitles/<lang>.srt` paths through the existing media route. It still rejects the host source SRT, audio, metadata, frames and unpublished paths. `lib/drama/safe-dto.ts:141-151` emits route URLs without filesystem paths, and the media response uses plain text with `nosniff`.

## P2 — open

- **Legacy retry still needs actionable spoken-language/host-ASR guidance.** The route preserves the original request and cannot add `source_language`. For a second old run without a timed source, manual host transcription or a new request with the correct spoken language is required. Track the UI/request decision in `todo/47`.
- **Accepted retry can briefly display the old failed asset state.** The previously recorded polling race in `todo/46` remains. A manual Refresh or closing and reopening results reads the durable status; this review does not claim the UI race is fixed.

## Checked and rejected

- **Translation was not the cause of the reported failure:** no original transcript existed, so `translateSubtitleCues` was never reached before recovery. The recovered run translated the English source and produced aligned Chinese output; linguistic quality needs human review.
- **Host transcript is not published:** the media allowlist accepts only recorded final files named `subtitles/en.srt`, `zh.srt`, `ko.srt`, or `th.srt` that match the run's languages. A listed `host_en.srt` remains denied by the allowlist test.
- **No chunk re-embedding:** the retry branch for a ready ingest job calls `startDramaEnrichmentAsync(prev)` at `app/api/jobs/[id]/retry/route.ts:89` and keeps the job/run IDs.

## Gates

| Gate | Result | Evidence / remaining work |
| --- | --- | --- |
| Host ASR for this video's English speech | PASS | 143 timed cues; 30-second sample detected English. |
| Retry and final files | PASS | Same job/run succeeded; two final SRTs, 143 cues each, timestamps aligned. |
| Elasticsearch subtitle index | PASS | EN 143 unique `mlx_host`; ZH 143 unique `translated_en`. |
| Full test suite | PASS | Host Node 25: 105 files / 783 tests. |
| Node 22 build and rebuilt app subtitle links | PASS | `docker compose up -d --build app`; browser results flyout visibly shows EN/ZH links; each URL returned HTTP 200 `text/plain; charset=utf-8`; unpublished host source returned 404. |
| Human Chinese translation quality | NOT RUN | Review names, terminology, segmentation and timing fit. |
| Retry polling race and legacy-language UX | NOT RUN | Tracked in `todo/46` and `todo/47`. |

Follow-up: [`todo/47-subtitle-view-and-failed-run-2026-10-01.md`](../todo/47-subtitle-view-and-failed-run-2026-10-01.md).
