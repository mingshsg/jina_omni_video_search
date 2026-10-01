# todo/48 — Recover an existing-only subtitle retry (2026-10-01)

User report: run `ab78f39452ea` for the uploaded Docker Sandbox video still
failed after pressing Retry enrichment. The video has an English audio stream
and no matching timed English or Chinese subtitle stream.

- [x] Confirm the run's video, request policy, media, and exact failure.
- [x] Generate a timed English host transcript with Mac MLX Whisper; keep it
  in the ignored shared run workspace.
- [x] Let the results flyout explicitly select subtitle method and spoken
  language before retry, while an omitted retry body keeps the old contract.
- [x] Validate overrides server-side and reject an ASR-capable bilingual
  request without a selected spoken language.
- [x] Explain an existing-only missing-source failure accurately.
- [x] Add focused tests for policy validation and missing-source guidance.
- [x] Complete `yarn test` and a fresh Node 22 production build after edits.
- [x] Rebuild the running app image, retry this run with Auto + English, and
  verify terminal status, EN/ZH timed SRTs, index counts, and browser links.
- [x] Commit and push the verified code and tracked diagnostic artifacts.
- [ ] Human-check the English transcription and Chinese translation against
  the video before accepting subtitle content quality.

## Verified gates

| Gate | Result |
| --- | --- |
| Full Node 22 tests | PASS: 106 files / 789 tests |
| Fresh production build | PASS: `docker compose up -d --build app` |
| Invalid retry | PASS: Auto without spoken language returned HTTP 400; run unchanged |
| Live retry | PASS: same job/run `succeeded` with Auto + English, no re-embedding |
| Final files | PASS: 121 EN + 121 ZH cues, identical timestamps through 11:47.120 |
| Elasticsearch | PASS: 121 unique EN (`mlx_host`) and 121 unique ZH (`translated_en`) documents |
| Browser | PASS: results flyout shows success and both subtitle links; links return HTTP 200, private host transcript returns 404 |
| Failed-state selector interaction | NOT RUN in browser; API override and build passed |
| Human content quality | NOT RUN |

## Acceptance boundaries

- Keep the original failed run ID and do not re-embed video chunks.
- Explicit retry options affect only the subtitle policy; the modules,
  languages, and director coverage remain fixed.
- A bare `POST /api/jobs/:id/retry` keeps its previous behavior.
- Human review of the English transcript and translated Chinese is still
  needed before subtitle quality is accepted.
