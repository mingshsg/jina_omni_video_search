# Suggest agent tool-call trace — implementation checklist

Plan: [`plan/07-suggest-tool-call-trace.md`](../plan/07-suggest-tool-call-trace.md).
Requested directly by the user (not a review finding), as a follow-up to
`todo/23-actor-name-and-suggest-ui-2026-09-23.md`'s live verification pass.

- [x] Investigated whether the Agent Builder converse response exposes a
      tool-call trace at all — yes, via a throwaway script hitting
      `/api/agent_builder/converse` directly and dumping `body.steps`
      (`type: 'tool_call'`, `tool_id`, `params.query`/`params.question`/
      `params.url`). Script deleted after use; superseded by the shipped
      `extractToolTrace()`.
- [x] `lib/metadata/agent-builder-suggest.ts`: new `AgentToolTraceEntry`
      type, new `extractToolTrace()` (defensive, never throws, drops the
      `load_skill` bookkeeping call), new optional `onTrace` callback on
      `converseSuggestAgent()` — purely additive, no existing call site
      needed to change.
- [x] `lib/metadata/suggest-web.ts`: `SuggestWebMeta.tool_trace`, new
      `toolTrace` param on `applyAgentPayloadToLocal()`, wired through
      `enrichViaAgentBuilder()`.
- [x] `app/api/library/[videoId]/meta/suggest/route.ts`: no change needed
      — `web: enriched.web ?? null` already forwards the whole object.
- [x] `components/EditMetadataFlyout.tsx`: new `toolTrace` state (reset on
      both fresh-load and new-suggest), new collapsed-by-default
      `EuiAccordion` rendered after the actor-candidates block, showing
      per-call query/question/url. New i18n keys added (EN + ZH):
      `metaSuggestTraceTitle`, `metaSuggestTraceSearch`,
      `metaSuggestTraceRead`, `metaSuggestTraceQuestion`.
- [x] `scripts/smoke-suggest-agent.ts`: now captures and prints
      `tool_trace` via the new `onTrace` callback — this is the tool the
      user (or a future session) should re-run to check agent behavior;
      no separate debug script needed.
- [x] New tests: `lib/metadata/agent-builder-suggest.test.ts` — 2 tests for
      `extractToolTrace` (happy path incl. `load_skill` filtering;
      defensive behavior on `null`/`{}`/non-array `steps`/missing
      `params`). `lib/metadata/suggest-web.test.ts` — 2 tests for
      `applyAgentPayloadToLocal` (`toolTrace` passed through to
      `web.tool_trace`; absent when not provided).
- [x] `yarn test` — 402/402 passed (62 files; +4 vs. the 398 baseline in
      `todo/23`).
- [x] `yarn build` — passed.
- [x] `diagnostics` on `components/EditMetadataFlyout.tsx` — no new
      warnings.
- [x] Live re-verification: `yarn tsx scripts/smoke-suggest-agent.ts
      "琅琊榜"` — PASS, 26.69s, `tool_trace` shows a `jina.read_url` call
      with a populated `question` field, directly confirming (not
      inferring) that the live agent follows the `question`-scoped
      instructions from `reference/agent-builder/skill-grounded_title_lookup.md`.
      This resolves the "STILL NOT VERIFIABLE from this script" item in
      `todo/23-actor-name-and-suggest-ui-2026-09-23.md`.

## Explicitly NOT done

- [ ] **NOT RUN** — no browser/manual QA of the new accordion in a real
      browser session.
- [ ] **NOT RUN** — no check of how the trace UI behaves when
      `tool_trace` is very long (e.g. a title that triggers many
      ambiguity-resolution searches) — no length cap was added to the
      accordion rendering; if this becomes a real problem, truncate with
      a "show more" affordance rather than always rendering every entry.
