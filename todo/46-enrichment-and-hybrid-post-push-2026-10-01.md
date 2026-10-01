# todo/46 — Enrichment and hybrid post-push follow-up (2026-10-01)

Source review: [`reviews/enrichment-and-hybrid-post-push-code-review-2026-10-01.md`](../reviews/enrichment-and-hybrid-post-push-code-review-2026-10-01.md).

## Ready in this review

- [x] Handle a speculative hybrid embedding rejection while eligibility enumeration is in flight; keep the original embedding error observable if it is ultimately needed.
- [x] Pass the hybrid caller's `AppConfig` to eligible asset enumeration and test an alternate asset index.
- [x] Use Enrichment / 增强 in user-facing labels, messages, and progress while retaining stable internal API identifiers.
- [x] Run full tests: 105 files / 782 tests on host Node 25.
- [x] Run Node 22 production build against the final source, confirm rebuilt app serves `/library` with HTTP 200, and check whitespace.

## Next update

- [ ] **P2 — retry UI race:** retain polling after a retry 202 despite a stale persisted failed status. Add a component-level test for delayed asset update and out-of-order responses.
- [ ] **P2 — long bilingual subtitles:** decide and implement a bounded continuation for more than 1000 cues, including durable progress and cost bounds, or reject that request before processing with a clear user-facing limit. Test 1000/1001 cues.
- [ ] Verify failed/partial **Enrichment results** retry and polling in the rebuilt browser, including an immediate refresh after accepting retry.
- [ ] Verify a new upload with EN+ZH selected and the actual spoken language; confirm one original transcript, one translation, aligned cues, and correct provenance.
- [ ] Human review of EN+ZH subtitle meaning, names, terminology, line breaks, and timing fit on representative video; record pass/fail separately from automated success.
- [ ] Run hybrid asset eligibility against live Elasticsearch, then representative search relevance and p95/cost checks before a release claim.

## Gates at review time

| Gate | State |
| --- | --- |
| Full host tests | PASS: 105 files / 782 tests |
| Node 22 build / final rebuilt app | PASS: `docker compose up -d --build app`; replacement running, `/library` HTTP 200 |
| Whitespace | PASS: `git diff --check` and staged diff check |
| One existing-video live retry | PASS from `todo/45`; not repeated here |
| Browser retry race, 1001+ cues, new upload, human translation quality, hybrid live/p95 | NOT RUN |
