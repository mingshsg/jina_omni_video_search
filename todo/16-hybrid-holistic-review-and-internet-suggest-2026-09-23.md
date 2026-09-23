# Holistic hybrid review and internet-backed Suggest — 2026-09-23

Review: [`hybrid-metadata-search-holistic-review-2026-09-23.md`](../reviews/hybrid-metadata-search-holistic-review-2026-09-23.md). Implementation plan: [`04-internet-grounded-metadata-suggest.md`](../plan/04-internet-grounded-metadata-suggest.md). Prior phase findings remain in `todo/05`, `todo/06`, `todo/11`, and `todo/14`. Fixes: [`hybrid-metadata-search-holistic-and-f4-fixes-2026-09-23.md`](../reviews/hybrid-metadata-search-holistic-and-f4-fixes-2026-09-23.md).

Current code review: [`hybrid-internet-suggest-code-review-2026-09-23.md`](../reviews/hybrid-internet-suggest-code-review-2026-09-23.md).

## Ops fix — Save vs strict mapping (2026-09-23)

- [x] Root cause: live `video-assets` lacked `meta.description_embedding(_meta)` while
      PATCH script introduced `description_embedding_meta` (strict mapping).
- [x] Soft-fail editorial PATCH when semantic fields missing; gate stale-mark on
      `ASSET_SEMANTIC_ENABLED`; document `yarn setup-indices` in `docs/operations.md`.
- [x] Re-verified 2026-09-23: mapping declares `description_embedding*`; PATCH
      retries without `mark_semantic_stale` on `strict_dynamic_mapping_exception`;
      publish path soft-fails; `yarn test` 362 / `yarn build` PASS. **Operator:**
      run `yarn setup-indices` on the live cluster so semantic fields exist
      (expect `assets: "upgraded"` when fields were missing).

## Code-review blockers — 2026-09-23

- [x] **R5-01 P1:** Async POST/GET/DELETE Suggest job, visible stages, two-minute browser safety budget, and downstream cancellation.
- [x] **R5-02 P1:** A cited Agent `description` replaces the local title-clue placeholder proposal.
- [x] **R5-03/R5-04 P1:** Strict bounded Agent JSON, `status=ok` gating, HTTPS allowlisted sources, unsafe candidates dropped.
- [x] **R5-05/R5-06 P1:** Multilingual actor review UI; only exact, collision-free catalog identity can be added.
- [x] **R5-07/R5-08 P2:** Two-active/64-job bounds, rate limit, cache, cancellation, and structured request/revision/source/retrieval provenance.
- [x] **R5-09 P2:** Terminal platform-ID cleanup requires ID-like evidence; legitimate 11-character word regression added.
- [x] **R5-10 P2:** Provisioning honors `KIBANA_API_KEY` and creates only after 404.
- [~] **R5-11 P2:** Agent schema/status/source, cancellation/job, description, URL, and title regressions covered; browser interaction/actor-selection automation remains open.
- [x] **R5-12 P3:** Refreshed `AGENTS.md`, API/Agent docs, and Phase 4b status after stabilization.

- [x] Search UI: Reset filters (hard facets + parse dismiss state); parse chips
      from `extracted` with Boosting / Detected status; promote/dismiss re-search.
- [~] Replace/reconcile detached description embedding and verify ES revision update result, provider timeout and crash/retry behavior. (noop result checked + delayed retry; durable cross-process job still open)
- [~] Build and score labeled title/work/file corpus; include the current 26 titles, multilingual and ambiguous negatives. (local heuristic table in `todo/17`; full 26-title correctness audit still open)
- [ ] Add Chinese/Korean drama evaluation cases with native/English/romanized titles and cast names; curate exact multilingual aliases into `config/people.json`. Agent actor candidates may be returned as evidence, but only a unique existing `person_id` may be offered for Save.
- [ ] Decide catalog and permitted attribution/text reuse; choose measurable source policy and allowlist.
- [x] Probe Jina Search + Reader via Elastic MCP connector (operator imported tools). Product path does **not** use app `.env` `JINA_API_KEY` or Cursor→Jina.
- [~] Probe Agent Builder entitlement/egress/model/converse on the target instance; compare agent vs catalog for quality/latency/cost.
      Live dedicated agent id `video_metadata_research` now has custom skill `grounded_title_lookup`, no default Elastic capabilities, and only `jina.search_web` / `jina.read_url`. Direct Korean/Chinese smokes passed in 38.9s/43.1s. The rebuilt Library path reached this agent with the cleaned Chinese title but timed out at 60s, so representative p95/cost and the application latency decision remain open.
- [x] Implement bounded edit-only backend with structured candidates and per-field citations; UI selection/abstention/cancel and later-Save provenance.
      Wired: local + Agent Builder enrichment, async visible status/cancel, strict adapter boundary, actor candidate review, and structured accepted-field provenance.
- [ ] Test wrong-work negatives, unsupported fields, source validity, concurrent edits, 401/429/timeout, URL redirects, prompt injection, false search matches, p50/p95 and per-call costs.
- [~] Re-run the open Phase 1–3.6 live/schema/search acceptance gates and broad regression before feature sign-off; rebuild and smoke after code fixes. (App image rebuilt and `/api/library` returned 200; full earlier-phase gates remain open.)

## Dedicated-agent update evidence — 2026-09-23

- [x] Download live agent/skill/tools as project artefacts under
      `reference/agent-builder/` (`yarn download-agent-builder-artefacts`);
      validation checks all pass; skill body matches `ensure-suggest-agent.ts`.
- [x] Live read-back: `video_metadata_research`, skill
      `grounded_title_lookup`, only `jina.search_web` / `jina.read_url`,
      `enable_elastic_capabilities=false`.
- [x] Korean direct smoke `더 글로리`: unique 2022 match, sourced English and
      Hangul actor names, 38.9s.
- [x] Chinese direct smoke `琅琊榜`: unique 2015 match, sourced English and
      Chinese actor names, 43.1s at a 60s diagnostic deadline; one earlier call
      exceeded 45s.
- [x] Local validation: `yarn test` PASS (58 files, 344 tests); `yarn build`
      PASS; `git diff --check` PASS. Standalone `tsc` remains FAIL on the 41
      pre-existing live-test fixture errors; no error referenced the touched
      Suggest/agent/person files.
- [~] Rebuild/current-container Library Suggest smoke and actor-candidate UI
      review. Rebuild PASS and container is up. The Chinese asset normalized to
      `Xiang Si Ling Everlasting Longing` and reached agent
      `video_metadata_research`, but the agent timed out after 60.0s, so the API
      returned the safe local-only draft. Actor-candidate UI review remains open.
