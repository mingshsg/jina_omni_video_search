# Project Readiness Review — jina_video_embedding

**Date:** 2026-08-25 (supersedes the earlier review of the same day, when the directory was empty)
**Reviewer:** Claude Code
**Verdict: READY to start implementation.** Phase 1 (scaffolding) can begin immediately; Phase 2 onward is blocked only on the Elastic Serverless URL and API key, which the todo already tracks as waiting on the user.

## Documents reviewed

| Artifact | File | Assessment |
|---|---|---|
| Original request | `requirements/00-original-request.md` | ✅ Verbatim capture plus every clarification decision recorded |
| Interpreted requirements | `requirements/01-interpreted-requirements.md` | ✅ 18 FRs, 6 NFRs, constraints, open questions, scope exclusions |
| Implementation plan | `plan/00-implementation-plan.md` | ✅ Architecture, data model, config, 11 phases, risk register |
| Todo | `todo/00-todo.md` | ✅ Phased, maps 1:1 to the plan, blockers explicit |
| Chinese architecture doc | `chn.docs/架构与数据流.md` | ✅ Faithful condensed version of the plan |

## Strengths

These documents are unusually complete for a demo project. Specific things done right:

1. **Requirements are numbered and testable.** Each FR states observable behaviour (e.g., FR-2's validation rules name the exact protections: SSRF via private/loopback DNS rejection, path traversal via `realpath` containment). NFRs cover credentials hygiene, fail-fast config, bilingual UI, and no-silent-deletion.
2. **The critical unknown is handled by measurement, not assumption.** The binary size limit question (user recalled 75 MB, then 10 MB; documentation says 1 MB on Serverless) was researched, both gates identified, the residual ambiguity honestly recorded as OQ1, and a capability probe (FR-13, Phase 2) settles it empirically before the pipeline is built. `EMBED_MAX_BINARY_BYTES` is driven by the measurement, so no code changes regardless of the answer.
3. **Technical facts are verified, not vibed.** The 32-frame sampling, the 262,144-pixel upscaling threshold, the 1024 dimensions, the base64 data-URL input shape, and Elastic's own reference demo behaviour are all cited and used to justify design decisions (the 720x405 resolution floor, the dual-track visual+audio embedding, the 32-frame proxy).
4. **Interpretation departures are declared.** Where the plan deviates from the literal request (720p as ceiling not target for embedding proxies; time windows instead of physical file splits; keeping 64 s/4 s as default despite evidence shorter clips retrieve better), each departure is stated with its reason — and the fine-grained preset makes the granularity trade-off measurable in the demo.
5. **The plan has real technical depth.** Data model with exact mappings (`dense_vector`, 1024 dims, cosine, `bbq_hnsw` + rescore oversample), idempotent `_id` scheme for re-ingestion, budget-adaptive encoding ladders with a justified floor, RRF fusion with provider-aware query vector generation, a full configuration table, and a risk register with mitigations already designed in.
6. **Dependencies and ordering are sound.** The probe (Phase 2) correctly blocks phases 4–7; index changes must be documented before touching the live instance (NFR-6); `.gitignore` excludes `.env` and `data/` from the first commit.

## Gaps and issues

None of these block starting. Listed in priority order.

### G1 — Blocker for Phase 2+: Elastic Serverless credentials (already tracked)
The todo's "Blocked / waiting on user" section is accurate: nothing beyond scaffolding can be verified without `ELASTICSEARCH_URL` and `ELASTICSEARCH_API_KEY`. Provide these early — the probe result shapes the encoder, so a surprise here is cheapest to absorb before Phase 5.

### G2 — The `docs/` spec set is planned but not yet written
`docs/architecture.md`, `data-flow.md`, `data-model.md`, `api-contract.md`, `ui-mockup.md`, `operations.md` are unchecked in Phase 0 and the directory does not exist. Most content already lives in the plan, so this is largely a factoring exercise, but two have real missing substance:
- **API contract**: the plan lists route paths and one-line purposes, but no request/response schemas, status codes, or error shapes for `api/ingest`, `api/search`, the SSE event format, or the upload endpoint. Acceptable to define during Phases 6–8, but writing `docs/api-contract.md` first would let UI (Phase 9) and API work proceed against a stable contract.
- **Operations**: `docs/data-model.md` is a stated precondition for Phase 3 (NFR-6) and `docs/operations.md` for recording probe results — both must exist by the time their phases run.

### G3 — Todo is stale on one item
Phase 0 lists "Write `chn.docs/` Chinese architecture and data-flow documents" as `[ ]`, but `chn.docs/架构与数据流.md` exists and is complete. Mark it done (or split it if more Chinese docs are intended).

### G4 — Two technical-preview API claims should be confirmed by the probe
The plan relies on (a) the preconfigured `.jina-embeddings-v5-omni-small` EIS endpoint and (b) `knn.query_vector_builder.embedding` with explicit `inference_id` against a plain `dense_vector` field. Both are marked technical preview in the plan's own risk register, and the fallback (application-computed query vectors) is designed. Suggest the Phase 2 probe script explicitly exercise the query-side builder too, not just the ingest-side inference call — currently the probe only measures the ingest path.

### G5 — Cost estimate before large imports is in the risk register but not in the todo
The plan's last risk ("a two-hour film is about 240 inference calls — worth surfacing an estimate in the UI before the user commits") has no corresponding task in Phase 9. Add a todo item so it doesn't get lost.

### G6 — Minor omissions, note and move on
- No task for initialising the git repository itself (Phase 1 assumes it around the `.gitignore` step).
- `LOCAL_IMPORT_ROOT` has no default; config validation should make the local-path import mode cleanly report "not configured" rather than fail obscurely.
- Job store durability across dev-server restarts is implied (state persisted to `video-assets`) but resumability semantics ("resumable on failure", Phase 7) are not specified — what resumes, from where, and what the user sees. Fine to define in Phase 7, worth a sentence in the API contract.

## Answers to the review questions

**Is it ready to start?** Yes. Requirements, plan, and todo are consistent with each other, decisions are recorded with rationale, and the one genuine unknown (OQ1) has a measurement plan rather than a guess. Start Phase 1 now; hand over the Serverless credentials to unblock Phase 2.

**Are the detailed documents, specs and technical details there?** Substantially yes — the requirements and plan together contain the data model, configuration surface, encoding strategy, retrieval design, and security validations at implementation-ready depth. The one thin spot is the API contract (G2), and the `docs/` factoring is still pending; neither blocks the first two phases.

## Recommended immediate actions

1. Provide the Elastic Serverless endpoint URL and API key (G1).
2. Tick the `chn.docs/` item in the todo (G3).
3. Add two todo items: probe the query-side vector builder in Phase 2 (G4), and the pre-import cost estimate in Phase 9 (G5).
4. Write `docs/api-contract.md` before Phase 6, and `docs/data-model.md` before Phase 3 (G2).
