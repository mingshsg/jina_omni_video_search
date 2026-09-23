# Hybrid Internet Suggest code review — 2026-09-23

## Verdict

**Not ready to sign off or enable as a user-facing external Suggest path.**

The dedicated Agent Builder agent, custom skill, and two Jina tools are live,
the local fallback is safe, and the repository test suite passes. The browser
path still cannot normally receive the live agent result, the adapter does not
enforce the agent output/source contract, grounded descriptions are shadowed by
the local placeholder, and multilingual actor candidates are not exposed for
review in the editor.

Review scope: current uncommitted Phase 4a/4b Suggest implementation, including
the app route, Agent Builder adapter/provisioning, title cleanup, people catalog,
editor merge/save behavior, tests, and `plan/04-internet-grounded-metadata-suggest.md`.

## Findings

### R5-01 — P1 — Browser timeout makes the live agent result unreachable

`components/EditMetadataFlyout.tsx:28,347` aborts Suggest after 8 seconds, while
`lib/config.ts:171` gives Agent Builder 60 seconds. The measured direct Korean
and Chinese calls took 38.9s and 43.1s, and the rebuilt app-path request reached
60.0s. The editor therefore reports timeout before a successful direct agent
call could return.

The timeouts must share one end-to-end budget. Given the observed latency, the
recommended design is an asynchronous request/status result with cache, rather
than holding a browser request open for 40–60 seconds.

### R5-02 — P1 — Grounded description is shadowed by the local placeholder

`lib/metadata/suggest-local.ts:473-475` creates a description for every usable
title. `lib/metadata/suggest-web.ts:260-284` only installs the agent description
when there is no local description; otherwise it appends the URL to the local
evidence and keeps `Title clue: ...` as the value. The researched description
is therefore effectively unreachable for the normal case.

When the agent uniquely identifies a work and supplies an allowlisted, read-page
source, expose its description as a separate work-level proposal. Keep the local
title clue as fallback and label the distinction in the UI.

### R5-03 — P1 — Agent output is not validated or gated before use

`lib/metadata/agent-builder-suggest.ts:90-104` validates only the top-level
status and then casts the entire object. `lib/metadata/suggest-web.ts:225-299`
uses fields and actors regardless of whether status is `ambiguous`, `empty`, or
`unavailable`. It also accepts year/description facts without requiring an
allowlisted source URL.

This violates the skill contract and the plan's server-side trust boundary. A
strict bounded schema must reject additional/malformed data, cap arrays and
strings, require null fields for non-`ok` statuses, and apply proposals only for
`ok`.

### R5-04 — P1 — URL allowlisting does not require HTTPS and arbitrary candidates leak through

`lib/metadata/suggest-web.ts:124-129` checks only the hostname, so
`http://en.wikipedia.org/...` is accepted even though the policy requires
HTTPS. `lib/metadata/suggest-web.ts:225-239` returns non-allowlisted candidate
URLs to the client and merely labels them `allowlisted: false`. Field evidence
also embeds agent-provided URLs without validation.

Executable check: `isAllowlistedUrl('http://en.wikipedia.org/wiki/Test')`
returned `true`.

Reject non-HTTPS/non-allowlisted URLs at the adapter boundary and never include
them in candidates, reads, field evidence, or actor candidates.

### R5-05 — P1 — Multilingual actor candidates stop at the API

The API returns `web.actor_candidates`, but
`components/EditMetadataFlyout.tsx:77-88` does not model `web`, and the merge at
`components/EditMetadataFlyout.tsx:393-449` handles no actors. Users cannot see
the English/Chinese/Korean/Japanese names, supporting source, character, or the
resolved `person_id`.

Add an actor-candidate review section. Only a uniquely resolved existing
`person_id` may be selected for Save; unresolved candidates remain read-only
evidence for catalog curation.

### R5-06 — P1 — Exact alias resolution cannot detect catalog collisions

`lib/metadata/people.ts:116-125` stores one ID per alias in a `Map`; duplicate
aliases silently overwrite the earlier person. Consequently,
`lib/metadata/suggest-web.ts:91-105` may report one `matched_person_id` even when
the alias belongs to multiple catalog entries.

Reject duplicate normalized aliases when loading the catalog or index each
alias to a set of IDs and resolve only when the set contains exactly one ID.

### R5-07 — P2 — Cancel does not cancel the downstream Agent Builder call

The browser aborts its own fetch, but the route does not pass `request.signal`
through `enrichSuggestionsWithWeb`, and
`lib/metadata/agent-builder-suggest.ts:140-145` creates an independent abort
controller. A user cancel can leave the external request running until the
60-second timeout. The route also has no dedicated concurrency/rate gate or
result cache, although the plan requires all three.

Propagate cancellation through the adapter. Add a small concurrency limit,
per-client/demo rate limit, and normalized-title cache before enabling the
external provider by default.

### R5-08 — P2 — Suggest provenance is not auditable as specified

The plan requires `meta_revision`, request ID, retrieval time, structured source
URL/record ID, and field-level provenance. The response at
`app/api/library/[videoId]/meta/suggest/route.ts:108-116` omits the first three,
and `lib/metadata/validate.ts:137-142` stores only confidence plus a free-text
evidence string. Source URLs are embedded in that string and truncated.

Use structured bounded provenance fields and bind a proposal to the editor's
metadata revision. Preserve that structure only for fields the user accepts.

### R5-09 — P2 — Filename cleanup can remove a legitimate 11-character title word

`lib/metadata/suggest-local.ts:90-91,196-200` treats any terminal 11-character
ASCII token following a separator as a platform ID. A title such as
`Harry_Potter_Philosopher` loses `Philosopher`. The corpus-specific decoration
rules also need negative cases for real titles containing words such as
`Making`, `Costume`, or `Reaction`.

Executable check: `normalizeTitle('Harry_Potter_Philosopher')` returned
`Harry Potter`.

Require stronger ID evidence and add wrong-strip negatives to the labeled title
corpus before using the cleaned title as the external search key.

### R5-10 — P2 — Provisioning handles authentication and lookup errors as absence

`scripts/ensure-suggest-agent.ts:145-150` ignores `KIBANA_API_KEY` and always
uses the Elasticsearch key. At `:175-190` and `:228-241`, any GET status other
than 200 is treated as "not found" and triggers POST, including 401, 403, 429,
and 5xx responses.

Use `KIBANA_API_KEY || ELASTICSEARCH_API_KEY`; create only after 404, and fail
with a bounded error for every other lookup status.

### R5-11 — P2 — Tests do not cover the Agent Builder trust boundary or editor path

The 58-file/344-test suite passes, but `suggest-web.test.ts` covers helper
selection/year/actor normalization only. There are no tests for the converse
response schema, non-`ok` status gating, HTTPS/allowlist rejection, grounded
description precedence, cancellation propagation, UI timeout/result merge, or
actor-candidate selection.

Add these tests before changing the provider default or claiming Phase 4b
acceptance.

### R5-12 — P3 — Repository status documents describe a superseded implementation state

`AGENTS.md:19-21,114-121` and the Phase 4b text in
`todo/02-hybrid-metadata-search-todo.md` still say Hybrid/Internet Suggest is not
implemented. The current tree contains Phase 1–4 code and a live dedicated
agent. This can make later agents skip necessary reviews or repeat completed
work.

Refresh the status summary after the current changes are stabilized; keep the
historical review files unchanged.

## Verification

- `yarn test`: **PASS**, 58 files / 344 tests on 2026-09-23.
- `yarn build`: **PASS** earlier in this implementation run; the final Docker
  rebuild also completed and recreated the app container.
- Container `GET /api/library`: **PASS**, HTTP 200.
- Direct Agent Builder smokes: Korean and Chinese **PASS** at 38.9s / 43.1s.
- Rebuilt application Suggest smoke: safe local fallback **PASS**, external
  result **TIMEOUT** at 60.0s.
- Browser acceptance, wrong-title/ambiguity corpus, source audit, p95/cost,
  concurrency, and saved actor-candidate flow: **NOT RUN / OPEN**.

## Recommended implementation order

1. Put the current 87-item working tree on a dedicated feature branch and split
   changes by concern before adding more implementation.
2. Replace the synchronous 8s/60s mismatch with a single bounded asynchronous
   Suggest contract, cancellation propagation, concurrency/rate control, and
   cache.
3. Add strict agent response validation, status gating, HTTPS allowlisting, and
   bounded structured provenance.
4. Make the grounded work description an actual proposal, then add the actor
   candidate review/selection UI with collision-safe identity resolution.
5. Add adapter/UI tests and the Chinese/Korean labeled corpus; measure accuracy,
   abstention, p50/p95, call count, and cost.
6. Re-run indexed POST→PATCH→GET→hybrid-search, browser, mapping, file/image/live
   regression, and container gates before sign-off.
