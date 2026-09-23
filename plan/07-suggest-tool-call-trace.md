# Suggest agent tool-call trace — plan

Requested directly by the user after the live smoke test in
`todo/23-actor-name-and-suggest-ui-2026-09-23.md`: "我们有办法拿到明细吗？
界面上有变动会比较好" (can we get the details? it'd be good to have this
show up in the interface). Follows PR-D/E/F from
`plan/06-actor-name-generalization-and-suggest-ui.md`.

## Goal

Two things were previously true and both are fixed by this change:

1. `smoke-suggest-agent.ts` could not show whether the live agent actually
   scoped its `read_url` calls with a `question` argument — the converse
   API only returned the final structured JSON, not the intermediate
   tool-call steps, so this was inferred from timing, not observed.
2. The Suggest UI (`EditMetadataFlyout`) gave users no visibility into what
   the agent actually searched for and read while researching a
   suggestion — only the final result.

## What was investigated first

A throwaway script (`scripts/_inspect-trace.ts`, deleted after use) called
`/api/agent_builder/converse` directly and dumped the raw response body's
`steps` array. This confirmed Kibana Agent Builder's converse response
already includes a `steps` array with `type: 'tool_call'` entries carrying
`tool_id` and `params` (e.g. `jina.search_web` → `{ query }`,
`jina.read_url` → `{ question, url }`). This is not a documented/stable
part of the Agent Builder API surface, so the production extraction is
defensive (never throws, degrades to an empty array).

## What changed

- `lib/metadata/agent-builder-suggest.ts`:
  - New exported type `AgentToolTraceEntry { tool_id; query?; question?;
    url? }`.
  - New exported `extractToolTrace(body): AgentToolTraceEntry[]` — reads
    `body.steps`, keeps only `type === 'tool_call'` entries, drops the
    `load_skill` bookkeeping call, copies `query`/`question`/`url` from
    `params` when present. Returns `[]` on any unexpected shape.
  - `converseSuggestAgent()` gained an optional `onTrace?: (trace) => void`
    callback, invoked (best-effort, swallowing its own errors) right after
    the response body is parsed, before the existing message-extraction /
    payload-parsing logic. The existing return type and all other call
    sites are unchanged — this is purely additive.
- `lib/metadata/suggest-web.ts`:
  - `SuggestWebMeta` gained `tool_trace?: AgentToolTraceEntry[]`.
  - `applyAgentPayloadToLocal()` gained an optional `toolTrace` param,
    threaded straight into the returned `web.tool_trace`.
  - `enrichViaAgentBuilder()` passes `onTrace` to `converseSuggestAgent()`
    and forwards the captured trace into `applyAgentPayloadToLocal()`.
  - The local-only and jina-rest-direct providers do not populate
    `tool_trace` (no equivalent multi-step agent loop to trace) — the field
    is simply absent for those paths, which the UI treats as "nothing to
    show".
- `app/api/library/[videoId]/meta/suggest/route.ts`: no change needed —
  `web: enriched.web ?? null` already forwards the whole object, so
  `tool_trace` reaches the client automatically.
- `components/EditMetadataFlyout.tsx`:
  - New `SuggestToolTraceEntry` type mirroring the server shape.
  - New `toolTrace` state, reset alongside `actorCandidates` on both
    `applyDto` (fresh load) and `onSuggest` (new request), populated from
    `data.web?.tool_trace` when a suggestion job completes.
  - New collapsed-by-default `EuiAccordion` ("Research call trace" /
    "本次调用明细"), rendered directly after the actor-candidates block,
    listing each trace entry: `search_web` shows the query text,
    `read_url` shows the target URL (as a link) and the question that
    scoped the read.
  - New i18n keys (EN + ZH): `metaSuggestTraceTitle`, `metaSuggestTraceSearch`,
    `metaSuggestTraceRead`, `metaSuggestTraceQuestion`.
- `scripts/smoke-suggest-agent.ts`: now passes `onTrace` and prints the
  captured trace as `tool_trace` in its JSON output, so a single command
  gives both the structured result and directly-observed evidence of how
  it was produced — no separate throwaway script needed going forward.

## Verification run in this pass

- `yarn tsx scripts/smoke-suggest-agent.ts "琅琊榜"` — PASS, 26.69s. Printed
  `tool_trace` showed one `jina.search_web` call (`query`) and one
  `jina.read_url` call with both `question` and `url` populated — direct,
  reproducible confirmation that the live agent scopes reads with
  `question` as the skill instructs.
- `yarn test` — 402/402 passed (62 files; +4 new tests: 2 for
  `extractToolTrace` covering the happy path and defensive malformed-input
  handling, 2 for `applyAgentPayloadToLocal` covering trace pass-through
  and trace-absent behavior).
- `yarn build` — passed.
- `diagnostics` on `components/EditMetadataFlyout.tsx` — no new warnings
  (only the pre-existing "Props must be serializable" ones).

## Explicitly NOT verified in this pass

- No browser/manual QA of the new accordion — verified only by
  compilation and the (unrelated) automated test suite, consistent with
  `vitest.config.ts` only covering `lib/**`/`worker/**`.
- No measurement of how often `tool_trace` ends up empty in practice due
  to the converse response shape drifting (the extraction is defensive by
  design, but "defensive" means "silently returns less detail", not
  "alerts on drift" — there is no test against a real future Kibana
  release, only against the shape observed today).
- The one-off investigation script (`scripts/_inspect-trace.ts`) was
  deleted after confirming the `steps` shape — its logic was superseded by
  the production `extractToolTrace()` path, which is what actually shipped
  and what the smoke test now exercises.
