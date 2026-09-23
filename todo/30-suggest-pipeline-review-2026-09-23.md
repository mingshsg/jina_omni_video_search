# Suggest pipeline review follow-up — 2026-09-23

Review: [`hybrid-suggest-pipeline-review-2026-09-23.md`](../reviews/hybrid-suggest-pipeline-review-2026-09-23.md).
Scope: edit-time Suggest path, not covered by earlier reviews. Read-only pass;
nothing modified. `yarn test` PASS (62 files / 423 tests) at review time.

## Blocking carry-over — `todo/22` P1s are still open

Re-verified in this pass and independently re-confirmed by
`reviews/hybrid-code-recheck-2026-09-23.md`. Six new plans and ~20 code files
were added on top of these while they stayed open.

- [x] **F1** — fixed 2026-09-23; see `todo/22` for the live-cluster
      verification evidence.
- [x] **F2** — fixed 2026-09-23; see `todo/22`.
- [x] **F3** — fixed 2026-09-23; see `todo/22`.

## P1 — Suggest trust boundary

- [x] **S1 — failure is displayed as success.** Fixed: `EditMetadataFlyout`
      now reads `data.web?.status === 'unavailable'` and shows a distinct
      warning callout (`t.metaSuggestWebUnavailable`, with the reason code)
      instead of the neutral "info" banner. Server-side: `suggest-web.ts`'s
      catch block now logs `phase: 'agent_builder_enrichment_failed'` with
      the reason code and error message (no secrets — `AgentBuilderError`
      messages are generic technical strings, verified by inspection of
      every throw site).
- [x] **S2 — ambiguous answers auto-applied with an invented confidence.**
      Fixed on both sides: `candidates` (and `reads`, derived from it) are
      now built only when `payload.status === 'ok'`, matching
      `actorCandidates`. Client-side defense-in-depth: `topCandidateTitle` is
      only read when `data.web?.status === 'ok'`. Confidence lowered from an
      invented `0.7` (higher than any other web-derived field in this file)
      to `0.55`, matching the confidence already used elsewhere for an
      unconfirmed single web source. Added a regression test:
      `suggest-web.test.ts` — an `ambiguous` payload carrying a populated
      `candidates` array must yield `web.candidates` and `web.reads` empty.
- [x] **S3 — fetched page content can be parsed as the agent payload.**
      Fixed: the `results[].data.content` fallback (raw tool-result content)
      is removed entirely; the per-step key scan now only reads
      `message|content|text|output` from a step whose `type === 'assistant'`
      (the only step shape this codebase's own tests ever declared as
      message-bearing). If no assistant step is found, this fails closed
      (`AgentBuilderError('malformed', …)`), which the caller already turns
      into a safe local-suggestions fallback. Added two regression tests: a
      page-embedded `{"status":"ok",...}` blob in `results[].data.content`
      must throw rather than parse; a `content` key on a non-assistant step
      must be ignored even when a genuine assistant step exists elsewhere in
      the same response.

## P2

- [x] **S4** — validate `tool_trace` URLs before rendering them as `href`.
      Fixed with a purpose-built check (`isRenderableTraceUrl`: http(s) only,
      no control characters, length-bounded) rather than reusing the domain
      allowlist from `suggest-web.ts`, which cannot be imported here without
      a circular dependency (`suggest-web.ts` imports this module) and is
      arguably the wrong policy for "here is what the agent read" versus "a
      citation we vouch for".
- [x] **S5** — cap brace scanning in `extractBalancedJsonObjects`. Fixed:
      each inner scan is bounded to a fixed window (20,000 chars), and a
      failed (never-closed) scan jumps `i` to the end of that window instead
      of restarting an overlapping scan at every subsequent `{` — bounds
      total work to O(n). Documented trade-off in the code and in this
      tracker: a valid balanced object whose opening `{` falls *inside* a
      failed window (i.e. immediately after a large contiguous run of
      unmatched `{`, no separating content) will not get its own fresh-depth
      attempt and can be missed — acceptable because (a) this function is
      explicitly best-effort, and (b) after the S3 fix this is reached only
      on assistant-authored text, not arbitrary fetched page content. Added a
      regression test proving a 50,000-char trailing unmatched-brace run
      resolves in well under 500 ms without losing an earlier valid object.
- [ ] **S6** — either verify citations or stop rendering a model-supplied URL
      as a source link for free-text fields (`suggest-web.ts:279-290`). Label
      `description`/`abstract` differently from catalog-validated fields.
      Needs a plan amendment, not just a patch. **Not fixed this pass** —
      correctly scoped as a product decision, not a code patch.
- [ ] **S7** — add auth, rate limiting, a size cap and a removal path to
      `POST /api/metadata/catalogs/people`
      (`app/api/metadata/catalogs/people/route.ts:33`). Aliases feed
      `findContainedAliases` in the search hot path, so a bad alias silently
      injects an actor filter into every query for all users. Also needs a
      plan amendment. **Not fixed this pass.**
- [ ] **S8** — rate limit is keyed on spoofable `x-forwarded-for`
      (`suggest/route.ts:59-62`); with no auth this leaves `MAX_ACTIVE=2` as
      the only throttle on outbound LLM + Jina spend. **Not fixed this
      pass** — needs an auth decision first, not just a keying change.

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

`yarn test` PASS (62 files / 428 tests, up from 62/423 — 5 new regression
tests: F2, S2, S3×2, S5). `yarn build` PASS (73.8s). `tsc --noEmit` clean
outside pre-existing, unrelated `lib/live/*.test.ts` errors.

**Still NOT RUN:** live Kibana/Agent Builder converse (S3's response-shape
claim is still inferred from code comments and tests, not a captured live
body — the *fix* does not depend on that shape being confirmed, since it
fails closed either way, but full confidence in the fallback path still
wants one), browser E2E, a true prompt-injection fixture against a live
agent, live floor `msearch` under load. S6, S7, S8 remain open — each needs
a product/plan decision, not just a patch.
