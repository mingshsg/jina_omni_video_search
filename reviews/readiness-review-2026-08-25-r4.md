# Readiness Review, Round 4 — Current Consolidated Baseline

Date: 2026-08-25  
Scope: committed repository state after plan consolidation, including
`requirements/`, `plan/`, `todo/`, `chn.docs/`, `reference/`, and prior reviews

## Verdict

**The project is ready for documentation reconciliation and a small UI-stack
compatibility spike. It is not yet ready to execute Phase 1 exactly as written.**

The revised plan is substantially stronger than the earlier versions. It closes
the variant-ID collision, prohibits unsafe provider mixing, makes media budgets
provider-specific and measured, hardens URL import, corrects crash-recovery
scope, defines encoder failure behavior, and specifies how RRF attribution must
be recovered.

Two current blockers remain before scaffolding is committed:

1. the authoritative requirements and Chinese architecture still describe the
   old design, while the plan and TODO describe the new one;
2. the new `Next.js 16 + React 18 + EUI` stack is not yet demonstrated as a
   supported working combination.

Phase 2 remains blocked on the Elastic Serverless endpoint/API key and permission
to create an EIS endpoint if discovery finds none.

## Direct answers

**Is it ready to start?** Yes, but only with the two immediate tasks above:
synchronize the contract documents, then run a minimal dependency/build/render
spike. Do not begin the feature implementation against contradictory
requirements or assume the UI stack works because peer ranges install.

**Are the detailed documents, specs, and technical details present?** The
consolidated plan and offline reference corpus are detailed. The complete spec
set is **not present yet**: `docs/data-model.md`, `docs/api-contract.md`, the SSE
schema, job state machine, executable mappings, operations template, README,
`.env.example`, and UI mockup are still missing. The TODO correctly tracks most
of these as unfinished.

## Findings

### P0-1: Requirements are no longer the contract implemented by the plan

Evidence:

- `plan/00-implementation-plan.md:3-13` calls itself the winning consolidated
  plan but also says it implements `requirements/01-interpreted-requirements.md`.
- The requirements still state a 10 MB hosted-Jina limit, one global
  `EMBED_MAX_BINARY_BYTES`, `{video_id}_{chunk_index}`, interchangeable
  providers after normalization, and the earlier validation/job behavior.
- The plan now states hosted Jina is unknown/unmeasured, uses provider-specific
  budgets, introduces `variant_id`, prohibits provider mixing, pins task
  adapters, hardens SSRF handling, and limits recovery to idempotent manual
  retry.
- `todo/00-todo.md:47-53` explicitly marks requirements and Chinese-document
  synchronization unfinished.
- `reviews/review-response-2026-08-25b.md:303-309` incorrectly says the changes
  are already reflected in requirements, plan, and TODO.

The plan cannot both implement and override the requirements. The plan's newer
technical decisions are mostly sound, but they must be promoted into the
requirements so acceptance tests are traceable to the actual user contract.

Required before scaffolding is considered baseline-complete:

- execute the two sync tasks already listed at TODO lines 47-53;
- add explicit requirements for variant identity, provider isolation/task
  behavior, job retry semantics, search attribution, and the EUI stack decision;
- correct the hosted-Jina budget wording and OQ1-OQ3;
- preserve the original request as verbatim history rather than editing it;
- add a small decision log identifying who approved the post-clarification EUI,
  Next.js 16, React 18, and yarn changes, because the original recorded decision
  was Next.js 15 plus Tailwind.

### P0-2: Next.js 16 + React 18 + EUI is a compatibility hypothesis, not a settled stack

The plan correctly records that current EUI peer dependencies stop at React 18
and that EUI does not support Next.js SSR. It then concludes that Next.js 16 with
React 18 is safe because the Next package peer range accepts `^18.2.0`.

That conclusion is not established. Next.js's official version-16 upgrade guide
says the App Router uses its latest React Canary with React 19.2 features and
instructs users to install the latest React packages. EUI's current package
metadata allows React 17/18, not 19. Client-only rendering avoids EUI SSR imports,
but it does not by itself resolve React runtime/version compatibility:

- [Next.js 16 upgrade guide](https://nextjs.org/docs/app/guides/upgrading/version-16)
- [EUI package metadata](https://github.com/elastic/eui/blob/main/packages/eui/package.json)

The Next.js package peer range is evidence that installation may be allowed; it
is not equivalent to an official App Router + React 18 support statement.

Required before adopting the stack:

1. create a minimal disposable spike using the exact pinned versions;
2. render `EuiProvider` plus one interactive EUI control through the App Router;
3. run both `yarn dev` and `yarn build && yarn start`;
4. fail on peer warnings promoted to errors, hydration errors, duplicate React,
   Emotion insertion errors, or runtime failures;
5. record the resolved dependency tree and result in `docs/operations.md`.

If the spike fails, choose explicitly among:

- a Next.js version/runtime combination officially compatible with React 18;
- a React-19-compatible UI library;
- EUI with an acknowledged, tested peer override.

This spike should be the first Phase 1 acceptance gate, before the full app is
scaffolded.

### P1-1: Phase 1 Git tasks are stale after the baseline commit

The repository now has commit `262412b`, containing the complete planning
baseline. `.gitignore` does not exist, while TODO lines 73-74 still say to add it
before the first commit and then commit the documentation baseline.

No secret or data file is currently committed, so this is recoverable and no
history rewrite is needed. Update the tasks to:

- add `.gitignore` immediately, before creating `.env` or `data/`;
- verify `.env`, `.env.*` except `.env.example`, `data/`, proxy media, uploads,
  and common OS/editor files are excluded;
- commit the Phase 0 synchronization and `.gitignore` as the next commit.

### P1-2: The detailed contract documents remain work, not existing assets

The following are currently absent:

- `docs/data-model.md` with executable mappings;
- `docs/api-contract.md` with request/response/error shapes;
- SSE event schema and job state machine;
- `docs/architecture.md`, `docs/data-flow.md`, and `docs/ui-mockup.md`;
- `docs/operations.md` with pending measurement fields;
- README, `.env.example`, and package manifest.

The plan also leaves the RRF attribution implementation as a choice between
application-side fusion and RRF plus a second lookup. That is acceptable during
planning, but it means the search contract is not yet implementation-ready.

Recommended sequencing:

- create the operations template and stack-spike record during Phase 1;
- finish executable mappings before Phase 3;
- choose the attribution design and finish the API/SSE/job contract before
  Phases 6-8, as the revised TODO already requires;
- do not defer architecture and data-flow extraction until Phase 11 if they are
  expected to guide parallel implementation.

### P1-3: “Per-provider budgets” still use one configuration variable

The plan correctly rejects a single global limit, but the configuration table
still exposes only `EMBED_MAX_BINARY_BYTES`. Phase 2 says measured budgets are
written per provider into `.env`.

Define one unambiguous representation before `.env.example` and zod validation
are written, for example:

- `EIS_MAX_BINARY_BYTES`, `JINA_MAX_BINARY_BYTES`, and
  `LOCAL_MAX_BINARY_BYTES`; or
- a provider-scoped configuration object with strict keys.

Also record whether the measured value is decoded media bytes, base64 string
bytes, or total JSON request bytes. The existing 1 MB statement is decoded input,
while probes can easily measure a different layer by accident.

### P1-4: The local provider is not budget-free as currently described

`plan/00-implementation-plan.md:483-495` says the local server is capped by
`MAX_MEDIA_BYTES = 10 MB`, then says it removes the byte budget as a constraint.
Those statements are not simultaneously true unless the implementation changes
the constant and rebuilds/reconfigures the server.

Describe local as a configurable 10 MB reference-server baseline, or add the
exact task for changing and validating its cap. Do not use it as an
unconstrained quality baseline until the effective limit is measured.

### P1-5: Stored source URLs may contain credentials

The asset model retains `source_ref`. Remote URLs can carry signed query
parameters, bearer-like tokens, or embedded user information. The error contract
protects secrets, but persisted metadata is not covered.

Specify that stored/displayed URL provenance is sanitized: remove userinfo and
query/fragment secrets, store a safe origin/path or a one-way source fingerprint,
and never return the raw submitted URL to the browser or Elasticsearch unless an
explicit allowlist says it is safe.

### P2-1: “Yarn required, npm unsupported” is stronger than the current evidence

Using yarn is a reasonable project decision. The cited public EUI discussion
explains that npm was historically described as unsupported, but also indicates
that consuming EUI with npm can work when dependencies are present. The current
EUI repository itself uses yarn for monorepo development, which does not prove
that application consumers must use yarn.

Keep yarn if desired, but label it a pinned project choice for reproducibility,
not a framework constraint forced on consumers.

### P2-2: Several documentation assertions should be softened

- The 4-second/32-frame proxy may be a sensible encoding strategy, but
  “strictly better” than a 64-second container is not proven; validate retrieval
  rather than state dominance.
- “Every number” in Phase 11 cannot trace to a measurement: dimensions,
  protocol limits, and defaults legitimately trace to specifications. Change
  the criterion to “every empirical claim traces to a recorded measurement;
  externally defined constants trace to a cited source.”
- The pre-import “cost estimate” currently specifies call counts and token
  observations, not a currency estimate. Rename it workload estimate unless a
  pricing source and calculation are added.

## Previously blocking findings now closed in the plan

The revised plan successfully addresses these earlier issues:

- variant-safe chunk IDs and preset coexistence;
- model/task/provenance pinning and provider isolation;
- hosted-Jina video limits treated as unknown and measured rather than guessed;
- EIS endpoint discover-or-create behavior;
- redirect/DNS/stream-time SSRF and size enforcement;
- manual-retry semantics replacing unsupported crash recovery;
- terminal proxy-ladder failure behavior;
- RRF window/weight configuration and explicit attribution contract work;
- valid same-corpus preset evaluation instead of comparing incompatible raw
  scores.

These corrections materially improve implementation readiness and should be
retained when the requirements are synchronized.

## Recommended immediate sequence

1. Add `.gitignore` now, before any credentials or media directories are
   created.
2. Synchronize `requirements/01-interpreted-requirements.md` and
   `chn.docs/架构与数据流.md` with the committed consolidated plan.
3. Record approval/provenance for the EUI/Next.js/yarn stack change.
4. Run the exact-version Next.js 16 + React 18 + EUI compatibility spike.
5. If it passes, complete Phase 1 scaffolding and write the README,
   `.env.example`, and operations template.
6. Obtain Elastic credentials and endpoint-creation permission for Phase 2.
7. Write executable mappings before Phase 3 and the API/SSE/job contracts before
   Phases 6-8.

## Final readiness statement

The architecture and implementation plan are now strong. The project is one
requirements-sync pass and one dependency spike away from a credible start.
Until those are complete, the correct status is **“ready to validate and
reconcile,” not “ready to build unchanged.”**
