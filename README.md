# README — Jina Omni Video Search

Demo app: index video with `jina-embeddings-v5-omni-small`, store per-window
dual-track dense vectors in Elastic Serverless, and find a moment by text.

**Status (2026-08-26):** Phases 0–11 complete for the EIS path. End-to-end
verified on the public-domain *Breakfast at Tiffany’s* trailer (dual presets).
Details: [reviews/e2e-verification-2026-08-26.md](reviews/e2e-verification-2026-08-26.md).

---

## Prerequisites (NFR-7)

| Dependency | Notes |
| --- | --- |
| **Node.js 22+** | Verified on Node v22.13.1 |
| **yarn** | Project pin (`yarn@1.22.x`). Do not use npm for installs. |
| **ffmpeg / ffprobe** | On `PATH` (e.g. Homebrew) |
| **Elastic Serverless** | URL + API key in `.env`; omni embedding endpoint (default `.jina-embeddings-v5-omni-small`) |

Single developer machine (macOS on Apple Silicon assumed). No multi-user auth
or durable job queue (NFR-8).

---

## Setup

```bash
# 1. Install dependencies
yarn install

# 2. Copy env template and fill secrets locally (never commit .env)
cp .env.example .env
# Required for EIS: ELASTICSEARCH_URL, ELASTICSEARCH_API_KEY, EMBED_INFERENCE_ID
# Operational budget (typical): EIS_MAX_BINARY_BYTES=1048576
# EMBED_BUDGET_BYTE_LAYER=decoded_media

# 3. Ensure media directories exist (gitignored contents)
mkdir -p data/originals data/playback data/proxies data/thumbs data/uploads

# 4. Create indices (idempotent)
yarn setup-indices
```

Malformed `.env` values fail fast via `lib/config.ts` (zod) with the offending
variable name.

Optional:

| Env | Effect |
| --- | --- |
| `LOCAL_IMPORT_ROOT` | Enable local-path import mode |
| `JINA_API_KEY` | Hosted Jina provider (+ set `EMBED_PROVIDER=jina`) |
| `LOCAL_EMBED_URL` | Local provider (+ set `EMBED_PROVIDER=local`) |
| `CHUNK_PRESET` | Process default when request omits `chunk_preset`: `standard` (64s/4s), `60s`, `30s`, `20s`, or `fine` (10s/2s). Per-import UI/API overrides this. |

---

## Start

```bash
yarn dev
# → http://localhost:3000
# Routes: / (search) · /ingest · /library

yarn build && yarn start   # production-like
```

### Docker (external media folder)

Image includes **ffmpeg**. Media lives on the host via a bind mount (`MEDIA_ROOT=/app/data`).

```bash
# Once on the host (uses your .env + Elastic):
yarn setup-indices

# Default: mount ./data
docker compose up --build

# Or mount any external folder for videos / proxies / thumbs / uploads:
VIDEO_DATA_DIR=/path/to/your/video-store docker compose up --build

# Optional port override
APP_PORT=3000 VIDEO_DATA_DIR=/Volumes/Videos/jina-data docker compose up --build
```

Open **http://localhost:3000**. Stop with `Ctrl+C` or `docker compose down`.

Do **not** bake `.env` into the image; compose passes it via `env_file`.

UI stack (pinned): Next.js **14.2.35** · React **18.3.1** · EUI **119.1.0** ·
Borealis **8.0.0** · Emotion 11 · **no Tailwind**. EUI is client-side only
(possible brief FOUC before Emotion injects).

---

## Scripts

| Command | Purpose |
| --- | --- |
| `yarn probe` | Measure EIS ceilings / task settings |
| `yarn setup-indices` | Create `video-assets` / `video-chunks` |
| `yarn test` | Unit tests (vitest) |
| `yarn test-embed-compat` | Embedding modality fixtures |
| `yarn test-video-pipeline` | Proxy encode vs budget |
| `yarn smoke-phase8-search` | Search smoke against indexed chunks |
| `yarn phase10-e2e` | Tiffany dual-variant E2E (needs credentials + ffmpeg) |
| `docker compose up --build` | Run app in container with mounted media dir |

---

## Docs map

| Doc | Content |
| --- | --- |
| [docs/architecture.md](docs/architecture.md) | System overview |
| [docs/data-flow.md](docs/data-flow.md) | Ingest + search flows |
| [docs/data-model.md](docs/data-model.md) | ES mappings |
| [docs/api-contract.md](docs/api-contract.md) | REST + SSE |
| [docs/ui-mockup.md](docs/ui-mockup.md) | Built UI layout |
| [docs/operations.md](docs/operations.md) | Measured spike / probe / E2E numbers |
| [plan/00-implementation-plan.md](plan/00-implementation-plan.md) | Single plan |
| [todo/00-todo.md](todo/00-todo.md) | Phase checklist |
| [chn.docs/架构与数据流.md](chn.docs/架构与数据流.md) | 中文架构要点 |

---

## Known limits (from E2E / probes)

- **Picture quality** is capped by the **1 MB** operational decoded-media budget
  on EIS; Tiffany proxies landed ~0.9 MB at full 1270×720 with CRF 26–30.
- **Temporal precision:** standard 64 s windows are coarse (top-1 can miss a late
  beat that still appears in top-3); fine 10 s / 2 s reached **5/5** top-1 on
  the fixture set.
- **Providers:** hosted Jina (**OQ2**) and local embed URL not probed.
- **Import:** upload path verified; full live URL re-download optional; local
  mode needs `LOCAL_IMPORT_ROOT`.
- **UI:** client-only EUI may FOUC; browser click-to-play timing not instrumented
  (Range **206** verified at API).
- Do **not** compare scores to Elastic’s published Tiffany demo (different
  chunking / candidate set).

Self-review: [reviews/self-review-2026-08-26.md](reviews/self-review-2026-08-26.md).
