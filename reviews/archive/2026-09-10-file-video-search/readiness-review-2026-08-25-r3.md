# Readiness Review, Round 3 — post-update verification

**Date:** 2026-08-25 (evening, after the 22:46 document revisions)
**Reviewer:** Claude Code
**Scope:** the revised `requirements/`, `plan/`, `todo/`, `chn.docs/`, the new `reference/` corpus, and the two other review artifacts in `reviews/`.

## Verdict

**Ready to start Phases 1 and 2 now.** Scaffolding and the capability probe need nothing that is missing.

**Not yet ready to commit the Phase 3+ contracts.** The 22:46 revisions thoroughly address the *first* review (this reviewer's), but they do **not** address the four P0 findings in `current-readiness-review-2026-08-25.md` (22:45) — the revisions and that review evidently crossed in flight. I have independently verified those findings against the current documents rather than taking them on trust; results below. Two are confirmed defects that must be fixed before Phase 3/4, one is a confirmed internal inconsistency with uncertain numbers on both sides, and one is real but lower severity than claimed. All are specification edits, not redesign.

## What improved since round 2 (verified present)

The response document (`readiness-review-response.md`) claims a set of changes; all of them check out in the current files:

- **`local` provider added** (FR-9, constraint C2, plan Providers section, `local.ts` in the file layout, `LOCAL_EMBED_URL` config) with the CC-BY-NC-4.0 and CPU-latency caveats recorded, correctly positioned as escape hatch rather than default.
- **NFR-7 through NFR-10 added**: deployment target, scale envelope (~20 videos / 2,000 chunks, with the queue boundary stated), measure-and-record latency posture with a hard <2 s search target, and pre-import cost estimates. The cost estimate also landed as a Phase 7 todo item — closing round 2's G5.
- **Acceptance criteria on all eleven phases**, mostly falsifiable and well-chosen (setup-script-twice idempotence, symlink-escape refusal, chunk-count-unchanged re-ingestion).
- **README moved from Phase 11 to Phase 1**, with the right rationale.
- **`reference/` corpus**: 15 offline snapshots of the Elastic/Jina/arXiv sources, with an index mapping each design concern to its evidence and a constraints cheat sheet. This is a genuine strength — the design's factual claims are now auditable offline.
- The stale chn.docs todo item is fixed, and a revision history section was added to the requirements.

The response document itself is good practice: adopted findings are folded in with rationale, rejected ones are rejected with reasons, and both rejections are sound.

## Verification of the second review's P0 findings against the current documents

### P0-1, chunk ID collision between presets — **CONFIRMED, must fix before Phase 3**

Still true in the current files: [01-interpreted-requirements.md:161](../requirements/01-interpreted-requirements.md) and [00-implementation-plan.md:117](../plan/00-implementation-plan.md) define `_id` as `{video_id}_{chunk_index}`, no `variant` concept exists anywhere in requirements/plan/todo (grep-verified), and Phase 10 requires ingesting the same asset under both presets.

Concrete failure: the 158 s test trailer yields 3 chunks under the 64 s/4 s preset (indices 0–2) and about 20 under 10 s/2 s (indices 0–19). Running fine after standard overwrites documents 0–2 and destroys the standard run; running standard again afterwards leaves a mixed set of 3 standard + 17 orphaned fine chunks. Phase 10's own acceptance criterion ("the difference between presets is quantified") is unimplementable as specified.

Fix as the second review proposes: a `variant_id` derived from chunking + provider/model + proxy config, `_id = {video_id}_{variant_id}_{chunk_index}`, variant stored on each chunk, variant filtering in search/timeline, and a defined re-index semantics.

### P0-2, L2 normalisation as proof of provider interchangeability — **CONFIRMED as a spec weakness, must fix before Phase 4**

FR-9 still asserts coexistence because all providers "run the same model and L2-normalise", and Phase 4's acceptance is one text at cosine > 0.99. Normalisation equalises magnitude, not the embedding function: the three stacks (EIS, hosted Jina, self-hosted container) may differ in model revision, task adapter selection, and video/audio preprocessing. One partially mitigating fact from the project's own reference corpus: the model card states omni text vectors are *bit-identical* to `v5-text`, which suggests strong cross-stack determinism for text — but that says nothing about video and audio preprocessing parity, which is exactly what this project depends on.

Fix: pin model/task/revision in the provider contract, record provider identity per variant (which P0-1's `variant_id` gives you for free), test fixtures across all three modalities not just text, and define the failure consequence as isolation into separate variants rather than a blocked phase.

### P0-3, stale hosted-Jina limit — **CONFIRMED as an internal inconsistency; the replacement numbers could not be verified either**

The current C1 and FR-9 state the hosted Jina API allows "10 MB per input". The project's **own** reference snapshot contradicts this: `jina-embeddings-api.md` (FAQ) lists only 5 MB images and 8 MB PDFs, with **no video/audio figure at all**, and the project's own `constraints-cheat-sheet.md` correctly attributes the 10 MB to the airgap server's `MAX_MEDIA_BYTES` constant, noting "video not separately listed in FAQ". So C1/FR-9 disagree with the cheat sheet, and the cheat sheet is right.

However, I also fetched both pages the second review cites for its 20 MB / 120 s claim (the model card and the API page), and **neither states those numbers today**. So do not simply substitute 20 MB for 10 MB.

Fix: state in C1 that the hosted-API video/audio limit is *undocumented*, make the probe provider-specific (it currently probes only the EIS path), store per-provider byte budgets (`EMBED_MAX_BINARY_BYTES` is currently one global), and let measurement supply the hosted number the same way it supplies the EIS number. This is the project's own stated philosophy — measure, don't guess — applied to one more unknown.

### P0-4, endpoint provisioning underspecified — **REAL but reduced severity; fold into Phase 2**

The plan assumes the preconfigured `.jina-embeddings-v5-omni-small` endpoint exists. The project's own EIS reference snapshot says deployments include preconfigured default endpoints, omni endpoint creation is GA on Serverless, and custom endpoints are only needed for non-default configurations — so on the chosen platform the assumption is probably fine, and the Phase 2 probe already fails loudly if the endpoint is absent. What's missing is the *fallback*: if the probe finds no endpoint, there is no documented discover-or-create step. Add one todo item to Phase 2 (list available EIS endpoints; if the default is missing, document the creation call per NFR-6 before applying it, and require user confirmation since it changes the live project). Not a blocker for starting.

## Second review's P1/P2 findings — status in the current documents

All still open; none were incorporated in the 22:46 revision:

- **P1-1 (API contract sequencing)** — still deferred to Phase 11. The response document's deferral argument is valid for `operations.md` (needs measured numbers) but not for `api-contract.md`, the SSE event schema, and the job state machine, which need no measurements and are inputs to Phases 6–9. Pull those forward.
- **P1-2 (crash-resume contract)** — Phase 7's acceptance still promises kill-and-resume without specifying checkpoints, job states, or startup recovery. Either specify the state machine (naturally part of the api-contract work) or honestly weaken the criterion to idempotent manual re-run.
- **P1-3 (URL import GET-time hardening)** — FR-2 still validates only the initial request. Redirect-hop revalidation, DNS-rebinding protection, stream-time byte caps, and timeouts should be added to FR-2 before Phase 6.
- **P1-4 (acceptance criteria)** — Phase 5's "encode faster than inference" is a benchmark, not a correctness gate; Phase 8's "expected chunk" needs a fixture definition; Phase 10's comparison against Elastic's published scores is invalid across different chunkings (their demo used 28 scene-detected segments of 1.9–18.4 s; this project uses fixed windows — the project's own requirements document says so at line 33). Compare presets against each other on time-range relevance instead; treat Elastic's published results as qualitative sanity checks only.
- **P2-1 (ladder floor contradiction)** — 640x360 still sits below the "meaningful floor" of 720x405 with no exhausted-ladder behaviour defined.
- **P2-2 (modality badge vs RRF)** — FR-16 promises a badge, the plan specifies only RRF fusion; the per-modality attribution needs a defined response shape, including the both-modalities-matched case.
- **P2-3 (review history)** — partially resolved: this review is a new dated file, as the second review requested. The overwriting of `readiness-review.md` in round 2 was this reviewer's doing and stops here.

## Answers to the review questions

**Is it ready to start?** Yes, for Phases 1 and 2 — start them now; nothing outstanding touches scaffolding or the probe. The genuine blockers before Phase 3/4 are two bounded spec fixes (P0-1 variant identity, P0-2 compatibility policy), one documentation correction (P0-3 provider-specific budgets), and pulling the API contract forward (P1-1). Realistically that is an hour or two of document editing, and none of it changes the architecture, the chunking approach, or the dual-track embedding design.

**Are the detailed documents, specs and technical details there?** Mostly, and better than in round 2: requirements, plan, acceptance criteria, deployment/scale/latency targets, and now an auditable reference corpus. Two gaps remain: the `docs/` contract set (specifically `api-contract.md`, SSE schema, job state machine, and executable mapping JSON) and the corrections above. The measured-numbers portions of `docs/operations.md` are legitimately deferred to Phase 2.

## Recommended sequence

1. **Now:** start Phase 1 scaffolding; request the Elastic Serverless URL and API key (still the only user-blocked item for Phase 2).
2. **Before Phase 3:** fix P0-1 (variant identity) in requirements, plan, and data model; write `docs/data-model.md` with executable mappings including the variant field.
3. **Before Phase 4:** fix P0-2 (pin model/task/revision, multi-modality compatibility fixtures, per-variant provider identity); correct C1/FR-9 per P0-3 and make budgets per-provider.
4. **Before Phases 6–8:** write `docs/api-contract.md` with the SSE event schema and job state machine (settles P1-2 and P2-2); strengthen FR-2 per P1-3.
5. **Phase 2, additions:** provider-specific probe including the hosted Jina boundary; endpoint discover-or-create fallback (P0-4); exercise the query-side `query_vector_builder` path, not just ingest.
6. **Phase 10:** replace the published-score comparison with same-corpus preset comparison (P1-4).
