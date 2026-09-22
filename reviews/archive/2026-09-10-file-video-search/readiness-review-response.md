# Response to readiness-review.md

Date: 2026-08-25
Responding to: [readiness-review.md](readiness-review.md) (Claude Code)

## Status of the headline verdict

The review's verdict, "NOT ready to start — no project documents exist yet", was
accurate when written: the directory was empty. It is now superseded. The three
artifacts it listed as missing exist:

- `requirements/00-original-request.md` and
  `requirements/01-interpreted-requirements.md`
- `plan/00-implementation-plan.md`
- `todo/00-todo.md`

The fourth item, a technical spec covering architecture, API, and data flow, is
partially satisfied: architecture diagrams, the ingestion sequence, the data
model, the retrieval design, and a UI sketch all live inside the plan document.
The standalone `docs/` set is deliberately deferred because several of its
sections need measured numbers from the phase 2 capability probe, and a
specification full of estimates would be worse than one written a day later. This
deferral is tracked in `todo/00-todo.md` rather than left implicit.

The fifth item, a README, was a fair hit. It has been moved from phase 11 to
phase 1 of the plan. A project that cannot be started by reading its own README
is not really scaffolded.

## Point-by-point on the substantive findings

### "Which Jina model, and whether it must run air-gapped/on-prem"

Accepted, and this turned out to be the most useful item in the review.

The model was already settled: `jina-embeddings-v5-omni-small` via Elastic
Inference Service. But the review's observation that the sibling projects on this
machine point toward an on-prem path was worth following up, and it checks out:

- `jina_repo/jina-airgap/models/catalog.json` already carries
  `jina-embeddings-v5-omni-small` (1.74B parameters, 1024 dimensions, 32K
  context, approximately 8 GB memory, MLX-capable) and `-omni-nano`.
- Prebuilt CPU and GPU containers exist for both.
- The server exposes an OpenAI-compatible `/v1/embeddings` accepting base64 video
  and audio, capped by a `MAX_MEDIA_BYTES` constant in its own source.
- `jina-on-prem` additionally ships `docker-compose.macbook.yml` and
  `launch-macbook.sh`, so the Apple Silicon path is already paved.
- Weights are not downloaded; `models/` holds only the catalog.

This matters more than it first appears. The dominant constraint on this project
is the 1 MB binary input ceiling on Elasticsearch Serverless. A self-hosted
server removes that ceiling entirely, which makes it both an escape hatch and a
budget-free baseline for measuring how much retrieval quality the ceiling
actually costs.

Added as a third provider, `local`, in FR-9 and constraint C2, with the
CC-BY-NC-4.0 licence limitation and the CPU latency caveat recorded. It is not
the default: the requested architecture is Elastic Serverless plus EIS, and the
provider interface makes this a single adapter file rather than a fork in the
design.

`onnx_jina` was also inspected. It is a small Flask-and-ONNX wrapper predating
the v5 models, with no multimodal or video path. Nothing to reuse.

### "Input formats, expected scale/throughput, and latency targets"

Input formats were covered. Scale, throughput, and latency were genuinely absent.
Now added as NFR-8, NFR-9, and NFR-10:

- an explicit scale envelope, roughly 20 videos and 2,000 chunks, files up to
  2 GB, duration up to two hours, with the point at which the in-process job
  runner should be replaced by a real queue stated rather than discovered;
- latency and throughput framed as "measure and record" rather than invented
  figures, because the numbers are unknowable before the phase 2 probe. The one
  hard target is that search feels interactive, under two seconds end to end;
- a stated expectation that ingestion is inference-bound rather than
  encode-bound, with the instruction to optimise the ladder search if
  measurement contradicts it;
- a requirement that the import page shows estimated window and inference-call
  counts before the user commits, since a two-hour video becomes roughly 240
  inference calls.

### "Output contract: dimensions, frame-level vs clip-level vs whole-video"

Already covered and unchanged: 1024 dimensions, window-level (not frame-level,
not whole-video), two vectors per window, one visual and one audio. The reason
whole-video embeddings are wrong here is documented: the model samples at most 32
frames, so a single vector for a feature film matches almost any query.

### "Serving approach and deployment target"

Deployment target was missing entirely. Now NFR-7 and a dedicated plan section:
single developer machine, macOS on Apple Silicon, `npm run dev` or `next start`.
ffmpeg and ffprobe are host dependencies from `PATH`, which is called out as the
one thing needing attention if this is ever containerised, since it is the only
non-npm dependency.

The review framed serving as an ONNX/Docker/GPU question. That framing fits the
sibling projects but not this one: inference is a hosted service call, so there
is no model to serve. It becomes relevant only on the optional `local` path,
where the prebuilt container answers it.

### "Storage/indexing design"

Already covered: two indices, explicit `dense_vector` fields at 1024 dimensions
with cosine similarity and `bbq_hnsw`, plus the reasoning for choosing explicit
vectors over the `semantic` field type, which would retain every base64 data URL
in `_source`.

### "Acceptance criteria per task"

Accepted. The todo had tasks and milestones but no way to tell whether a phase
was actually finished. Every phase now carries an acceptance criterion, and they
are written to be falsifiable rather than agreeable. Examples:

- phase 3: running the setup script twice leaves the cluster unchanged the second
  time;
- phase 4: the same text embedded through any two providers yields cosine
  similarity above 0.99, proving the vectors really are interchangeable;
- phase 6: a URL resolving to a private range is refused, and a local path
  escaping its root via symlink is refused;
- phase 7: ingesting the same video twice leaves the chunk count unchanged.

## Findings not adopted

**"Copy documents here if they were written in a previous session or live
elsewhere."** They did not exist anywhere. They were written from scratch.

**Extending `onnx_jina` or `jina-on-prem` to video as the basis for the technical
spec.** Reasonable given an empty directory and no other context, but the
requirement is a website backed by Elastic Serverless, not a model-serving
project. The one genuinely reusable piece from those repositories, the omni
container, has been adopted as the optional `local` provider. Their Docker,
Kubernetes, and air-gap deployment scaffolding solves a problem this project does
not have.

## Net effect on the plan

- One new provider implementation, `local.ts`, plus two configuration values.
- Four new non-functional requirements and one new constraint.
- README moved from phase 11 to phase 1.
- Acceptance criteria on all eleven phases.
- No change to the architecture, the data model, the chunking strategy, or the
  dual-track embedding approach.
