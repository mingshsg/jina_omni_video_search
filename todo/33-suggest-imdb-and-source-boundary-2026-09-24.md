# todo/33 — Suggest IMDb and source-boundary review (2026-09-24)

Source review:
[`reviews/suggest-imdb-and-source-boundary-code-review-2026-09-24.md`](../reviews/suggest-imdb-and-source-boundary-code-review-2026-09-24.md).

## P1

- [x] **R0** — enforce the non-IMDb policy before `jina.read_url` makes a
      network request. The live Agent skill instructs it to avoid IMDb and
      app output is filtered, but the generic assigned MCP tool has no visible
      domain allowlist.
      **Closed as accepted / not an issue (user decision, 2026-09-24).** A
      connector- or proxy-level allowlist is outside this repo's reach — the
      `jina.read_url` tool is configured in Kibana, not in code — and the user
      has accepted prompt-level instruction plus app-side rejection as the
      enforcement model. The honest constraint stands: this must never be
      *described* as a network block. Reopen only if connector-side tooling
      is ever provisioned.
- [x] **R1** — prevent credentials/tokens in `reference_urls`, per-field
      `source_url`, and Suggest responses.
      **Fixed 2026-09-24.** New shared `sanitizeExternalUrl`
      (`lib/metadata/url-safety.ts`) strips userinfo and fragment and deletes
      a narrow denylist of credential query params (`api_key`, `token`,
      `password`, `secret`, `access_token`, …). Applied on both ingress
      paths — agent collection (`collectReferenceUrls`) and manual PATCH
      (`softHttpUrl` / `softHttpsUrl`) — and dedupe happens on the sanitized
      form, so two URLs differing only by a stripped token collapse.
      Deliberately *less* aggressive than FR-22's `sanitizeUrlProvenance` on
      one axis: the query is preserved (minus credential params), because a
      reference link must point back to the same page and FR-22's
      origin+path reduction would retarget query-addressed article URLs.
      Residual risk is a credential hidden under an unusual param name;
      userinfo, the unambiguous case, is always removed. 9 new sanitizer
      tests + 4 path tests (manual PATCH, `source_url`, agent collection,
      token-dedup), all synthetic. Code committed **f38606e** (2026-09-29).
- [x] **R2** — remove IMDb from app Reader allowlists and the Agent's stated
      source policy, reject IMDb-sourced drafts/reference links, amend plans,
      and deploy the updated skill/instructions.
      `reference/agent-builder/validation-summary.json` records live GET
      checks. This does **not** close R0's tool-boundary enforcement gap.

## P2

- [x] **R3** — preserve uncited agent facts as visible drafts (prior S6
      decision), but require deliberate application before they enter empty
      fields; show non-allowlisted HTTPS links as unverified rather than as
      citations.
      **Fixed 2026-09-24.** Two halves.
      (a) *Citation framing:* `citableSourceUrl` now requires `wasCited`, so
      only an allowlisted URL becomes `source_url` (which the editor renders
      as a citation). A fan-blog URL no longer gets a "source" link; it stays
      visible only in evidence text and `reference_urls`, framed as
      unverified.
      (b) *Auto-insert:* an uncited draft (detected by the server's own
      `[agent, uncited]` evidence marker) no longer auto-fills an empty
      field for any of the 7 scalar fields. It is routed into the existing
      `pendingSuggestions` tray, which renders a per-field "Accept this
      value?" callout with an apply button — the operator accepts explicitly
      instead of the value writing itself. Cited facts still auto-fill, so
      the S6 decision (don't silently discard real agent output) is
      preserved; only the *uncited* subset now needs a deliberate click.
      Cite `components/EditMetadataFlyout.tsx` `isUncited` + 7 field gates.
      Note: no component-level test exists anywhere in this repo (vitest
      covers `lib/**`/`worker/**` only), so (b) is verified by code path,
      not by an automated UI test — recorded in the review's gates.
- [x] **R4** — distinguish read pages from mere search candidates in
      `reference_urls` / evidence wording; use trace evidence where possible,
      or relabel the combined list "research links".
      **Closed as accepted (user decision, 2026-09-24).** The field is a
      reference trail, not an audit log: "pages consulted" is loose wording
      but harmless, and the user judged the read-vs-candidate distinction not
      worth enforcing. If it ever matters for provenance, the tool_trace
      already records actual `read_url` calls and can be used to split the
      two then. No code change.
- [ ] **R5** — keep canonical person names searchable after alias edits.
      Reject canonical-name removal or include display names in the alias
      index; test multilingual names and the editor's removal path.

## IMDb backup activation gate

- [ ] Obtain an applicable IMDb data license/authorization, then implement a
      separately enabled licensed API or bulk-data adapter. Trigger it only
      after Wikipedia cannot identify the work or leaves specific work fields
      missing; use title/AKA/year disambiguation and IMDb title ID, merge only
      missing fields, and allocate an explicit bounded second work-level
      budget. Verify attribution/reuse terms and integration behavior before
      enabling. This is a disabled design, not a pending live switch.

## Owed gates

- [x] Focused `codex/url-safety-suggest` branch: Node 22.13.1
      `yarn test --maxWorkers=4` passed 63 files / 460 tests and `yarn build`
      passed on 2026-09-29. The save-path test verifies that manual links and
      provenance URLs lose userinfo and credential query parameters.
- [ ] Rebuild the app container from this exact branch and run a controlled
      live Suggest and browser editor check.
      *(Container rebuilt 2026-09-29 09:03 by `docker compose up -d --build
      app` — see below — before this focused branch existed; that earlier
      rebuild does not satisfy this gate.)*
- [ ] Labeled Chinese/Korean title and actor-name relevance, representative
      p95/cost, and multi-replica durable jobs remain tracked in older todo
      files; do not infer them from unit/build success.

## Container rebuild (2026-09-29)

`docker compose up -d --build app` succeeded after adding a placeholder
`public/.gitkeep`: the runner stage's `COPY --from=builder /app/public ./public`
had no source directory in this repo, and the layer was previously served from
a stale cache. New container `2026-09-29 09:03:07 +0800`, `Up`, `GET /ingest`
→ 200 on `127.0.0.1:3000`. Container `.next/server/chunks/78987.js` is
byte-identical (sha256 `875f19c1…`) to a fresh host build's sanitizer chunk, so
the R1 code is present in the running app. This does **not** satisfy the live
Suggest/browser check above.
