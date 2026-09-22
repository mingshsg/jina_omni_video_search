# AGENTS.md

Conventions and known traps for AI coding agents working in this repository.
Read this before touching code. It is deliberately short; it tells you **where**
to read further rather than repeating the plans.

## What this project is

A Next.js 14 demo that makes video searchable by meaning. Video is chunked into
time windows, each window is embedded as a visual vector and (when audio
exists) an audio vector via `jina-embeddings-v5-omni-small` at 1024 dims, and
search returns **moments** — time windows — not whole videos.

Two delivery tracks already shipped:

- **File video** — upload / URL / local import, `video-assets` + `video-chunks`.
- **Live video** — RTSP capture in a dedicated worker, `live-video-*` indices.

One track is planned and not yet implemented:

- **Hybrid metadata search** — see `plan/03-hybrid-metadata-search-plan.md`.

## Commands

```bash
yarn install
yarn dev            # local dev
yarn build          # production build (~60s) — must pass before you claim done
yarn test           # vitest run — 47 files / 243 tests as of 2043ada
yarn setup-indices  # idempotent index creation
```

`yarn lint` is declared in `package.json` but **does not work**: there is no
ESLint config or dependency, so `next lint` drops into an interactive setup
prompt and exits non-zero. Do not put it in CI or claim it as a passing gate
until someone adds a config. Typechecking happens through `yarn build`.

Package manager is **yarn 1.22.22** (pinned). Node 22. Do not introduce npm or
pnpm lockfiles. EUI requires yarn — see `reference/elastic-eui-constraints.md`.

## Hard invariants

Breaking any of these is a bug, not a trade-off.

1. **Never break the existing file-search or live-search contracts.**
   `/api/ingest`, `/api/search`, `/api/search/image`, `/api/library`, the media
   routes and the live routes keep their current behavior. Shared internal code
   may be refactored only with regression tests proving identical responses.
2. **Metadata edits never re-embed chunks.** Chunk vectors, `variant_id`, chunk
   counts and file paths are immutable with respect to editorial metadata.
3. **Provider identity is part of `variant_id`.** Changing provider, model,
   task, dims, normalization or proxy settings changes the variant. Never mix
   vectors across variants.
4. **No secrets in Git, logs, API responses, or indexed documents.** Real values
   live in ignored `.env`. `.env.example` holds placeholders only.
5. **Do not claim a gate passed without running it.** A green build is not
   evidence of a latency, migration, or relevance gate.

## Known traps (all verified in this repo)

These are the mistakes an agent will most likely make here.

| # | Trap | What actually happens |
| --- | --- | --- |
| 1 | Adding a **required** field to `envSchema` in `lib/config.ts` | `lib/ingest/pipeline.test.ts` hand-builds a complete `AppConfig` literal in `minimalConfig()`; typecheck breaks. Give new vars defaults, or put new config in its own module. |
| 2 | Relying on `sort_by` being absent | `app/api/search/route.ts` declares `.optional().default('visual')`, so *omitted* and *explicit `visual`* are indistinguishable after parsing. Drop the default and apply it later if you need to tell them apart. |
| 3 | Adding a value to `SearchSortBy` | It is exported from `lib/es/search-core.ts` and consumed by `lib/live/search.ts`. Widening it ripples into live search, which must keep its behavior. |
| 4 | Calling `upsertAsset` to save one field | It **replaces the whole document** (`lib/es/index-assets.ts`), and `persistJob` calls it on every job update. Partial writes need `_update`. |
| 5 | Assuming an analyzer exists | `lib/es/indices.ts` declares **no analyzer at all** — everything uses `standard`, which splits Han per character, so `李政宰` matches any document containing `李`. Analyzer choice cannot change without a reindex. |
| 6 | Putting tests in `app/` or `scripts/` | `vitest.config.ts` includes only `lib/**/*.test.ts` and `worker/**/*.test.ts`. Your tests will silently not run. |
| 7 | Putting data files under `data/` | `data/**` is gitignored, excluded by `.dockerignore`, and mounted over by Compose. Versioned resources go in `config/`; only runtime media goes in `data/`. |
| 8 | Trusting the Elasticsearch version number | The target is Serverless, whose root API reports a *target* version that says nothing about feature availability. Probe capabilities at runtime. |

## Where to read, by task

The hybrid plan is ~950 lines. Read the section you need, not the whole file.

| Task | Read |
| --- | --- |
| Any hybrid work | `plan/03-hybrid-metadata-search-plan.md` §"Goal" + §"Current baseline", then the section below |
| Metadata schema, actor names, analyzers | plan §A, §A1, §A2 |
| Retrieval, candidate paths, ranking formula | plan §B |
| Query parsing / optional LLM | plan §C (and C1–C4) |
| Facet filtering and ID enumeration | plan §D |
| Mapping migration | plan "Mapping / migration" |
| Elasticsearch mechanics with sources | `reference/elastic-asset-metadata-and-bounded-retrieval.md` |
| What to build next, in order | `todo/02-hybrid-metadata-search-todo.md` |
| Why a decision was made | `reviews/hybrid-metadata-search-*.md` (three rounds, kept as evidence) |

For the shipped tracks: `docs/` holds the file-video contracts and
`docs/live-video-*.md` the live ones. `reference/` holds offline snapshots of
third-party documentation with source URLs in each file's frontmatter.

## Working style expected here

- **Verify before asserting.** This repository's reviews cite file:line and
  command output. If you claim Elasticsearch behaves a certain way, check the
  installed client typings in `node_modules/@elastic/elasticsearch` or the
  live docs, and say which.
- **Plans are corrected, not rewritten.** When a review finds a defect, fix the
  plan and record the disposition in the matching `todo/0N-*.md`. Review bodies
  are historical evidence and are never edited.
- **One concern per PR.** In particular, the change that converts ingest writes
  to partial updates touches existing code and must not be mixed with new
  feature work.
- **Branching.** Feature and planning work goes on a `plan/*` or feature branch
  and lands through a PR against `live-video-search`. Repo-level conventions
  (this file, `.gitignore`) may land directly. Planning branches are kept after
  merge when the squashed commit would otherwise lose a useful correction
  history — `plan/hybrid-metadata-search` is retained for that reason.
- **Run `yarn test` and `yarn build` before saying you are done**, and say which
  gates you did *not* run.

## Current state

`live-video-search` is the integration branch; `main` trails it. The hybrid
metadata feature is **planned only** — no `lib/metadata/`, no
`config/people.json`, no `meta.*` mapping exists yet. Phase 1 is ready to
start, and its first task is probing the target project for core analysis
plugins, because that answer determines the mapping and the mapping cannot
change later without a reindex.
