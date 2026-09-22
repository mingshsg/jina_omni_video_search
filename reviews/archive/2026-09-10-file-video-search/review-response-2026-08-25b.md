# Response to `current-readiness-review-2026-08-25.md`

Date: 2026-08-25 (later the same day)
Responding to: [current-readiness-review-2026-08-25.md](current-readiness-review-2026-08-25.md)

This is a new dated file rather than an edit to any existing review, following
that review's own P2-3 recommendation.

## Summary

Ten of the review's eleven findings are accepted and folded into the
requirements, plan, and todo. **One finding, P0-3, is accepted in its reasoning
but rejected in its replacement data**: the numbers it proposes could not be
found in the authoritative source, and appear to originate from a different
limit. Details in the P0-3 section.

Separately, verifying the review's claims surfaced three facts the review did
not raise, two of which have larger design consequences than anything in the
review itself. They are recorded at the end.

The review's core judgement is endorsed: the project was ready to scaffold but
not ready to commit the data model, and the four P0 items were the right gate.

## Point-by-point

### P0-1, chunk IDs cannot support the required preset comparison — ACCEPTED

Correct, and it is a genuine defect rather than a documentation gap. Both
presets number chunks from zero against an `_id` of
`{video_id}_{chunk_index}`, so ingesting the fine preset after the standard
preset overwrites the overlapping IDs and orphans the rest, producing a mixed
and invalid chunk set.

Adopted as recommended: a `variant_id` derived from chunking configuration,
provider/model/task, proxy settings, and a schema version; `_id` becomes
`{video_id}_{variant_id}_{chunk_index}`; the variant is stored on every chunk;
and variant selection is threaded through search, library, timeline, and the
Phase 10 comparison.

One addition the review did not specify, verified while designing the fix:
keeping multiple variants in a single index is safe because the `knn` `filter`
is a **pre-filter**, "applied during the approximate kNN search to ensure that
`num_candidates` matching documents are returned"
([reference/elastic-knn-query.md](../reference/elastic-knn-query.md), line 147).
Without that property the fix would have required an index per variant. The
justification is now written into the plan rather than left implicit.

### P0-2, L2 normalization does not prove provider interchangeability — ACCEPTED, AND STRENGTHENED

The review is right, and the situation is worse than it argued. It reasoned from
the general possibility of task adapters. The actual API contracts confirm the
risk concretely:

- The hosted Jina API exposes `task` with enum `retrieval.query`,
  `retrieval.passage`, `text-matching`, `clustering`, `classification`, and
  `"default": "text-matching"`. A caller that does not set `task` silently gets
  a text-matching adapter, not a retrieval adapter.
- The EIS `embedding` endpoint for omni exposes no `task` or `input_type` in any
  captured Elastic reference. Only the `text_embedding` endpoints document
  `input_type: ingest`
  ([reference/elastic-jina-models-nlp.md](../reference/elastic-jina-models-nlp.md),
  lines 202 and 232-244).

So the adapter used by EIS is opaque to us while the adapter used by hosted Jina
is caller-selected and defaults to the wrong one for retrieval. The review
recommended validating cross-provider fixtures and isolating on failure. The
adopted policy is stronger: **cross-provider variants are prohibited by
default**, with model, task, dimensions, and normalization ownership pinned per
provider and recorded on every variant.

One correction to my own reasoning here: "EIS exposes no task control" is only
supportable as "no captured Elastic reference documents one." The Phase 2 probe
will therefore actively attempt to pass task settings and record whether they
are accepted, rejected, or silently ignored, rather than assuming absence.

### P0-3, the direct Jina API limit is documented incorrectly — REASONING ACCEPTED, DATA REJECTED

The review is right that this project's 10 MB figure is unsound. That number
came from the `MAX_MEDIA_BYTES` constant in the `jina-airgap` local server, not
from the hosted API contract, and it should never have been presented as the
hosted limit. That correction is adopted.

The proposed replacement of **20 MB and 120 seconds is not adopted**, because it
could not be verified:

- The live authoritative specification at `https://api.jina.ai/openapi.json`
  was fetched on 2026-08-25 (HTTP 200, ~103 KB). Its `VideoDoc` and `AudioDoc`
  schemas define exactly one property each, described as "Video as a URL or
  base64-encoded string" and "Audio as a URL or base64-encoded string". Neither
  carries a size or duration constraint.
- Searching the whole specification for `20 MB`, `120 second`, and `120s`
  returns nothing. The only file-size statements are 5 MB for images and 8 MB
  for PDFs, which match this project's existing notes.
- The most likely provenance of "20 MB" is a different limit entirely:
  Elasticsearch's `indices.inference.max_binary_input_size` defaults to 1 MB and
  "you can change the limit ... **up to 20 MB**" on self-managed and Cloud
  Hosted, while "In Elasticsearch Serverless, the limit is fixed at 1 MB"
  ([reference/elastic-semantic-field-reference.md](../reference/elastic-semantic-field-reference.md),
  line 123). That is an Elastic ceiling, not a Jina one.

Replacing one unsourced number with another would repeat the original mistake.
The adopted treatment is to record the hosted Jina video and audio limit as
**unknown and unmeasured**, keep the verified Serverless figure of 1 MB fixed,
keep the local-server constant labelled as a source constant, and make the
capability probe provider-specific so each budget is measured rather than
asserted. The review's underlying instruction — separate the three limits and
stop carrying one global value — is fully adopted.

The review's closing note on this point stands: the 64-second default window is
not invalidated by any of this.

### P0-4, endpoint provisioning and version prerequisites underspecified — ACCEPTED

Adopted: a discover-or-create endpoint flow replaces the assumption that
`.jina-embeddings-v5-omni-small` exists; the probe reports the configured ID,
task type, model, and version availability; and any live endpoint creation is
documented before being applied, consistent with NFR-6.

The review's version claim is confirmed: the supported-models table lists both
omni-small and omni-nano as Generally Available from **9.4**, in regions US, SG,
EU, and APJ ([reference/elastic-eis-supported-models.md](../reference/elastic-eis-supported-models.md),
lines 77-78). Note that Elastic's own documentation is internally inconsistent
here — the EIS page's omni section carries no preview marker and says the
`inference_id` can be referenced "on any supported version", while a nearby
callout says multimodal `embedding` inference works from 9.3. The probe
therefore trusts the live endpoint over any version table.

### P1-1, standalone specs are not there yet — ACCEPTED

The sequencing criticism is correct and was the most actionable item in the
review. `docs/data-model.md` before Phase 3 was already required; the change is
that the base `docs/api-contract.md` and the job state machine now also precede
Phases 6-8 instead of being close-out artifacts. Only the measured fields of
`docs/operations.md` remain legitimately pending until Phase 2.

Stable error codes with a bilingual display mapping, excluding credentials,
filesystem paths, and upstream response bodies, are adopted as stated.

### P1-2, crash-resume acceptance has no durable checkpoint contract — ACCEPTED

The review correctly identified that the acceptance criterion promised more than
an in-process runner with a generic `progress` object can deliver. Taking the
review's own escape clause: restart recovery is **not** in scope for the first
demo. The criterion is weakened to idempotent manual retry and stated
explicitly, with a job state machine defining states, retry counts, and which
proxy artifacts are reusable.

### P1-3, URL import security stops at the initial request — ACCEPTED

A real gap, not a theoretical one. Validating DNS and issuing a `HEAD` does
nothing about redirects to new hosts, DNS changes between validation and
connection, `HEAD`/`GET` disagreement, or chunked responses without a content
length. Adopted in full: redirect-count and per-hop validation, connecting to
the validated address while preserving the Host and TLS name, stream-time byte
enforcement, request and idle timeouts, defined abort behaviour, and
partial-file quarantine. The test cases now include a redirect to a private
address and an oversized chunked response, not only a URL that initially
resolves to loopback.

### P1-4, several acceptance criteria do not test the intended property — ACCEPTED

All four sub-points adopted:

- Phase 4's single-text cosine threshold is replaced by a compatibility test
  whose failure isolates providers into separate variants.
- Phase 5's "encoding faster than inference" becomes a recorded benchmark and
  optimisation trigger, not a correctness gate.
- Phase 8 gains a fixture with expected time ranges and a warm p95 measurement
  instead of a single run.
- Phase 10 no longer compares against Elastic's published scores. The review is
  right that this was invalid: Elastic split the same trailer into 28
  PySceneDetect scenes of 1.9 to 18.4 seconds
  ([reference/elastic-labs-jina-embeddings-v5-omni.md](../reference/elastic-labs-jina-embeddings-v5-omni.md),
  line 261), so raw scores over different candidate sets are not comparable.
  Evaluation moves to time-range relevance and top-k success on our own corpus,
  with the two presets compared under the same metric.

### P2-1, the encoding ladder contradicts its stated floor — ACCEPTED

640x360 is retained but relabelled an explicit last-resort rung for byte
compliance rather than a normal step, and the encoder now has defined terminal
behaviour when even that rung at CRF 32 exceeds the budget.

### P2-2, RRF output cannot directly provide the promised modality badge — ACCEPTED

Correct, and verifying it exposed a gap in this project's own reference set: no
retriever documentation had been captured at all, despite the design depending
on RRF semantics. Two reference documents have now been added,
[elastic-rrf-retriever.md](../reference/elastic-rrf-retriever.md) and
[elastic-knn-retriever.md](../reference/elastic-knn-retriever.md), which confirm
the review's point and add three useful facts:

- RRF returns a fused rank score only; nothing in the response identifies the
  contributing child retriever, so the badge needs its own mechanism.
- Per-retriever `weight` is supported from 9.2, so the visual and audio branches
  can be weighted asymmetrically — a better basis for the modality controls than
  the equal-weight fusion originally planned.
- `rank_window_size` **defaults to 10**, which would have quietly capped fusion
  quality. It must be set explicitly and be at least `size`.

The badge rule and the response shape now belong to `docs/api-contract.md`, with
a defined label for chunks returned by both branches, as the review asked.

### P2-3, review history is internally confusing — ACCEPTED AND CONFIRMED

Verified. `readiness-review.md` now opens with a READY verdict and a line saying
it supersedes an earlier review of the same day, so
`readiness-review-response.md` answers a headline that no longer exists in the
file it points at. Also confirmed: the directory was not a Git worktree at the
time of the review, so the earlier text is unrecoverable locally.

Adopted as practice: reviews and responses are new dated files, never rewrites
of the artifact something else already responds to. This file follows that rule.
A Git repository has since been initialised, so future review history is
recoverable.

## Three facts the review did not raise

Found while verifying the review's claims. The first two change the design more
than any single review finding.

1. **The Jina `task` parameter defaults to `text-matching`.** Covered under
   P0-2 above. Its practical effect is that document embeddings must be sent
   with `retrieval.passage` and queries with `retrieval.query`; leaving `task`
   unset would produce a silently suboptimal index with no error anywhere.

2. **A fused single-vector option exists on Jina but not on EIS.** The live Jina
   specification includes `MergedContentGroup`: "Mixed-modality chunks fused
   into ONE embedding per group. The executor sends every chunk to the model in
   a single forward pass ... Order within `content` is semantically meaningful."
   That would allow one vector per chunk covering both picture and speech.
   Elastic has no equivalent: non-text input is a single `{type, value}` object,
   "Each non-text value is processed as a single unit and produces one
   embedding", an array yields one embedding per array position, and at query
   time Elasticsearch "uses the best matching embedding to score the top-level
   document" — N values, N vectors, max-pooled, never fused
   ([reference/elastic-semantic-field-reference.md](../reference/elastic-semantic-field-reference.md),
   lines 90-161). Decision: stay with dual-track plus RRF, which works on both
   providers and preserves the modality badge; fusion is recorded as evaluated
   and not adopted.

3. **The Elastic version matrix gates the field-type choice.**
   [reference/elastic-inference-service.md](../reference/elastic-inference-service.md),
   lines 99-104: 9.3+ can run multimodal `embedding` inference; 9.4+ supports
   `semantic_text` for text only; **9.5+ is where the `semantic` field type
   supports all modalities**. The target instance is 9.5, so a `semantic`-field
   design is now technically possible — but it would pin the project to 9.5,
   return the full base64 data URL in `_source`, and give up modality labels and
   RRF weighting. Explicit `dense_vector` remains the choice, and this is now
   recorded as a reasoned decision rather than an unstated preference.

## Two corrections to this project's own earlier claims

Found by re-auditing rather than by the review:

- **Video embeddings must not be Matryoshka-truncated.** The technical report
  states the video curve "diverges from the others well before 64 dimensions and
  crosses below half its full-dimension score around 32"
  ([reference/arxiv-jina-embeddings-v5-omni.md](../reference/arxiv-jina-embeddings-v5-omni.md),
  line 1032), making video the most truncation-sensitive modality. Earlier notes
  listed 1-1024 Matryoshka support as an available capability without this
  caveat, which invited shrinking vectors to save space. Dimensions stay at
  1024.
- **The plan's assertion that `bbq_hnsw` requires at least 64 dimensions has no
  source** in the captured references. The conclusion is harmless because 1024
  sits far above any plausible threshold, but it was stated with more confidence
  than the evidence supports and is being softened.

## Addendum: round 3 review corroboration

[readiness-review-2026-08-25-r3.md](readiness-review-2026-08-25-r3.md) landed
while this response was being written. It independently verified the second
review's findings against the current documents and reached the same conclusion
on the disputed point:

> However, I also fetched both pages the second review cites for its 20 MB /
> 120 s claim (the model card and the API page), and **neither states those
> numbers today**. So do not simply substitute 20 MB for 10 MB.

That is arrived at from different sources than the ones used above — the model
card and API pages rather than the OpenAPI specification — and reaches the same
place, which is about as good as verification gets for a negative claim.

Two refinements from round 3 have been absorbed:

- **Text parity is not evidence of video parity.** The model card states omni
  text vectors are bit-identical to `jina-embeddings-v5-text-small`, implying
  strong cross-stack determinism for text but saying nothing about video and
  audio preprocessing. A text-only compatibility test would pass while proving
  nothing. This is now the stated reason the Phase 4 fixture spans all three
  modalities.
- **The data model needs executable mapping JSON, not prose.** Both the second
  and third reviews asked for this; `docs/data-model.md` now explicitly requires
  it, and `docs/api-contract.md` explicitly requires the SSE event schema.

Round 3 also **reduces the severity of P0-4**: the EIS reference indicates
deployments ship preconfigured default endpoints and that omni endpoint creation
is GA on Serverless, so the original assumption was probably safe and only the
fallback was missing. The adopted discover-or-create flow covers that case
regardless, so no change is needed — the treatment is simply more thorough than
strictly required.

## Status (superseded — see correction below)

~~The four P0 items and all P1 and P2 items are now reflected in
requirements, plan, and TODO.~~ **This status paragraph was incorrect at the
time it was written.** Round 4 correctly noted that requirements and
`chn.docs` still described the old design while the plan/TODO described the
new one. The false claim is corrected in the addendum.

## Addendum — Round-4 correction (2026-08-25 / 2026-08-26)

Round 4 (`readiness-review-2026-08-25-r4.md`) found that the Status section
above overstated sync completion. That finding is **accepted**.

As of the Round-4 sync pass:

- `requirements/01-interpreted-requirements.md` and `chn.docs/架构与数据流.md`
  are updated to match the consolidated plan.
- UI stack corrected to Next.js 14.2.35 + React 18.3.1 (P0-2).
- Point-by-point response:
  [review-response-2026-08-25-r4.md](review-response-2026-08-25-r4.md).

Phase 2 remains blocked on the Elastic Serverless endpoint and API key.
