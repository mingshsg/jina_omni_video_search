# Project-level review follow-up — 2026-09-23

Review: [`project-level-review-2026-09-23.md`](../reviews/project-level-review-2026-09-23.md).
Scope: repository as a whole at `5cdf7d6`. Retrieval and Suggest findings stay
in `todo/22` and `todo/30`; this tracker holds only project-wide items.

## P1

- [x] **X1a — disable the reachable RCE surface today.** Fixed: added
      `images: { unoptimized: true }` to `next.config.js` with a comment
      explaining why and when to revisit. Verified: zero `next/image` usages
      (unaffected), `yarn build` still passes clean, no new warnings.
- [ ] **X1b — plan the Next 15 migration as its own item.** `14.2.35` is the
      final 14.x; 23 `next` advisories are patched only on `15.5.x`. EUI 119
      pins React 18 and Next 15 defaults to React 19 — needs a compatibility
      spike, a branch, and a full-route regression, not a version bump. Also
      check whether the `postcss` high propagates or needs a resolution.
      **Not done this pass** — correctly scoped as its own tracked item, not
      a quick fix.
- [x] **X2 — freeze new `plan/NN` until the six open P1s close.** The six
      P1s (`todo/22` F1–F3, `todo/30` S1–S3) are now fixed and tested (see
      those trackers). The rule itself ("a P1 open in any tracker blocks
      opening a new plan") is now recorded in `AGENTS.md`'s working-style
      section, with the eleven-commits/six-plans incident as the worked
      example of why it matters.
- [ ] **X3 — test the boundaries that have none.** `app/api` (3,807 lines),
      `lib/embed` (868), `components` (2,526) all have **zero** tests.
      - Add `app/**/*.test.ts` to `vitest.config.ts` include.
      - Write the hard-invariant-#1 test: `POST /api/search` with `hybrid`
        omitted is byte-identical to the pre-feature response.
      - Write PATCH `/api/library/[videoId]/meta` contract tests: 200 /
        404 / 409 / bootstrap `expected_revision=0`.
      - Add a transport-shape test for `lib/embed/eis.ts`.

## P2

- [ ] **X4** — update `README.md`: it mentions hybrid/metadata/suggest zero
      times and its Docs map predates the feature. Link `plan/03`, the new
      routes in `docs/api-contract.md`, and the Library editor.
- [ ] **X5** — add a consolidated blocking-items view (`todo/README.md` or a
      top section of `00-todo.md`): P1s only, one line each, pointing into
      the 20 trackers that carry the 104 open items.
- [ ] **X6** — decide the branch model. `main` is 11 behind
      `live-video-search` again. Either fast-forward `main` on every merge or
      retire `live-video-search`; update `AGENTS.md` to match.
- [ ] **X7** — split `components/EditMetadataFlyout.tsx` (1,648 lines; holds
      the only enforcement of draft-merge safety plus three `todo/30`
      findings) and `app/page.tsx` (1,331).

## P3

- [ ] Fix or date the stale test count in `AGENTS.md` (says 47/243; actual
      62/423).
- [ ] Fix `lib/es/hybrid-search.test.ts:60` type error.
- [ ] Remove `scripts/_probe-hur-jun-once.ts`.
- [ ] **Commit** the staged reviews-archive restructure and
      `todo/30-suggest-pipeline-review-2026-09-23.md` — currently one branch
      switch from confusion.

## Verified in good shape — no action

- [x] Dockerfile: `config/` copied with `--chown`, non-root `nextjs`,
      three-stage build (G1 closed).
- [x] No secrets in tracked files; `.cursor/`, `tmp/` ignored.
- [x] Write-safety architecture (field-owned ingest, script-guarded CAS,
      Suggest never writes) — verified twice.
- [x] `lib/live` is the best-tested area (34 test files, 0.39 ratio).
- [x] `(1)` duplicates and `.next.failed-*` removed.
- [x] G1–G8 landed in code, not just prose.

## Gates

`yarn test` PASS 62/423. `yarn audit` **30 vulns, 2 critical**. `tsc` 1 new
error + pre-existing `lib/live` ones. `yarn build` NOT RE-RUN this pass (no
`lib/`/`app/` change since the last 75s pass). Live-cluster, relevance,
latency, E2E: NOT RUN.
