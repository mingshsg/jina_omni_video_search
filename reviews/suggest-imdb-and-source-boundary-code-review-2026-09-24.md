# Suggest source boundary and IMDb fallback code review — 2026-09-24

Scope: current `live-video-search` working tree, Suggest source selection and
Agent Builder skill, metadata URL persistence, uncited drafts, and the person
alias editor. Reviewed against the user decision to keep IMDb as a disabled
backup until applicable licensed access exists.

**Verdict: IMDb is removed from the app's Reader allowlist and the live Agent instructions, but the Agent's generic `read_url` tool has no visible domain restriction; this and raw URL persistence are P1 release blockers.**

> **Disposition (2026-09-24):** R1 and R3 fixed same day; R2 was already
> fixed in the original pass; **R0 closed as accepted** (connector-level
> enforcement is outside this repo and the user accepts prompt-level
> instruction + app-side rejection — it must simply never be *described* as
> a network block); **R4 closed as accepted** (the field is a reference
> trail, not an audit log). Only R5 (canonical actor names can be made
> unfindable) remains open and unfixed. See
> [`todo/33`](../todo/33-suggest-imdb-and-source-boundary-2026-09-24.md).
> The body below is the evidence and is left as written.

## P1 — open

### R0. Agent instructions cannot mechanically block an IMDb tool call

The deployed skill says `"Do not call read_url on imdb.com"`
(`reference/agent-builder/skill-grounded_title_lookup.md:120-124`), and the
app rejects IMDb-sourced output (`lib/metadata/suggest-web.ts:374-393`). But
the assigned `jina.read_url` tool is a generic MCP call with only
`connector_id` and `tool_name` in its configuration
(`reference/agent-builder/tools-assigned-jina.json:2-13`); no URL allowlist is
visible there. A model could therefore call the tool before the app sees or
rejects its result. Do not describe the current setup as a guaranteed
network-level block. Before using the agent for unlicensed content, provide
an enforceable URL allowlist at the tool/proxy boundary, or verify and
document an existing connector-side restriction that covers the call.
No deliberate IMDb call was made in this review.

### R1. Raw source URLs can carry credentials into saved metadata and API responses

`lib/metadata/suggest-web.ts:263-277` collects model-controlled URLs with
`isRenderableTraceUrl(trimmed)` and then `out.push(trimmed)`. That gate only
checks HTTP(S) syntax (`lib/metadata/agent-builder-suggest.ts:618-627`), so a
URL with userinfo or a query token passes. The editor auto-fills the returned
`reference_urls` into empty drafts (`components/EditMetadataFlyout.tsx:789-802`).
The PATCH parser returns the same trimmed string in `softHttpUrl`
(`lib/metadata/validate.ts:166-176`), and `meta.reference_urls` is retained
in Elasticsearch `_source` despite `index: false`
(`lib/es/asset-meta-mapping.ts:70-76`). `softHttpsUrl` also preserves raw
userinfo/query/fragment for `source_url` (`lib/metadata/validate.ts:151-160`).
This violates the repo's no-secrets-in-indexed-documents/API-responses
invariant for URLs containing credentials. No real credential was used in this
review. Fix at the shared URL ingress and response boundaries; use a
safe-link policy that strips or rejects userinfo, query, and fragment (compare
`lib/ingest/url-sanitize.ts:10-26`), then cover both manual PATCH and agent
suggestion paths with synthetic-token tests. Decide how query-dependent page
URLs are represented so a sanitized link does not point to the wrong page.

## P1 — partially fixed in this pass

### R2. IMDb was an active Jina Reader source without licensed data access

The prior skill explicitly listed `imdb.com` among Phase 1 readable domains
and gave a worked IMDb read example; the local allowlist also permitted it.
IMDb's [Conditions of Use](https://www.imdb.com/conditions/) restrict automated
extraction absent permission, and its
[software-use guidance](https://help.imdb.com/article/imdb/general-information/can-i-use-imdb-data-in-my-software/G5JTRESSHJBBHTGX)
directs developers to permitted datasets or licensed access. Treating a Jina
page read for extracted metadata as an automated extraction is our inference
from those terms, not a legal determination. The user confirmed there is no
current license and selected a disabled backup design.

Disposition: `lib/metadata/suggest-web.ts:37-48` removes IMDb from the work
and name allowlists; `readField` drops IMDb-sourced drafts
(`lib/metadata/suggest-web.ts:374-393`), and `collectReferenceUrls` skips IMDb
(`lib/metadata/suggest-web.ts:266-277`). The deployed skill now says
"IMDb website reading is disabled" (`reference/agent-builder/skill-grounded_title_lookup.md:120-124`),
and the agent instructions mirror it (`reference/agent-builder/agent-instructions.md:8`).
`plan/04-internet-grounded-metadata-suggest.md:19` keeps IMDb as an inactive
licensed API/bulk option for a missing Wikipedia work or missing fields; any
future second work-level lookup needs its own bounded budget, because the
current Phase 2 is reserved for one actor's name. The live GET validation
returned `ok: true` for agent, skill, exact two-tool assignments, and Elastic
capabilities disabled (`reference/agent-builder/validation-summary.json`).
This verifies configuration consistency, not the absence of a future IMDb
tool call; R0 remains open.

## P2 — open

### R3. Uncited values enter empty fields automatically, and an arbitrary HTTPS URL is displayed as a source

The prior S6 decision deliberately kept uncited scalar values visible:
`lib/metadata/suggest-web.ts:386-393` uses `"[agent, uncited]"` and a confidence
discount rather than discarding them. That decision is preserved. However,
`citableSourceUrl` still accepts any `url.startsWith('https://')`
(`lib/metadata/suggest-web.ts:405-410`), and the test explicitly expects a
fan-blog URL to become `source_url` while the evidence says uncited
(`lib/metadata/suggest-web.test.ts:272-295`). The editor immediately inserts
the value into any empty field, for example `setCountry(String(...))`
(`components/EditMetadataFlyout.tsx:725-771`), and Save can persist it.
Keep the draft available, but separate uncited values from automatic insertion
or require an explicit per-field apply action. A URL outside the cited domain
policy should be shown as an unverified link, not a citation. Preserve the
manual review affordance chosen in S6.

### R4. Candidate URLs are labeled as pages consulted even when no page was read

`collectReferenceUrls` adds every `payload.candidates[].url`
(`lib/metadata/suggest-web.ts:289-290`), while the resulting suggestion says
`"[agent] pages consulted while researching this title"`
(`lib/metadata/suggest-web.ts:557-571`). Candidate entries may be search
results never opened by `read_url`; the current one-read Phase 1 budget makes
this likely when several candidates appear. Separate actual reads from search
hits using tool trace or use a neutral "research links" label, and do not
mark a search hit as evidence for a field.

### R5. Removing a canonical actor name can make that person unfindable by name

`setPersonAliases` accepts any nonempty replacement list and writes it
(`lib/metadata/people.ts:465-505`); `validatePeopleCatalog` checks structure
and alias uniqueness but does not require `display.en`, `display.zh`, or the
native display name among aliases (`lib/metadata/people.ts:90-114`). The
search alias index is built only from `entry.aliases`
(`lib/metadata/people.ts:142-153`), and the editor permits removing any alias
when at least two remain (`components/EditMetadataFlyout.tsx:1691-1754`).
A user can therefore leave a nickname as the sole alias while the UI still
displays a canonical English name that search will no longer recognize.
Preserve canonical names in the index or reject their removal; test English,
Chinese, and Korean/native display-name cases.

## Checked and not raised again

- IMDb URLs in `payload.candidates` are already filtered by the work-level
  allowlist before becoming work suggestions (`lib/metadata/suggest-web.ts:345-356`).
  The direct Jina path also selects only allowlisted hits.
- The prior actor-candidate silent drop, unauthenticated mutation routes,
  component-level acceptance, and global release gates remain tracked in
  `todo/30`, `todo/31`, and `todo/32`; this review does not duplicate them.
- The current Phase 2 call budget is coherent for actor-name completion.
  It cannot serve an IMDb missing-field fallback; the amended plan says so.

## Gates

| Gate | Result |
| --- | --- |
| `yarn vitest run lib/metadata/suggest-web.test.ts` | PASS — 25 tests after IMDb guard |
| `yarn test` | PASS — 62 files / 448 tests |
| `yarn build` | PASS — Next.js production build and typecheck |
| Live Agent Builder PUT + GET snapshot validation | PASS — skill/agent updated, exact two Jina tools, no default Elastic capabilities |
| Connector-side IMDb domain enforcement | NOT VERIFIED — generic `jina.read_url` has no visible allowlist |
| Licensed IMDb API/data test | NOT RUN — no license or adapter configured |
| New Suggest request against live agent and browser editor | NOT RUN — no external inference or UI acceptance in this review |
| URL token persistence proof on live Elasticsearch | NOT RUN — code-path finding only; no real secret submitted |
| Labeled relevance, p95/cost, multi-replica jobs | NOT RUN — existing acceptance debt |
| Running container rebuilt from current source | NOT RUN — this pass did not exercise the demo container |

Follow-up: [`todo/33-suggest-imdb-and-source-boundary-2026-09-24.md`](../todo/33-suggest-imdb-and-source-boundary-2026-09-24.md).
