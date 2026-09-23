# Suggest pipeline review follow-up — 2026-09-23

Review: [`hybrid-suggest-pipeline-review-2026-09-23.md`](../reviews/hybrid-suggest-pipeline-review-2026-09-23.md).
Scope: edit-time Suggest path, not covered by earlier reviews. Read-only pass;
nothing modified. `yarn test` PASS (62 files / 423 tests) at review time.

## Blocking carry-over — `todo/22` P1s are still open

Re-verified in this pass and independently re-confirmed by
`reviews/hybrid-code-recheck-2026-09-23.md`. Six new plans and ~20 code files
were added on top of these while they stayed open.

- [ ] **F1** — floor `msearch` sends `retriever` (`hybrid-search.ts:398`),
      `as never` at `:429`. Unchanged.
- [ ] **F2** — matched actor strips the rest of the query from BM25.
      Unchanged.
- [ ] **F3** — `grep -c "console\.\|logger" lib/es/hybrid-search.ts` → **0**.
      Unchanged.

## P1 — Suggest trust boundary

- [ ] **S1 — failure is displayed as success.** `enrichViaAgentBuilder`
      resolves every error into `web.status:'unavailable'`
      (`suggest-web.ts:573-592`); the route labels the job by draft count
      (`suggest/route.ts:166-177`); the client never reads `data.web.status`
      or `.reason` (`EditMetadataFlyout.tsx:126`). Surface the status and
      reason in the UI, and log the degradation server-side.
- [ ] **S2 — ambiguous answers auto-applied with an invented confidence.**
      Move `candidates` inside the `payload.status === 'ok'` guard
      (`suggest-web.ts:256` vs `:272`), and stop deriving `work_title` from
      `candidates[0]` with a hardcoded `confidence: 0.7`
      (`EditMetadataFlyout.tsx:698-715`). Under the `jina` provider these are
      search-result page titles, not work titles.
- [ ] **S3 — fetched page content can be parsed as the agent payload.**
      Restrict the fallback in `extractConverseMessage` to assistant-typed
      steps; do not accept raw tool-result content
      (`agent-builder-suggest.ts:534-565`). Add a prompt-injection fixture:
      a page embedding a plausible `{"status":"ok","fields":{…}}` blob.

## P2

- [ ] **S4** — validate `tool_trace` URLs before rendering them as `href`
      (`agent-builder-suggest.ts:592`, `EditMetadataFlyout.tsx:1514`). Reuse
      the existing allowlist; bound the length.
- [ ] **S5** — cap brace scanning in `extractBalancedJsonObjects`
      (`agent-builder-suggest.ts:255-293`); it is O(n²) on a 100 KB
      attacker-influenced string and stalls the event loop for the whole app.
- [ ] **S6** — either verify citations or stop rendering a model-supplied URL
      as a source link for free-text fields (`suggest-web.ts:279-290`). Label
      `description`/`abstract` differently from catalog-validated fields.
      Needs a plan amendment, not just a patch.
- [ ] **S7** — add auth, rate limiting, a size cap and a removal path to
      `POST /api/metadata/catalogs/people`
      (`app/api/metadata/catalogs/people/route.ts:33`). Aliases feed
      `findContainedAliases` in the search hot path, so a bad alias silently
      injects an actor filter into every query for all users. Also needs a
      plan amendment.
- [ ] **S8** — rate limit is keyed on spoofable `x-forwarded-for`
      (`suggest/route.ts:59-62`); with no auth this leaves `MAX_ACTIVE=2` as
      the only throttle on outbound LLM + Jina spend.

## P3

- [ ] Move draft-merge safety server-side; `applyAgentPayloadToLocal` ignores
      `input.draft` (`suggest-web.ts:224`).
- [ ] Cancel the abandoned job on rapid re-click (`EditMetadataFlyout.tsx:742`
      returns before the `DELETE` at `:745`).
- [ ] Derive the client poll cap from `SUGGEST_WEB_TIMEOUT_MS` instead of the
      hardcoded `120_000` (`:562`).
- [ ] Distinguish an intentional clear from a provider failure in
      `description-embed.ts:85-119`; stop the double `run()` in
      `asset-meta.ts:321-331`.
- [ ] `pickReadableCandidates` scores empty titles (`suggest-web.ts:475`).
- [ ] Stop returning raw `err.message` from the catalog routes.
- [ ] Add `.catch()` to the fire-and-forget `DELETE` calls.
- [ ] Sweep orphan `people.json.tmp-*` files.
- [ ] Run the rate-limit check before the ES read (`suggest/route.ts:143`).

## Verified correct — no action

- [x] Suggest never writes; no ES write exists in the job closure.
- [x] Cancellation and late arrival leave the saved record untouched.
- [x] No secrets in logs, errors or responses.
- [x] Catalog validation gates year/country/language/video_type.
- [x] SSRF allowlist on the Jina REST path, re-checked after redirect.
- [x] Only `web.status === 'ok'` results are cached.

## Checked and rejected

- [x] `addPersonToCatalog` read-modify-write race — the function is fully
      synchronous, so it cannot interleave in-process.
- [x] `extractConsensusYear` empty/tied handling — guarded.
- [x] XSS via rendered agent text — React escapes it; only `href` is exposed
      (S4).

## Gates

`yarn test` PASS (62 / 423). **NOT RUN:** live Kibana/Agent Builder converse
(S3's response-shape claim is inferred from code comments and
`agent-builder-suggest.test.ts:273-299`), `yarn build`, browser E2E,
prompt-injection fixture, live floor `msearch`.
