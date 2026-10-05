# Review remediation — 2026-10-04

Scope: findings in [todo/53](53-demo-path-bug-sweep-2026-10-03.md) and
[todo/54](54-branch-wide-bug-review-2026-10-04.md), on `codex/enrichment-add-runs`.
Historical review bodies remain unchanged.

- [x] Retry generations, shared start reservation, interrupted-run recovery and durable terminal status (S1–S4, D1).
- [x] Editor callbacks/cache and catalog fallbacks (U1, U2, U8).
- [x] Ingest recovery, batch accounting and validation (U3–U7).
- [x] Request validation, subtitle vector identity, rename consistency and portable artifacts (S5–S8).
- [x] Group options/lookup, Markdown MIME and retry copy (D2–D5).
- [x] Focused regression tests, full `yarn test`, `yarn build`.
- [x] Record dispositions and unrun live/browser gates.

U5's proposed filesystem deletion conflicts with the user's no-deletion rule.
Remediation validates before promoting an original and preserves rejected
uploads outside the accepted media location; no filesystem file was deleted.

## Acceptance still open

- [ ] Real-video retry/refresh and container restart/failure-injection browser flow.
- [ ] Browser provider-hint submission, terminal import Clear/Retry, forced catalog failure and retry toast.
- [ ] Component-level polling/ingest stream tests (pure guard and route regressions pass).
- [ ] Representative ASR/translation human quality, long-video boundaries, latency/cost and multi-replica durable coordination (existing trackers retain these gates).

Evidence: [remediation review](../reviews/review-remediation-code-review-2026-10-04.md). All filesystem files preserved; temporary live ES fixture documents cleaned up. Committed and published on `codex/enrichment-add-runs`; see [todo/58](58-update-publish-2026-10-05.md).

## App container rebuild — 2026-10-05

- [x] Rebuild/recreate only the app container from the reviewed working tree, preserving media mount and loopback port.
- [x] Confirm new container/image and built remediation code.
- [x] Check root/Library HTTP responses and live Library API.

Previous Docker rebuild statements above describe the October 4 review. This follow-up records the user's explicit rebuild request. No full retry/ASR/quality acceptance is implied by container startup.

Rebuild PASS: `docker compose up -d --build app`. Rebuilt again after the header-logo request. Final container `d0f23e462bcf`, created 2026-10-05 13:55:27 Singapore time, image `sha256:7b0bdfe394b06ed711fa7d73d5b26e4a5f1b7715313fa16eef1473abc14a60f8`. Media remains `/Users/ming.shen/Downloads/jina_video_embedding/data:/app/data`, port remains `127.0.0.1:3000`. Built server contains the interrupted-run recovery message. Root, Library and Library API HTTP 200 (38 assets, 3 variants). Full retry/restart failure injection and human quality gates remain open.
