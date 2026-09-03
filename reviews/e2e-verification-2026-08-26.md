# Phase 10 — End-to-end verification

Date: 2026-08-26  
Scope: Tiffany trailer corpus, dual-preset ingest, same-corpus search fixtures,
click-to-play Range path, import-mode smoke.  
Runner: `scripts/phase10-e2e.ts` (artifacts under `data/uploads/phase10/`, gitignored).

## Verdict

**Phase 10 acceptance met** on the full public-domain *Breakfast at Tiffany’s*
theatrical trailer (~157.5 s). Both **standard** and **fine** variants coexist
on one `video_id` with isolated `variant_id` filters. Same-corpus top-k time-range
relevance is strong (especially fine). Search latency is well under the warm
p95 &lt; 2 s target. Click-to-play is verified at the media Range API (206).

Do **not** compare scores to Elastic’s published demo (different chunking /
candidate set).

## Corpus

| Field | Value |
| --- | --- |
| Title | Breakfast at Tiffany’s trailer (1961, PD-US) |
| Source | Wikimedia Commons OGV via `Special:FilePath` (Internet Archive search did not yield a usable trailer item; Commons download succeeded) |
| Local path | `data/uploads/phase10/tiffany-trailer.mp4` (transcoded from ~58 MB OGV) |
| Duration | **157.459 s** (full trailer; not truncated) |
| Resolution | 1270×720 H.264 + AAC |
| Substitution | **None** — full trailer used |

Fixture expected ranges were labeled from 5 s contact-sheet frames
(`data/uploads/phase10/thumbs/t001.jpg` … `t031.jpg`).

## Variants (same `video_id`)

`video_id`: `9e0f46b5-acfb-4bf3-8f3b-ee3dd03d2147`

| Preset | `variant_id` | Windows planned / done / failed | Ingest elapsed | Throughput (win/min) | Sample proxy |
| --- | --- | --- | --- | --- | --- |
| **standard** (64 s / 4 s) | `65ffb30ea687f0c3` | 3 / 3 / 0 | ~40.1 s | ~5.1 | 1270×720, CRF **30**, ladder, 920 194 B |
| **fine** (10 s / 2 s) | `81a3859fc5f48bbc` | 20 / 20 / 0 | ~65.2 s | ~19.9 | 1270×720, CRF **26**, ladder, 907 880 B |

Encoder rungs (both variants):

- Resolution ladder: `[1280, 960, 854, 720, 640]`
- CRF ladder: `[23, 26, 28, 30, 32]`

Asset document lists both presets as `ready` with `chunk_count` 3 and 20.
ES chunk counts match. Cross-variant isolation check: search with fine
`variant_id` returned **0** leaked standard chunks.

## Search fixtures (same-corpus only)

Metric: expected `[start_ms, end_ms]` overlap with top-1 / any of top-3 hits.
`k=3`, modality=`visual`, filtered to this `video_id` + `variant_id`.

| Fixture | Query (abbrev.) | Expected ms | Standard top1 / top3 | Fine top1 / top3 |
| --- | --- | --- | --- | --- |
| tiffany_window | black dress @ Tiffany window | 0–20 000 | ✓ / ✓ | ✓ / ✓ |
| orange_coat | orange coat + fur hat | 30 000–45 000 | ✓ / ✓ | ✓ / ✓ |
| kiss_rain | kissing in the rain | 100 000–115 000 | ✗ / ✓ | ✓ / ✓ |
| cat_mask | colorful cat mask | 110 000–125 000 | ✓ / ✓ | ✓ / ✓ |
| mickey_rooney_credit | “Mickey Rooney” (OCR) | 130 000–145 000 | ✓ / ✓ | ✓ / ✓ |
| **Totals** | | | **top1 4/5**, **top3 5/5** | **top1 5/5**, **top3 5/5** |

Observed search wall times: ~62–196 ms per query (EIS `query_vector_builder`).

### Interpretation

- **Fine** localizes beats tightly (e.g. kiss → `01:44–01:54`; Mickey credit →
  `02:16–02:26`; window → `00:08–00:18`).
- **Standard** has only three ~64 s windows, so top-1 can miss a late beat that
  still appears in top-3 (`kiss_rain`: top-1 was `00:00–01:04`, top-2 covered
  the rain kiss). Coarse windows inflate “easy” overlaps for early scenes.
- Scores are **not** comparable to Elastic labs scene-based numbers.

## Click-to-play / Range

| Check | Result |
| --- | --- |
| `serveFileWithRange` mid-file seek | **206**, `Content-Range: bytes 14637028-14702563/41820080`, 65 536 B |
| HTTP `GET /api/media/{video_id}` with Range (port 3460) | **206**, same range, 65 536 B |

UI automation not required; API path used by the player is confirmed.

## Import modes

| Mode | Result |
| --- | --- |
| **upload** | `importFromUploadStream` OK — tiny 3 s mp4 landed under `data/uploads/` |
| **url** | Provenance sanitize OK for Commons `Special:FilePath` URL. Full re-download skipped to stay bounded (`PHASE10_URL_IMPORT=1` to force). Primary corpus already came from that public URL via offline curl. |
| **local** | Not exercised — `LOCAL_IMPORT_ROOT` unset in `.env` |

## Gaps / residual

1. **URL ingest end-to-end** through `POST /api/ingest` + live download not
   re-run in this pass (sanitize + offline Commons fetch covered provenance;
   set `PHASE10_URL_IMPORT=1` for a full pull).
2. **Local path mode** blocked until `LOCAL_IMPORT_ROOT` is configured.
3. **UI click timing** (~1 s playhead seek) not measured in browser; Range
   latency is network/disk-bound and looks healthy for local 40 MB media.
4. Hosted **Jina** / **local** providers still unprobed (OQ2 / optional env).
5. Fixture ranges are approximate (±5 s thumbs); not PySceneDetect scenes.

## Artifacts

- `scripts/phase10-e2e.ts`
- `data/uploads/phase10/e2e-state.json`, `e2e-results.json`
- `data/uploads/phase10/ingest-standard.log`, `ingest-fine.log`, `eval.log`

## Conclusion

Phase 10 is **complete** for the Tiffany trailer with dual presets, coexistence,
same-corpus relevance, Range seek, and upload-mode smoke. Ready for Phase 11
documentation close-out.
