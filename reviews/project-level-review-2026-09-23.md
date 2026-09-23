# Project-level review — 2026-09-23

Scope: the repository as a whole at `5cdf7d6` — dependency posture, process
health, test-coverage shape, documentation currency, and repository state.
Deliberately **not** another pass over hybrid retrieval or Suggest; those are
covered by `todo/22` and `todo/30` and their findings are re-verified here
only for status. Read-only; nothing in `lib/`, `app/` or `components/` was
modified.

**Verdict: the code that exists is better than average and the process that
produces it is running open-loop.** Eleven commits landed in the last day.
All six P1 findings from the two prior reviews remain open under them. The
framework has a critical unauthenticated RCE with no patch on the current
major version. The three layers where every request enters or every vector
originates have no tests at all. None of this is visible from the green
gates.

## P1

### X1 — `next@14.2.35` has a critical unauthenticated RCE and is the last 14.x release

`yarn audit`: 30 vulnerabilities — 2 critical, 10 high, 16 moderate, 2 low.
Of these, **23 are in `next`**. The two criticals:

- *Unauthenticated Remote Code Execution in Image Optimization API* — patched
  `>=15.5.24`
- *Unauthenticated RCE on Windows-hosted servers* — patched `>=15.5.24`

Plus high-severity SSRF in Server Actions and rewrites, DoS in Server
Components, and a Pages Router middleware bypass — every one patched only on
`15.5.x`. `npm view next@14 version` → `14.2.35` is the **final 14.x
release**. There is no 14.x fix and there will not be one.

Is the RCE surface reachable? The project uses `next/image` **zero** times,
but `next.config.js` has no `images` block, so the `/_next/image` route is
**enabled by default** and reachable on any deployment. Two mitigations exist,
in order of cost:

1. **Immediate, one line:** `images: { unoptimized: true }` in `next.config.js`
   disables the optimizer route. No functional impact — nothing uses it.
2. **Actual fix:** migrate to Next 15.5.24+. This is not a version bump. EUI
   119 pins React 18 (`reference/elastic-eui-constraints.md`), and Next 15
   defaults to React 19 — the migration needs a plan, a branch, and a
   regression run against every route.

Do (1) today. Plan (2) as its own tracked item. Also: `postcss` (high, path
traversal) — check whether the fix propagates through Next or needs a
resolution override.

### X2 — Six open P1s have been built over for eleven commits

| Tracker | P1s open | Status |
| --- | --- | --- |
| `todo/22` (hybrid retrieval) | F1 F2 F3 | unchanged since 2026-09-23 14:37 |
| `todo/30` (Suggest pipeline) | S1 S2 S3 | unchanged since 2026-09-23 18:16 |

Since `todo/22` was written: `f0b157e` (actor free-text growth), `517b1b6`
(description depth), `13d05ec` (work_title), `5cdf7d6` (Description/All
search modes), plus six new plans (`plan/06`–`plan/11`) authored in a
**two-hour window** on 2026-09-23 (15:09 → 17:20). `reviews/hybrid-code-recheck`
independently re-confirmed all three `todo/22` P1s and they *still* did not
move.

The specific risk: F1 means the guaranteed-recall floor may never have worked.
Every search-mode feature since then (`plan/11` Description mode, All mode)
sits on top of a retrieval path whose correctness is unverified. Fixing F1
later may change what those features actually return.

This is a **cadence** problem, not a competence one — the code Cursor writes
is careful. But nothing in the loop forces it to close a P1 before opening a
plan. Recommend: **no new `plan/NN` until `todo/22` F1–F3 and `todo/30` S1–S3
are closed**, and add that rule to `AGENTS.md`.

### X3 — Zero tests at the three boundaries that matter most

| Area | Source lines | Test lines | Files |
| --- | ---: | ---: | ---: |
| `app/api` | 3,807 | **0** | 0 |
| `lib/embed` | 868 | **0** | 0 |
| `components` | 2,526 | **0** | 0 |
| `lib/video` | 706 | 56 | 1 |
| `lib/ingest` | 2,406 | 476 | 7 |
| `lib/es` | 4,455 | 1,054 | 7 |
| `lib/metadata` | 5,601 | 2,160 | 11 |
| `lib/live` | 13,096 | 5,206 | 34 |

`app/api` is every HTTP contract the project promises — including the
`/api/search` behavior that the plan's hard invariant #1 says must never
change, and the `sort_by` defaulting logic (T-1) that only works because a
`.default()` was removed. **None of it is exercised.** `vitest.config.ts`
includes only `lib/**` and `worker/**`, so this is structural: a test placed
under `app/` would not run even if written (`AGENTS.md` trap #6).

`lib/embed` is where every vector originates — the EIS transport, the retry
policy, the concurrency gate, the base64 encoding. A regression there corrupts
every index silently.

The "invariant #1 regression test" that the plan requires as the precondition
for refactoring shared search code **does not exist**. `lib/es/search.test.ts`
has 4 tests of pure helpers.

Recommend: add `app/**/*.test.ts` to the vitest include; write route-level
contract tests for `/api/search` (omitted `hybrid` → byte-identical to
pre-feature response) and `/api/library/[videoId]/meta` (PATCH 409/404/200);
add at least a transport-shape test for `lib/embed/eis.ts`.

## P2

### X4 — The README does not know the hybrid feature exists

`README.md` was last touched at `93425bc` (2026-09-22, live-video ship). It
mentions `hybrid`, `metadata`, or `suggest` **zero** times. Its "Docs map"
section does not link `plan/03`, `docs/api-contract.md`'s new routes, or the
Library editor. Anyone arriving at the repo — a reviewer, a demo audience, a
future maintainer — is told this is a file+live video search tool. Twenty-plus
new files and a whole editorial subsystem are invisible from the front door.
`docs/api-contract.md` *was* updated (12 mentions of `hybrid`), so the gap is
specifically the entry point.

### X5 — 104 open items across 20 tracker files, no consolidated view

`todo/` has 31 files. 20 of them carry open work, totalling **104** unchecked
items. `todo/00-todo.md` was the original index but has 3 open items of its
own and does not roll up the others. To answer "what is blocking?" one must
open 20 files. The P1s in X2 are a direct consequence — they are in files
22 and 30 of 31, and nothing surfaces them.

Recommend a short `todo/README.md` (or a top section in `00-todo.md`) that
lists **only** P1/blocking items with a one-line pointer each, regenerated
when a tracker changes. Five lines that would have made X2 impossible to miss.

### X6 — `main` is drifting again, and `AGENTS.md` still names `live-video-search` as the PR target

`main` was fast-forwarded to `live-video-search` on 2026-09-22 so that fresh
clones would see `AGENTS.md`. It is now **11 commits behind** again. Every
commit since then landed on `live-video-search`. Two branches carrying the
same line of work, one of them the GitHub default, is a standing invitation
to a stale clone. Either fast-forward `main` on every merge (a one-line
step), or retire `live-video-search` and update `AGENTS.md` — the current
state is the worst of both.

### X7 — Two god-components

`components/EditMetadataFlyout.tsx` is **1,648 lines**; `app/page.tsx` is
**1,331**. The flyout holds the Suggest client, draft-merge safety
(`todo/30` P3-1 notes this is the *only* place that rule is enforced), actor
catalog growth, tool-trace rendering, and the form itself. Three of the
`todo/30` findings (S2, S4, P3-2) are in this file. A component this size
with zero tests and security-relevant logic is where the next regression
lives.

## P3 — hygiene

- `AGENTS.md` still says "47 files / 243 tests as of 2043ada"; actual is 62 /
  423. Either drop the numbers or date them.
- `lib/es/hybrid-search.test.ts:60` — real type error (`query_vector` not on
  `HybridQueryDslExplain`), still present; `next build` does not catch test
  files.
- `scripts/_probe-hur-jun-once.ts` — single-use probe, still in the tree
  (`todo/22` P3).
- The reviews archive restructure (60 → 6 tracked files) and
  `todo/30-suggest-pipeline-review-2026-09-23.md` are **staged / untracked but
  not committed**. One `git stash` or branch switch away from confusion.
- The `(1)` duplicate files and `.next.failed-*` are gone — good.

## What is in good shape

Stated so this review is not read as "everything is broken":

- **Dockerfile** copies `config/` with `--chown`, runs as `nextjs` non-root,
  three-stage build. G1 is properly closed.
- **No secrets** in any tracked file; `.env.example` placeholders only;
  `.cursor/` and `tmp/` ignored.
- **The write-safety architecture holds** — field-owned ingest writes,
  script-guarded revision CAS, Suggest never writes. Verified twice.
- **`lib/live`** at 13k lines has 34 test files and a 0.39 ratio — the
  shipped feature is the best-tested part of the codebase, which is the right
  way round.
- **Gates run and pass**: `yarn test` 62/423, `yarn build` ~75s.
- The G1–G8 plan corrections all landed in code, not just in prose.

## Recommended order

1. `images: { unoptimized: true }` — today, one line, closes the reachable RCE.
2. Commit the staged reviews cleanup + `todo/30` so the trackers are durable.
3. Freeze new plans. Close `todo/22` F1 (live-cluster `msearch` check),
   F2, F3, then `todo/30` S1–S3.
4. Add `app/**` to vitest; write the `/api/search` invariant test and the
   PATCH contract test.
5. Fast-forward `main`; decide the branch model; fix `AGENTS.md`.
6. Update the README front door.
7. Plan the Next 15 migration as its own tracked item with an EUI/React
   compatibility spike first.

## Gates

| Gate | Result |
| --- | --- |
| `yarn test` | PASS — 62 files / 423 tests |
| `yarn audit --level moderate` | **30 vulnerabilities, 2 critical** |
| `npx tsc --noEmit` | 1 new error (`hybrid-search.test.ts:60`) + pre-existing `lib/live/*.test.ts` `ProcessEnv` errors |
| `yarn build` | NOT RE-RUN this pass (passed at 75s in the prior pass; no `app/` or `lib/` change since) |
| Live-cluster floor `msearch`, relevance, latency, browser E2E | NOT RUN — unchanged from `todo/22` / `todo/30` |

Follow-up: [`todo/31-project-level-review-2026-09-23.md`](../todo/31-project-level-review-2026-09-23.md).
