# Suggest pipeline — independent code review, 2026-09-23

Scope: the edit-time **Suggest** path, which no prior review covered:
`lib/metadata/{suggest-web,agent-builder-suggest,suggest-jobs,suggest-local,description-embed}.ts`,
`app/api/library/[videoId]/meta/**`, `app/api/metadata/**`, and the parts of
`components/EditMetadataFlyout.tsx` that consume them. Read-only; nothing was
modified. Gates at review time: `yarn test` 62 files / 423 tests PASS.

**Verdict: the write-safety design holds, but the trust boundary does not.**
Suggest correctly never writes, cancellation is safe, and no secrets leak.
However an agent that reads arbitrary web pages has three paths by which
untrusted content reaches the operator wearing the costume of a grounded
answer, and one unauthenticated route lets model-derived strings reach durable
shared state that feeds the search hot path.

## Process finding — the three P1s in `todo/22` are open and have been built over

`reviews/hybrid-code-recheck-2026-09-23.md` independently re-confirmed all
three P1 findings from `todo/22` against the same file:line. Verified again in
this pass, all three remain **unfixed**:

| `todo/22` | Status now |
| --- | --- |
| F1 — floor `msearch` sends `retriever`, `as never` suppresses the type error | `hybrid-search.ts:398`, `:429` — unchanged |
| F2 — a matched actor strips the rest of the query from BM25 | `query-parse.ts` `freeParts` — unchanged |
| F3 — five silent `catch` blocks, no logging | `grep -c "console\.\|logger" lib/es/hybrid-search.ts` → **0** |

Since that review, six new plans (`plan/06`–`plan/11`), seven new trackers
(`todo/23`–`todo/29`) and ~20 code files were added, including a new
`semantic_text` description-search axis. The unverified retrieval floor now
sits underneath more surface than it did.

## P1

### S1 — Provider outage, timeout and malformed output are shown to the operator as a successful suggestion

`lib/metadata/suggest-web.ts:573-592`, `app/api/library/[videoId]/meta/suggest/route.ts:166-177`, `components/EditMetadataFlyout.tsx:126`

`enrichViaAgentBuilder` converts every failure into a resolved value with
`web.status: 'unavailable'`. The route then labels the job by draft count
alone (`status: count === 0 ? 'empty' : 'ok'`), and the client declares a
`status` union at line 126 but **never reads `data.web.status` or
`data.web.reason`**.

With Kibana down, the agent timing out at 60s, or unparseable model output,
the operator sees HTTP 200, the "suggestions applied" callout, and local
title-clue values — with no indication that no research happened. Nothing logs
it either. Design rule 7 requires failure to surface clearly; it is currently
invisible to both the operator and whoever runs the demo.

### S2 — An explicitly *ambiguous* agent answer is auto-applied as a 0.7-confidence work title

`lib/metadata/suggest-web.ts:256` vs `:272`, `components/EditMetadataFlyout.tsx:698-715`

`candidates` is assembled at line 256, **outside** the `payload.status === 'ok'`
guard at line 272 that gates fields and actor candidates. So `status:
'ambiguous'` — the agent explicitly declining to disambiguate — still ships a
populated candidate list. The client takes the first one and invents a
confidence:

```ts
const topCandidateTitle = data.web?.candidates?.[0]?.title?.trim();
if (topCandidateTitle) {
  const workTitleDraft: SuggestField = { value: topCandidateTitle, confidence: 0.7, ... };
```

The `0.7` exists nowhere in the payload; it is fabricated in the view layer.
The candidate's `reason` — the model's *disambiguation rationale* — is
repurposed as supporting `evidence`. This inverts the "unknown over guess"
rule: an abstention is rendered as a confident answer and can be saved with
`confirmed: true`.

Secondary: under `SUGGEST_WEB_PROVIDER=jina`, `candidates[].title` is a
search-result page title (`suggest-web.ts:615-624`), so this writes values like
`Oldboy (2003 film) - Wikipedia` into `work_title.en`.

### S3 — Untrusted fetched page content can be parsed as the agent's structured answer

`lib/metadata/agent-builder-suggest.ts:534-565`

When `response.message` is absent the extractor walks steps backwards and will
accept a raw tool result:

```ts
if (typeof content === 'string' && content.includes('"status"') && content.includes('{')) {
  return content;   // Jina Reader output = arbitrary web page text
}
```

The loop above it accepts any step's `message|content|text|output` containing
braces, with no `step.type` filter. A page embedding a plausible
`{"status":"ok","fields":{...}}` blob is then parsed as the payload,
**bypassing the model entirely**. The precondition is that primary extraction
fails, which is not directly attacker-controlled — but injected instructions
can plausibly steer the agent into ending on a tool call, and the second branch
is by design reading tool-result content. Controlled fields are
catalog-checked, so the blast radius is `description`/`abstract`/`tags`/
`actors`/`notes` — the entire prose surface of the record.

## P2

| # | Location | Problem |
| --- | --- | --- |
| S4 | `agent-builder-suggest.ts:592`, `EditMetadataFlyout.tsx:1514` | `entry.url = p.url` takes a **model-emitted tool-call parameter** with no scheme check, no allowlist, no length bound, and renders it as `<a href={entry.url}>`. Every other URL on this screen is validated (`source_url` by zod `.startsWith('https://')`, `candidate.url` by `isNameAllowlistedUrl`). An off-allowlist URL inside a trusted "what the agent read" panel is a clean phishing surface; on React 18.3.1 a `javascript:` href still renders with only a dev warning. |
| S5 | `agent-builder-suggest.ts:255-293` | `extractBalancedJsonObjects` is O(n²): the inner loop runs to EOF when braces never balance. The 100 KB cap at `:663` bounds *n* but not the quadratic — ~5×10⁹ iterations stalls the single Node event loop for the whole app, not just this request. Reachable because the converse body echoes fetched page text. |
| S6 | `suggest-web.ts:279-290` | Citations are unverified. `cited()` checks only that the payload contains *some* allowlisted URL string — nothing fetches `field.url` to confirm the value came from that page. A poisoned source can attach `https://en.wikipedia.org/wiki/<anything>` to arbitrary prose, and the UI renders it as a percentage plus a clickable source link — precisely the affordance that makes an operator click Save. Requiring a citation without verifying it converts a weak signal into a strong-looking one. |
| S7 | `app/api/metadata/catalogs/people/route.ts:33`, `lib/metadata/people.ts:348-423` | `POST /api/metadata/catalogs/people` rewrites the whole versioned `config/people.json` with **no auth, no rate limit, no size cap**. Validation is length + alias-uniqueness only. Those aliases feed `findContainedAliases` in the **search query-parsing hot path**, so a short or common alias — an agent hallucination accepted via "Add to catalog" one click away — silently injects an actor filter into every subsequent query for all users. There is no removal path. This is the one place unvalidated model output reaches durable shared state. |
| S8 | `app/api/library/[videoId]/meta/suggest/route.ts:59-62` | Rate limit is keyed on `x-forwarded-for`, which is caller-supplied with no trusted-proxy normalization and no auth anywhere in `app/api`. Varying the header defeats `RATE_MAX=6/60s` entirely, leaving `MAX_ACTIVE=2` as the only throttle on outbound LLM + Jina spend. |

## P3

1. **Draft-merge safety lives only in the React component.** `applyAgentPayloadToLocal` never sees `input.draft`; `shouldPreferAgentField({local: undefined})` returns `true` (`suggest-web.ts:224`). Only `EditMetadataFlyout.tsx:631-694`'s `snapshot.*Empty && cur.* === ''` prevents an overwrite. The server accepts a `draft` argument the enrichment path ignores — any second consumer of this endpoint loses rule 2 silently.
2. **Orphaned jobs on rapid re-click** — the abandoned run's `catch` returns at `EditMetadataFlyout.tsx:742` *before* the `DELETE` at `:745`, so the job runs the full agent call and holds one of two `MAX_ACTIVE` slots.
3. **Client poll cap decoupled from server config** — hardcoded `120_000` (`:562`) vs operator-settable `SUGGEST_WEB_TIMEOUT_MS` (default 60s) *plus* queue wait. Raising the server timeout past 120s makes the client always give up first.
4. **`description-embed.ts:85-119`** reports an intentional clear as `state: 'failed'` — an asset with deliberately empty prose is indistinguishable from a provider outage. Adjacent: `asset-meta.ts:321-331` races an 8s soft timeout then schedules a second `run()` without cancelling the first — two concurrent embed calls per slow response.
5. **`pickReadableCandidates` scores empty titles** — `''.includes('')` is `true`, so every untitled hit scores 3 and burns a Reader call (`suggest-web.ts:475`).
6. **Filesystem paths leak** in `catalogs/route.ts:20-27` and `catalogs/people/route.ts:72-76` (raw `err.message`), inconsistent with `meta/route.ts:105` which redacts.
7. Unhandled rejections from `void fetch(...)` without `.catch()` (`EditMetadataFlyout.tsx:413, 486, 746`).
8. Orphan `people.json.tmp-*` files if `writeFileSync` throws (`people.ts:348-353`).
9. Rate limit runs *after* the ES read (`suggest/route.ts:143` vs `:127`).

## Correctly implemented — verified, no action

- **Rule 1, Suggest never writes.** Every call in the job closure
  (`suggest/route.ts:159-178`) is a read or an enrichment; no ES write exists
  in the suggest path.
- **Cancellation and late arrival.** `cancelSuggestJob` aborts the controller
  and both `.then`/`.catch` guard on `job.status !== 'pending'`
  (`suggest-jobs.ts:171-195`); the client additionally rejects a result whose
  `meta_revision` moved. The saved record is untouched in every path.
- **Rule 4, no secrets.** No `console.*` in the reviewed files;
  `AgentBuilderError` carries only a code; the route collapses everything to
  `META_SUGGEST_FAILED`.
- **Rule 6, catalog validation** for year/country/language/video_type before
  the draft is built (`suggest-web.ts:292-373`), plus a `superRefine` rejecting
  proposals on non-`ok` status.
- **SSRF in the Jina REST path** — URLs allowlisted before the read and
  re-checked on `page.url` after redirect; `isUrlAllowlisted` requires `https:`
  and a dot-anchored suffix, so `evil-wikipedia.org` does not pass.
- **Cache hygiene** — only `web.status === 'ok'` results are cached, so an
  outage cannot pin the UI to a local fallback.

## Checked and rejected

- `addPersonToCatalog`'s read-modify-write looks like a lost-update race, but
  the function is fully synchronous (`readFileSync`/`writeFileSync`/
  `renameSync`) so it cannot interleave in-process; the cross-process case is
  documented at `people.ts:361-362`.
- `extractConsensusYear` guards both the empty and tied cases
  (`suggest-web.ts:511-514`).
- React escapes the untrusted *text* it renders (actor names, evidence,
  notes, trace queries). Only `href` attributes are exposed — see S4.

## Gates

| Gate | Result |
| --- | --- |
| `yarn test` | **PASS** — 62 files, 423 tests |
| Live Kibana / Agent Builder converse | **NOT RUN** — the response-shape claims in S3 are inferred from the code's own defensive comments and `agent-builder-suggest.test.ts:273-299`, not from a captured live body |
| `yarn build`, browser E2E, prompt-injection fixture, live floor `msearch` | **NOT RUN** |

Follow-up tracker: [`todo/30-suggest-pipeline-review-2026-09-23.md`](../todo/30-suggest-pipeline-review-2026-09-23.md).
