# Group selection automatically chooses Variant — 2026-10-05

User request supersedes the earlier manual-switch-only decision in todo/39 G1 and todo/40 R1.

- [x] On a Group gesture, choose a ready Variant from server-confirmed Group entries. Keep current Variant when compatible; otherwise prefer greatest selected-group coverage, server preference rank, then stable ID tie-break.
- [x] All groups, unknown/unavailable mapping and genuinely empty Groups preserve the current Variant. Manual changes remain possible after a Group gesture. No background availability effect overrides a manual choice.
- [x] Update Group and Variant together, add options outside the newest-200 Library window, and ensure the existing query rerun sends the latest Variant.
- [x] Add regression cases for nondefault group, multiple variants/groups, manual compatibility, empty/unknown and deterministic selection.
- [x] Run tests/build and rebuild app container.
- [x] Browser Group-to-Variant selection, clearing and manual override; save screenshot.

Scope: main text-search toolbar. Search API/provider/variant identity contracts and image/live flows remain unchanged. Uses already-loaded verified availability; when unavailable, existing warning/manual fallback remains.

## Verification

- PASS `yarn test --maxWorkers=4`: 115 files / 851 tests. Log `/private/tmp/jina-group-auto-tests-20261005.log`.
- PASS final Docker `yarn build` and `docker compose up -d --build app`. Log `/private/tmp/jina-group-auto-container-build-20261005.log`; app recreated (created 2026-10-05 14:08:36, started by 14:09:16 Singapore time), same media mount and port 3000.
- PASS browser: default training Variant → trailer Group selected `4495e972f9e6b5a1`; drama selected `8b28281cd6671e40`; training selected `e158b7d7c3cd07e3`. Clearing Group retained previous Variant. Manual incompatible Variant remained selected after availability settled and showed existing compatibility fallback. Immediate clear/new training gesture chose its ready Variant.
- PASS no Group gesture submitted an unsubmitted query (Executed query remained disabled).
- PASS `git diff --check`. Screenshot `/private/tmp/jina-group-auto-variant-20261005.png`.
- NOT RUN live submitted-query rerun, synthetic catalog outage, high-latency rapid-click stress and full image/live runtime regressions. Existing request shape remains explicit `variant_id` plus Group filters, and full unit suite passes.

Changes are committed and published (todo/58); the earlier manual-only tracker decisions are explicitly superseded without editing historical reviews.

Final container `0f31988c6616`, image `sha256:b70829bcffa8a322c1fff99d4f4aca2abdc064f8b85722b3365deda77933a751`.
