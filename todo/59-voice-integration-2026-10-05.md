# Integrate voice search with current app — 2026-10-05

User explicitly requested integration after the tab was missing. Branch `codex/voice-search-integration` starts at the verified two-repository update `66acc7c` and integrates `codex/voice-search` (`e35ba93`).

- [x] Resolve conflicts while preserving enrichment, Group auto-Variant, scene linking and header logos.
- [x] Keep separate Voice search tab; Sound Sample default; Spoken Request transcribes to editable ordinary text search. Use existing Audio/Visual/All selector, no duplicate Match against control.
- [x] Reconcile current 5s/custom Variant validation and scoped Group filters; no vector mixing or query ingest.
- [x] Verify configured sound/transcription services and enable only verified capabilities in ignored .env.
- [x] Run full tests/build, review, and rebuild/restart app container.
- [x] Browser tab/mode/Group flow and API recorded fixture checks; preserve existing media.

Prior draft PR #2 remains unmerged. Human relevance, real microphone/cross-browser, p95/cost, hosted ASR retention and multi-replica acceptance remain open.

## Evidence

- Full suite: **PASS**, 127 files / 942 tests, including Python process/HTTP tests with localhost sockets enabled. First sandbox-only attempt correctly failed on socket binding; rerun passed.
- Host production build: **PASS**, Node 22 / Yarn 1.22.22, including type checks.
- Elastic audio query transport: **PASS**, 1024 dimensions; fingerprint verified before enabling ignored `.env`.
- Container → local ASR helper: **PASS**, auto/en/zh, nonempty transcripts. Empty historical WAV files were rejected; valid `voice-test-en.wav` / `voice-test-zh.wav` fixtures passed. Endpoint-specific fingerprint saved only after success.
- Docker rebuild/restart: **PASS**, running container `e0a050797299`, image `775b0a8c9fcf…`, created 2026-10-05 08:50:54 UTC.
- App API: **PASS**, six Group-isolated sound cases (training/5s + drama/2s × Audio/Visual/All), omitted-mode default, auto/en/zh transcription, typed/spoken ID equivalence, empty WAV rejection. Counts remained 38 assets / 9,137 chunks; all asset and 20 sampled full chunk snapshots unchanged.
- Browser: **PASS**, tab/default/sample upload + preview/results, drama auto-Variant, player ready/no error, editable transcript and subsequent edited Search. Screenshot saved locally.
- Review: [voice-integration-code-review-2026-10-05.md](../reviews/voice-integration-code-review-2026-10-05.md). No blocking code findings. Remaining acceptance gates explicitly NOT RUN in the review.

