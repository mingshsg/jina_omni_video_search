# Hybrid metadata search — round-3 implementation-readiness review

Reviewed 2026-09-22 against `plan/03-hybrid-metadata-search-plan.md` at `edf1d02`
(SHA-256 `61e612510e0e346f93ad0dfab036e871498ec86e11c5db669d3692b4f3f79810`).
This supersedes the round-2 readiness verdict for the expanded design. The
country/region catalog is appropriately short: eight selected EU, CN/HK/TW/KR/JP,
six ASEAN, and US for the existing demo. No expansion is needed.

**Verdict: not ready to implement end to end as written.** The core asset/chunk
architecture is reasonable, but Phase 1 has an undeployable catalog and an
ambiguous actor write contract. Phase 2/3 have an eligibility discrepancy and
a candidate-recall guarantee the proposed query cannot satisfy. The parser and
semantic-asset additions have later-phase contradictions. These are plan fixes,
not evidence that the hybrid approach is unsound.

## Findings, in implementation order

### G1 — P1, Phase 1: the versioned person catalog cannot ship at its planned path

The plan calls `data/people.json` a versioned file (lines 75–88, 968), and the
Phase-1 todo requires it. `.gitignore:9` ignores `data/**`; `git check-ignore -v
data/people.json` confirms it. `.dockerignore` also excludes `data`; the runner
only copies the Next standalone output and public/static assets
(`Dockerfile:43–45`). Compose mounts media over `/app/data`
(`docker-compose.yml:31–33`). A developer's local file would therefore be
neither committed nor available in the deployed web server.

**Fix:** move the catalog to a versioned configuration/resource path outside
`data/`, explicitly package or trace it into the standalone runner, and test
catalog load, autocomplete, and metadata save inside the built container. Keep
runtime media under `data/`.

### G2 — P1, Phase 1/2: actor identity has conflicting wire semantics

The editor stores catalog IDs (lines 88–94), and `meta.actor_ids` is the only
actor facet field. Yet line 157 says the server never accepts client-supplied
`actor_ids`; the search request example sends `filters.actors: ["Audrey
Hepburn"]` (lines 737–755), with a note about normalized actor keys. A name
is not a stable ID and may resolve to multiple people. The PATCH request and
response shapes do not settle this.

**Fix:** specify exact GET/PATCH/search DTOs. Prefer a selected person ID from
autocomplete as the editable actor identity; validate IDs against the catalog,
then derive display spelling/aliases/keys server-side. If input may be a name,
specify unique resolution, ambiguous-name error, unknown-name error, and
backward compatibility. Define whether selected actors use ANY or ALL and
test cross-script selection.

### G3 — P1, Phase 1: metadata PATCH can conflict with ingest despite unchanged metadata revision

The plan correctly avoids document-level `if_seq_no` for editorial conflicts,
but says the metadata PATCH must never use `retry_on_conflict` and that ingest
progress cannot cause an editorial conflict (lines 689–716). Elasticsearch
`_update` is a read-modify-write operation; two updates to the same document
can race at the underlying document version even if they touch disjoint
fields. With no retry, an ingest update can cause an incidental 409 to the
editor whose `meta.revision` remains unchanged.

**Fix:** distinguish transport/version conflicts from a genuine stale
`expected_revision`. Use a bounded retry that re-evaluates the scripted
revision guard on each attempt (or retry only after re-reading the unchanged
revision). Return 409 for an actual metadata-revision mismatch, and test
interleaved ingest/editor writes. See [Elasticsearch Update API](https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-update)
for `retry_on_conflict` and [optimistic concurrency](https://www.elastic.co/docs/reference/elasticsearch/rest-apis/optimistic-concurrency-control).

### G4 — P1, Phase 2/3: unfiltered hybrid requests can show an unready asset

Step 1 (lines 205–219) enumerates only assets with the requested **ready**
variant, but omits that ID filter if there are no selected facets. The chunk
index carries `variant_id` but no ready status (`lib/es/indices.ts:97–115`).
Thus the global chunk path can surface leftover or in-progress chunks for an
unready asset, while the BM25 path enforces ready. This contradicts the stated
eligibility and produces different visibility solely from adding a facet.

**Fix:** either always apply the complete ready-ID allow-list on the hybrid
global path, or explicitly define and test a different visibility contract
for the unfiltered path. If omitting the filter for latency, prove another
reliable readiness guard rather than assuming `variant_id` implies ready.

### G5 — P1, Phase 3: pooled lexical kNN does not guarantee BM25-asset recall

Step 3 (lines 235–249) takes one kNN over `A` lexical assets with `k=5A`,
then caps five results per asset. All `5A` returned chunks could belong to
one asset; a BM25 rank-1 asset can receive zero candidates even though it has
ready chunks. Capping after retrieval cannot restore absent candidates. The
required functional gate (lines 1009–1011) explicitly expects a top BM25
asset missing from global kNN to contribute candidate moments. Treating
per-asset msearch as a fallback *if testing shows starvation* contradicts
that required guarantee.

**Fix:** guarantee a small minimum per selected BM25 asset (for example,
bounded per-asset kNN/msearch), then optionally fill the remaining budget
with a pooled query; or weaken the acceptance contract and explicitly accept
starvation. Count real ES executions and measure p95 at the guaranteed budget.

### G6 — P1, Phase 3: name-only behavior has no detector before the parser exists

Section C3 (lines 570–578) requires `scene_terms_present=false` and reduced
vector weight in Phase 3, before the dictionary matcher is built in Phase
3.5. The default and explicit `parse_query=false` paths skip all parsing
(lines 763–788), yet the Phase-3 acceptance gate requires name-only handling
(lines 1038–1041). Phase 3 cannot set this flag from the defined raw-query
path. Reducing vector weight also does not make a name-derived timestamp
evidence of that person's presence.

**Fix:** add conservative exact full-query name detection to Phase 3, clearly
outside the optional parser, and test it with parsing off; or move the
name-only specialization to Phase 3.5 and give all unparsed hits the generic
asset-versus-scene evidence disclaimer. In either case, never attach a person
claim to a window without time-coded evidence.

### G7 — P2, Phase 3.5/3.6: Rule 0 forbids the effects the parser is designed to have

Rule 0 (lines 394–408) says the parser never participates in retrieval or
ranking and no generated output ever reaches a score or rank. But it emits
`vector_query` and `free_text`, and Rule 1 applies extracted facets as rank
boosts (lines 410–417). The acceptance text correctly admits retrieval inputs
and boosts differ (lines 1042–1045). The current wording would cause either
an impossible test or an implementation that ignores useful parsing.

**Fix:** say the parser cannot inspect results, directly assign scores, or
generate card prose. Its validated query structure *does* alter retrieval
inputs and deterministic scoring. Specify per-facet boost formula/weights,
precedence against hand-selected filters, and whether the response's applied
structure includes values that had no effect. Update the English plan, Chinese
summary, and todo together.

### G8 — P2, Phase 3.5: description embeddings need a revision-safe lifecycle

Embedding description+abstract on save (lines 298–331) is sensible, but a
slow inference can finish after a newer edit. Without a revision guard, an
old embedding can overwrite a new description's vector; an inference failure
can leave a previous vector searchable for the new text. Provider invalidation
alone does not cover this. **Fix:** tie the vector and model identity to the
metadata revision/content digest; clear or mark it stale on change, publish
only if the source revision still matches, and search only current vectors.
Specify save behavior on inference timeout/error and test two rapid edits.

## Readiness and evidence

| Phase | Gate |
| --- | --- |
| 0/1, schema and editor | Resolve G1–G3; probe analyzers on the target project before fixing mapping. Independent mapping experiments and evaluation-fixture preparation can start. |
| 2, facets | Resolve G2 and G4; test ready/unready/failed variants, full ID set, zero results and overflow. |
| 3, hybrid | Resolve G4–G6 and freeze the labeled video/time-window set before tuning. Keep both candidate paths and the separate asset/scene evidence labels. |
| 3.5/3.6, optional parsing/semantic assets | Resolve G7–G8 and probe the actual EIS endpoint and analyzer availability before enabling. The typed `client.inference.completion` request/response shape exists in the installed client. |

**PASS (static):** current mapping/write/search contracts inspected; `git
check-ignore` confirms G1; installed Elasticsearch client types confirm the
`completion` method and `completion[0].result`; country selector matches the
requested compact scope; prior round-2 fixes remain in the plan.

**NOT RUN:** hybrid implementation, target-cluster analyzer probe, EIS
endpoint, populated-index migration, concurrent-write test, built-container
catalog load, labeled relevance, browser E2E, or p95 latency. This is an
implementation gate on a plan, not a product-readiness assertion. The
`analysis-phonetic` availability is deliberately conditional: [Elastic plugin
management](https://www.elastic.co/docs/reference/elasticsearch/plugins/plugin-management)
says Serverless bundles core analysis plugins but cannot install arbitrary
plugins; verify the exact analyzers on this target before freezing mappings.
