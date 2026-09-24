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
- [x] **S6** — either verify citations or stop rendering a model-supplied URL
      as a source link for free-text fields (`suggest-web.ts:279-290`). Label
      `description`/`abstract` differently from catalog-validated fields.
      Needs a plan amendment, not just a patch. **Resolved differently than
      originally scoped, by explicit product decision (方案 A):** investigation
      found the actual defect was worse than "unverified citation is rendered
      as a source link" — `cited()` in `suggest-web.ts` *required* an
      allowlisted `field.url` to accept a value at all, silently discarding
      the entire fact (not just its link) whenever the agent asserted
      something without an allowlisted citation. This directly contradicted
      the zod schema in `agent-builder-suggest.ts`, which always marked `url`
      optional — a schema/code contradiction, not an intentional trust gate.
      Reproduced via a real Suggest run on 《大长今/Jewel in the Palace》 where
      only Year/Tags filled in (from local filename-regex fallback, not the
      agent) while every agent-researched field was dropped without any error
      surfaced to the operator.
      Fix: `cited()` now returns the value regardless of citation status,
      tagging each result `cited: boolean`. Confidence is discounted (base −
      0.15, floor 0.3) and `evidence` is prefixed `[agent, uncited]` instead
      of `[agent]` when there's no allowlisted URL, so the operator can see
      at a glance which facts are lower-trust — but nothing is silently
      dropped. `source_url` is only carried through when it is an `https://`
      link (satisfies the stricter save-time provenance schema); an
      `http://`-only or non-allowlisted URL is still visible in the evidence
      text and now also collected into a new **`meta.reference_urls`**
      field — every URL the agent touched (cited fields, uncited fields,
      candidates, actor sources), deduped and safety-checked
      (`isRenderableTraceUrl`, http(s)-only, capped at 20), surfaced as its
      own suggestion so the operator has a durable "what was consulted"
      research trail independent of the per-fact citation gate. Same
      relaxation was intentionally **not** applied to
      `normalizeAgentActorCandidates`, which still hard-requires
      `isNameAllowlistedUrl` — actor identity resolution stays stricter
      pending a separate product decision.
      `reference_urls` added end-to-end: `AssetMeta`/`AssetMetaEditorDto`/
      `MetaReviewMap` types and PATCH zod schema (`validate.ts`, new
      `META_BOUNDS.referenceUrlsMax`/`referenceUrlMaxLen` in `catalogs.ts`),
      `CLEARABLE_META_KEYS`/`REVIEW_FIELD_KEYS`/`EDITABLE_KEYS`
      (`asset-meta.ts`, `validate.ts`), ES mapping
      (`asset-meta-mapping.ts`, `index: false` keyword array — not used for
      filtering), and full UI wiring in `EditMetadataFlyout.tsx` (comma-
      separated `EuiFieldText`, mirroring the existing `tags` field exactly:
      state, suggestion-merge-on-load, pending-suggestion apply/dedupe,
      save-diff, i18n labels in `ui.ts`).
      Tests: `lib/metadata/suggest-web.test.ts` (uncited field still applies
      at lower confidence; non-allowlisted URL still applies; cited field
      keeps full confidence and plain `[agent]` prefix; http-only URL omits
      `source_url`; `reference_urls` collected/deduped from fields,
      candidates, and actors; omitted entirely when no URLs exist at all) and
      `lib/metadata/people.test.ts` (`reference_urls` PATCH accept/dedupe/
      reject-malformed/clear). 438/438 tests pass; `yarn build` passes.
- [ ] **S7** — add auth, rate limiting, a size cap and a removal path to the
      person-catalog write routes. Aliases feed `findContainedAliases` in the
      search hot path, so a bad alias silently injects an actor filter into
      every query for all users. Also needs a plan amendment. **Not fixed.**
      **Scope widened 2026-09-23 (todo/32 R3): this now covers TWO routes,
      not one.** Any fix must cover both or it leaves a hole:
      - `POST /api/metadata/catalogs/people`
        (`app/api/metadata/catalogs/people/route.ts:33`) — creates a person.
      - `PATCH /api/metadata/catalogs/people/{personId}`
        (`app/api/metadata/catalogs/people/[personId]/route.ts`) — replaces
        an existing person's whole known-as list. Added for the "Known as"
        editor; same unauthenticated exposure, and additionally *destructive*
        (a full-list replace can remove names, unlike POST which only adds).
      Partial mitigation already in place on the PATCH route: bounds are
      enforced from a single source (`KNOWN_AS_MAX`), cross-person alias
      collisions are rejected with 409 rather than silently overwriting, and
      the UI confirms before removing a name (todo/32 R2). None of that is a
      substitute for auth.
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
agent, live floor `msearch` under load. S7, S8 remain open — each needs
a product/plan decision, not just a patch.

**2026-09-23 update:** S6 resolved by explicit product decision (方案 A —
relax the per-field citation gate rather than tighten it) plus a new
`meta.reference_urls` field; see the S6 entry above for the full change.
`yarn test` PASS (62 files / 438 tests, up from 62/428 — 10 new regression
tests). `yarn build` PASS. `tsc --noEmit` clean on every file touched.
