# Current Requirements and Implementation Readiness Review

Date: 2026-08-25  
Scope: current contents of `requirements/`, `plan/`, `todo/`, `chn.docs/`, and
the existing files in `reviews/`

## Verdict

**Ready to start Phase 1 scaffolding: yes.** The product goal, primary user
flow, architecture, security intent, chunking approach, storage direction, and
phased work breakdown are clear enough to create the Next.js application,
configuration layer, `.gitignore`, `.env.example`, data directories, and README.

**Ready to start the full implementation unchanged: no.** Four issues should be
closed before data-model, provider, pipeline, and UI contracts are committed:

1. standard and fine chunk variants currently overwrite each other;
2. cross-provider vector compatibility is assumed rather than specified and
   proven;
3. the documented hosted Jina input limit is stale;
4. API, job-state, and concrete index-mapping contracts are still absent.

These are bounded specification corrections, not reasons to redesign the
project. Phase 1 can start while they are being resolved. Phase 2 also needs the
Elastic Serverless endpoint and API key already listed in the TODO.

## What is present

| Area | Current coverage | Assessment |
| --- | --- | --- |
| Original request and decisions | `requirements/00-original-request.md` | Complete and traceable |
| Testable requirements | `requirements/01-interpreted-requirements.md` | Strong, with a few corrections below |
| Architecture and data flow | `plan/00-implementation-plan.md`, `chn.docs/架构与数据流.md` | Detailed enough for scaffolding and technical discussion |
| Data-model concept | Two indices, field inventory, vector settings, document ID concept | Detailed concept, but not yet a safe final schema |
| Encoding design | Window formula, frame/audio proxy design, ladders, byte-budget probe | Detailed and implementable after probe semantics are corrected |
| Search and playback | RRF concept, modality controls, Range playback, timeline | Good interaction design; response contract is missing |
| Security intent | SSRF, path containment, streaming upload, `.env` credentials | Good baseline; URL-fetch details need strengthening |
| Delivery plan | Eleven phases with acceptance criteria and blockers | Well organized, with several criteria needing correction |
| Standalone specs | Planned `docs/` set | **Not present** |
| Startup/developer guide | Planned README | **Not present** |
| Executable project | No package, app code, tests, `.gitignore`, or `.env.example` yet | Correctly not started |
| Repository initialization | This directory is not currently a Git worktree | Phase 1 must explicitly initialize or attach it to one |

## Findings

### P0-1: Chunk IDs cannot support the required preset comparison

Evidence:

- `requirements/01-interpreted-requirements.md:92-96` requires standard and
  fine-grained presets for comparison.
- `requirements/01-interpreted-requirements.md:159-162` and
  `plan/00-implementation-plan.md:110-124` define `_id` as
  `{video_id}_{chunk_index}`.
- `todo/00-todo.md:181-194` requires running and comparing both presets.

Both presets start chunk numbering at zero. Ingesting the fine preset after the
standard preset therefore overwrites documents with the same IDs while leaving
other standard chunks behind. The resulting index is a mixed, invalid chunk
set, so the required comparison cannot be implemented reliably.

Required correction before Phase 3:

- introduce a stable `variant_id` or `embedding_set_id` derived from chunking
  configuration, provider/model/task, proxy settings, and a schema version;
- use an ID such as `{video_id}_{variant_id}_{chunk_index}`;
- store the variant on every chunk and model processing runs explicitly on the
  asset (or in a separate run index);
- define whether re-index means replacing one variant or creating another;
- add variant selection/filtering to search, library, timeline, and Phase 10.

### P0-2: L2 normalization does not prove provider interchangeability

Evidence:

- `requirements/01-interpreted-requirements.md:118-127` says all three
  providers can coexist because outputs are L2-normalized.
- `plan/00-implementation-plan.md:126-128` and `:195-207` repeat this claim.
- `todo/00-todo.md:96-98` accepts cosine similarity above 0.99 for one text as
  proof that vectors can share an index.

Normalization makes vector magnitudes comparable; it does not make two model
revisions, task adapters, preprocessing stacks, or provider implementations the
same embedding function. Jina v5 supports task-specific adapters, and the
selected task is not pinned in the provider contract. A single text comparison
also does not validate video and audio preprocessing parity.

Required correction before Phase 4:

- pin model ID, embedding task/adapter, dimensions, normalization ownership,
  and any provider-specific input type fields;
- record provider plus model/task/revision in each variant;
- either prohibit mixed-provider variants, or validate text, video, and audio
  fixtures across providers with an evidence-based tolerance;
- change the acceptance criterion from "proves interchangeable" to a
  compatibility test whose failure causes isolation into separate variants.

Jina's current model page confirms a shared multimodal space and 1024 output
dimensions, but that does not establish bit-for-bit parity among independently
hosted provider stacks: [Jina v5 omni small model card](https://jina.ai/models/jina-embeddings-v5-omni-small/).

### P0-3: The direct Jina API limit is documented incorrectly

Evidence:

- `requirements/01-interpreted-requirements.md:47-55` and `:123` state 10 MB.
- `plan/00-implementation-plan.md:206-207` and `:384-390` state 10 MB.
- `todo/00-todo.md:15-18` marks that value resolved.

The current hosted Jina API page states that audio and video inputs are limited
to **20 MB and 120 seconds**, with 32 video frames sampled. The project's 10 MB
statement may describe the inspected local server constant, but it is no longer
the current hosted-API contract: [Jina Search Foundation API](https://jina.ai/?model=jina-embeddings-v5-omni-small&sui=).

Required correction before calling Phase 0 complete:

- distinguish EIS, hosted Jina, and local-server limits in the requirement;
- make the capability probe provider-specific and include a 20 MB boundary for
  the hosted Jina path;
- store separate byte budgets per provider rather than one global value;
- also validate the 120-second duration cap when configurable windows are used.

The default 64-second window remains within the current hosted duration limit,
so this does not invalidate the core design.

### P0-4: Endpoint provisioning and version prerequisites are underspecified

The plan assumes `.jina-embeddings-v5-omni-small` is ready to call and that only
credentials are needed. Current Elastic documentation also shows a supported
flow that explicitly creates an `embedding` endpoint (for example,
`eis-jina-embeddings-v5-omni-small`) with service `elastic` and model ID
`jina-embeddings-v5-omni-small`. Availability is version-dependent; the current
supported-models table lists the omni-small model as generally available from
Stack 9.4: [Elastic Jina model setup](https://www.elastic.co/docs/explore-analyze/machine-learning/nlp/ml-nlp-jina),
[EIS supported models](https://www.elastic.co/docs/explore-analyze/elastic-inference/eis-supported-models).

Required correction before Phase 2:

- define a discover-or-create endpoint flow rather than assuming one ID;
- probe the configured ID, task type, model, region/version availability, and
  query-vector-builder path;
- document any live endpoint creation before applying it, just as NFR-6 already
  requires for indices;
- make `EMBED_INFERENCE_ID` a required measured/configured value unless a
  successfully discovered default exists.

### P1-1: The detailed standalone specs are not there yet

The plan is technically rich, but the answer to "are all detailed documents and
specs present?" is **not yet**. `docs/` does not exist. In particular, there are
no request/response/error schemas for ingestion or search, no upload contract,
no SSE event schema, no media Range/error contract, no state machine for jobs,
and no executable Elasticsearch mapping JSON.

Deferring measured results in `docs/operations.md` is reasonable. Deferring the
API contract and base data model until Phase 11 is not: those are inputs to
implementation, not close-out artifacts.

Required sequencing change:

- write `docs/data-model.md` before Phase 3, as already stated;
- write the base `docs/api-contract.md` and job state machine before Phases 6-8;
- allow measured fields in `docs/operations.md` to remain explicitly pending
  until Phase 2, instead of deferring the entire documentation set;
- add stable error codes and bilingual display-message mapping without exposing
  credentials, filesystem paths, or upstream response bodies.

### P1-2: Crash-resume acceptance has no durable checkpoint contract

`todo/00-todo.md:136-147` requires killing the process and resuming without
duplicates, while the architecture uses an in-process runner and stores only a
generic `progress` object on `video-assets`. Idempotent chunk IDs prevent some
duplicates but do not define how the application discovers unfinished work,
claims a job after restart, handles two workers, distinguishes failed from
stale, or knows which proxy files and inference calls are reusable.

Specify job states, checkpoint granularity, lease/ownership rules, retry counts,
recovery on startup, and variant identity. If restart recovery is not wanted in
the first demo, weaken the acceptance criterion to idempotent manual retry and
say so explicitly.

### P1-3: URL import security stops at the initial request

`requirements/01-interpreted-requirements.md:72-83` validates DNS and performs a
`HEAD`, but a safe downloader must also constrain the actual `GET`. Redirects can
change hosts, DNS can change between validation and connection, `HEAD` may be
unsupported or disagree with `GET`, and chunked responses may omit content
length.

Add redirect-count and per-hop validation, connect to the validated address
while preserving the Host/TLS name, stream-time byte enforcement, request and
idle timeouts, abort behavior, and partial-file quarantine. Test redirects to
private addresses and oversized chunked responses, not only a URL initially
resolving to `127.0.0.1`.

### P1-4: Several acceptance criteria do not test the intended property

- Phase 4's one-text cosine threshold does not prove provider compatibility
  (P0-2).
- Phase 5 requires encoding to be faster than hosted inference. That is a useful
  benchmark and optimization trigger, not a correctness gate; a slow network
  can make almost any encoder pass it.
- Phase 8's "expected chunk" is undefined. Add a fixture with expected time
  ranges and repeated latency measurement (for example warm p95), not one run.
- Phase 10 compares results against Elastic's published scene-chunk scores even
  though this project uses different 64-second and 10-second boundaries. Raw
  scores are not directly comparable across different candidate documents.
  Evaluate time-range relevance/top-k success and compare presets using the same
  local corpus and metric.

Elastic's example confirms that its trailer was split into 28 short segments,
which is materially different from this plan's fixed windows:
[Elastic Jina omni example](https://www.elastic.co/search-labs/blog/jina-embeddings-v5-omni-all-media-one-index).

### P2-1: The encoding ladder contradicts its stated floor

`requirements/01-interpreted-requirements.md:110-115` and
`plan/00-implementation-plan.md:143-152` call 720x405 the meaningful floor but
then include 640x360 below it. Either remove 640x360 or label it an explicit
last-resort byte-compliance rung and define what happens if even that rung at
CRF 32 exceeds the budget. The encoder also needs a terminal error/fallback;
"walk until it fits" currently has no exhausted-ladder behavior.

### P2-2: RRF output cannot directly provide the promised modality badge

The requirements promise a score and a visual/audio match badge, while the plan
only says to fuse two kNN retrievers with RRF. Define whether the API returns
the RRF rank score, per-modality similarity/rank, or both, and how a modality is
marked when both retrieve the same chunk. This belongs in `docs/api-contract.md`
and should be tested with a chunk returned by both branches.

### P2-3: Review history is internally confusing

`reviews/readiness-review-response.md` responds to an earlier "NOT ready"
headline that is no longer present in `reviews/readiness-review.md`; the current
file has a "READY" verdict and says it supersedes the earlier review. Because
this directory is not a Git worktree, the earlier evidence cannot be recovered
locally. Keep future reviews as new dated files (as this review does) rather than
rewriting the artifact a response points to.

## Strengths worth preserving

- The original request and clarification decisions are captured faithfully.
- Requirements are numbered and mostly observable.
- The design correctly separates playback media from embedding proxies.
- The binary-limit uncertainty is approached with measurement, not guessing.
- The two-modality strategy is clear and useful for the demo.
- Security concerns are present early rather than added after implementation.
- Remote Elasticsearch mutations are required to be documented first.
- Credentials are planned for `.env`, with only `.env.example` intended for the
  repository.
- The TODO has phases, dependencies, acceptance criteria, and a user-blocked
  section.
- The scope boundary (single-machine demo, no auth or durable queue) is explicit.

## Recommended start gate

### Start now

1. Initialize the Git worktree if this directory is intended to be the repo.
2. Execute Phase 1: scaffold Next.js, add `.gitignore` first, add
   `.env.example`, config validation, data directories, and README.
3. Do not place real credentials in documentation, source, or `.env.example`.

### Resolve in parallel before Phase 3/4

1. Fix variant identity and multi-preset storage (P0-1).
2. Define provider/model/task compatibility policy (P0-2).
3. Refresh provider limits and make the probe provider-specific (P0-3).
4. Define EIS endpoint discovery/creation and version checks (P0-4).
5. Write the base data model, API contract, and job state machine (P1-1/P1-2).

### Needed from the user before live probing

- Elastic Serverless URL and API key, saved only in a gitignored `.env`;
- confirmation that the project may create an EIS inference endpoint if the
  desired endpoint is not already available;
- optional Jina key only if the direct provider is included in the first demo.

## Final readiness statement

The project has a solid and unusually detailed planning foundation. It is ready
to **begin**, but the current "READY" review is too broad: readiness applies to
scaffolding, not yet to committing the data model and end-to-end implementation.
After the four P0 corrections and the base contracts are documented, the plan is
ready for feature development without an architectural reset.
