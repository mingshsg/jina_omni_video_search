# Enrichment and hybrid post-push code review — 2026-10-01

Scope: `codex/drama-enrichment-complete` after `3dcc9c2`, the subtitle retry/EN+ZH implementation, and this review's small repairs. Read the affected search, eligibility, subtitle, retry, and user-facing copy paths. The two pre-existing untracked ` (1).md` copies were left untouched.

**Verdict: the isolated naming and hybrid boundary fixes are commit-ready after tests/build; the enrichment feature still needs the retry UI race, long subtitle handling, and human quality acceptance before a release claim.**

## P1 — fixed before commit

1. **Concurrent embedding could reject without a handler while asset eligibility was still being enumerated.** At `lib/es/hybrid-search.ts:763-796`, `vectorPromise = embedQueryVector(config, residualText)` starts before `await enumerateEligibleAssetIds(...)`. The prior handler was attached only inside the empty-eligibility branch; a fast embedding rejection followed by slow or failed enumeration could therefore become an unhandled rejection. The fix attaches `void vectorPromise?.catch(() => null)` immediately at `:790` while preserving the original promise for the later awaited error path. `lib/es/hybrid-search-concurrent-errors.test.ts` forces embedding to fail first and enumeration second.

## P2 — fixed before commit

1. **Eligibility enumeration ignored the caller's injected configuration.** `searchChunksHybrid` accepts a `config` argument, but `lib/metadata/search-filters.ts:370` previously called `getConfig()` unconditionally. A caller with a separate asset index would embed against one environment and enumerate IDs from another. The enumerator now accepts `cfg?: AppConfig`, the hybrid caller passes `cfg: config` at `lib/es/hybrid-search.ts:796`, and `lib/metadata/search-filters-injected-config.test.ts` verifies the selected index without reading ambient config.

## P2 — open

1. **Accepted retry can revert to a stale failure and stop polling.** `components/DramaResultsFlyout.tsx:85-104` sets `status: 'pending'` on a 202 response, but the immediately running `load()` can read the last persisted failed asset status. The polling effect installs its interval only for `pending` or `running`; after that stale response, it has no timer. Keep the accepted transition sticky until a new run marker or terminal result is observed, and test a delayed persisted update. This is a UI race, not evidence that the server retry itself fails.

2. **The bilingual translation limit is lower than the accepted video duration.** `lib/drama/translate-subtitles.ts:7-25` sets `MAX_CUES = 1000` and rejects a longer timed transcript before processing, although enrichment accepts videos up to the configured 210-minute default (`lib/drama/env.ts:8-9`). A longer episode can therefore yield original subtitles but no requested translation. Design bounded chunk persistence and progress/cost reporting, or reject this combination at admission with a clear limit; test at 1000 and 1001 cues.

## P3 — fixed before commit

- User-visible labels, API messages, and progress text now say **Enrichment** or **增强** rather than “Drama enrichment” / “按剧增强” (for example `lib/i18n/ui.ts:612-662` and `lib/drama/runner.ts:171`). Internal route names, DTO keys, and error codes remain stable. The existing timed subtitle option explicitly says translation is allowed and ASR is not run.

## Checked and rejected

- **EN+ZH is not two independent ASR passes:** `lib/drama/resolve-bilingual-subtitles.ts:24-64` probes timed originals, then transcribes one spoken language if needed and translates the missing output. Prior live retry of run `e98614f317df` had 263 aligned EN and ZH cues, with `mlx_host` and `translated_en` provenance. This proves the data path for that video, not translation quality for other content.
- **No metadata edit or vector identity change:** these repairs do not alter chunk vectors, `variant_id`, or editorial metadata writes. The hybrid correction selects the same injected asset index used by the rest of its caller.
- **No secret material staged:** the reviewed diff contains source, tests, and documentation only. Ignored `.env` stays local.

## Gates

| Gate | Result | Evidence / remaining work |
| --- | --- | --- |
| Full `yarn test --maxWorkers=4` | PASS | Host Node 25: 105 files, 782 tests. |
| Node 22 production build / container rebuild | PASS | `docker compose up -d --build app` completed against final source; replacement container running and `/library` returned HTTP 200. |
| Whitespace check | PASS | `git diff --check` and staged diff check returned 0. |
| Live subtitle retry and EIS translation for one existing video | PASS (prior run) | Run `e98614f317df`: succeeded, 263 EN and 263 ZH cues aligned, two subtitle files. This review did not repeat it. |
| Browser failed-state retry race | NOT RUN | Simulate a stale asset status after 202; see open P2. |
| 1001+ cue translation | NOT RUN | Currently rejected by code; see open P2. |
| New upload EN+ZH spoken-language flow | NOT RUN | Needs a representative upload after final fixes. |
| Human subtitle quality review | NOT RUN | Check names, technical terms, segmentation, and timing fit on actual content. |
| Hybrid live Elasticsearch and representative p95/relevance | NOT RUN | Unit tests are not a server/protocol or latency acceptance gate. |

Follow-up: [`todo/46-enrichment-and-hybrid-post-push-2026-10-01.md`](../todo/46-enrichment-and-hybrid-post-push-2026-10-01.md).
