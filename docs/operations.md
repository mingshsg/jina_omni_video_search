# Operations

Measured fields and runtime notes. Claims marked **measured** come from a
recorded run; **cited** values come from vendor docs or source constants.

| Label | Meaning |
| --- | --- |
| **measured** | Observed in this repo’s spike / probe / smoke / E2E on the developer machine |
| **cited** | External doc, OpenAPI, or checked-in source constant — not re-proven here |
| **operational** | Chosen budget / default used in `.env` (may be stricter than measured ceiling) |

---

## Deployment assumption (NFR-7)

- Single developer machine, macOS on Apple Silicon
- Start: `yarn dev` or `yarn build && yarn start`
- Host deps: Node 22+, ffmpeg/ffprobe on `PATH`, **yarn**

---

## UI stack spike (Phase 1 gate)

**Measured** **2026-08-26** on Node v22.13.1 / yarn 1.22.22 (macOS darwin 25.6).

| Item | Value | Status |
| --- | --- | --- |
| next | 14.2.35 | **pass** |
| react / react-dom | 18.3.1 / 18.3.1 | **pass** |
| @elastic/eui | 119.1.0 | **pass** |
| @elastic/eui-theme-borealis | 8.0.0 | **pass** |
| @emotion/react / @emotion/css / @emotion/cache | 11.14.0 / 11.13.5 / 11.14.0 | **pass** |
| Package manager | yarn 1.22.22 | project pin |
| `yarn dev` | Ready; `GET /` 200 on :3458; compile OK | **pass** |
| `yarn build && yarn start` | build OK; `GET /` `/ingest` `/library` 200 | **pass** |
| Hydration / Emotion / duplicate React | No hydration warnings in server logs; single `react@18.3.1`; headless Chrome showed `data-emotion` + interactive control | **pass** |

**Gate rule:** fail on peer warnings promoted to errors, hydration errors,
duplicate React, Emotion insertion errors, or runtime failures.

**Notes / residual risk**

- Static HTML from `curl` can lack `<style data-emotion>` tags; styles appear
  after client hydration (**FOUC**). Accepted residual risk for client-only EUI.
- Fallback if FOUC becomes unacceptable: wrap EUI pages in
  `dynamic(..., { ssr: false })`.

### Resolved versions (post-`yarn install`)

```
next@14.2.35
react@18.3.1
react-dom@18.3.1
@elastic/eui@119.1.0
@elastic/eui-theme-borealis@8.0.0
@emotion/react@11.14.0
@emotion/css@11.13.5
@emotion/cache@11.14.0
@elastic/datemath@5.0.3
moment@2.30.1
zod@3.25.76
@elastic/elasticsearch@8.19.2
typescript@5.9.3
@types/react@18.3.18
@types/react-dom@18.3.5
tsx@4.23.12
```

No Tailwind in `package.json`.

---

## Phase 2 probe status

**Completed 2026-08-26** via `yarn probe` (`scripts/probe-capabilities.ts`).

| Item | Result |
| --- | --- |
| Elasticsearch | **9.6.0** Serverless (**measured**) |
| Probe script | `scripts/probe-capabilities.ts` |
| Report JSON | `data/uploads/probe-report.json` (gitignored) |
| Byte layer | `decoded_media` (**measured** ladder input) |

### EIS endpoint

| Field | Value | Kind |
| --- | --- | --- |
| inference_id | `.jina-embeddings-v5-omni-small` (preconfigured) | **measured** discovery |
| task type | `embedding` | **measured** |
| model | `jina-embeddings-v5-omni-small` | **measured** |
| dimensions | **1024** | **measured** (matches model card; no truncation) |
| service | `elastic` (EIS) | **measured** |

### Provider budgets

| Provider | Env var | Ceiling | First failing payload | Kind / notes |
| --- | --- | --- | --- | --- |
| eis (video) | `EIS_MAX_BINARY_BYTES` | **≥ 3,160,395 B** (no 400) | none in ladder | **measured** |
| eis (audio) | (same) | **≥ 3,146,070 B** (no 400) | none in ladder | **measured** |
| eis (in `.env`) | `EIS_MAX_BINARY_BYTES` | **1,048,576** | n/a | **operational** — Serverless docs cite 1 MB fixed decoded limit ([reference/elastic-semantic-field-reference.md](../reference/elastic-semantic-field-reference.md)); probe did not hit a size-limit 400 up to ~3 MB on direct `_inference/embedding` |
| jina | `JINA_MAX_BINARY_BYTES` | not measured | — | **OQ2 open** — no `JINA_API_KEY` |
| local | `LOCAL_MAX_BINARY_BYTES` | not measured | — | `LOCAL_EMBED_URL` unset; `jina-airgap` source default 10 MB is a **cited** constant only |

### Open questions (OQ)

| ID | Status | Finding |
| --- | --- | --- |
| **OQ1** | **Resolved (partial)** | Direct `_inference/embedding` on ES 9.6 Serverless accepted decoded video/audio up to ~3.1 MB with no size-limit HTTP 400. Documented 1 MB Serverless cap was **not** hit. Operational encoder budget stays **1 MB**. |
| **OQ2** | **Open** | Hosted Jina API not probed — no `JINA_API_KEY`. |
| **OQ3** | **Resolved** | Top-level `task` field **rejected** (400 unknown field). `input_type=ingest` **changes** text embedding vs baseline (accepted). Use `input_type` for query/passage distinction on EIS. |

### Task / query-side behavior (**measured**)

| Test | Outcome |
| --- | --- |
| `input_type=ingest` vs default | Embedding vector **differs** — honored |
| Top-level `task=retrieval.query` | **400** — unknown field on `EmbeddingRequest` |
| `query_vector_builder.embedding` + text `input` on `dense_vector` | **pass** — 1 hit in ~343 ms (Phase 2) |

### Latency / tokens (Phase 2, single run, **measured**)

| Modality | ms | dims | tokens observed |
| --- | --- | --- | --- |
| text query | ~89 | 1024 | none in response |
| video (sample ~200 KB) | ~2207 | 1024 | none in response |
| audio (sample ~100 KB) | ~452 | 1024 | none in response |

Token fields (`video_tokens`, `audio_tokens`) were not present on this EIS
response shape (`embeddings[]` only). Workload estimate therefore counts
**inference calls**, not token billing.

---

## Encoder constants (**cited** in code)

From `lib/video/types.ts` (used by proxy encode):

| Constant | Value |
| --- | --- |
| `RESOLUTION_RUNGS` long edges | `[1280, 960, 854, 720, 640]` |
| `DEFAULT_CRF_LADDER` | `[23, 26, 28, 30, 32]` |
| `FRAME_REDUCTION_LADDER` | `[32, 24, 16]` |
| Model max frames (**cited** model card) | **32** evenly spaced |

---

## Phase 10 E2E (Tiffany trailer)

Full report: [reviews/e2e-verification-2026-08-26.md](../reviews/e2e-verification-2026-08-26.md).
Runner: `yarn phase10-e2e`.

| Item | Value | Kind |
| --- | --- | --- |
| Corpus duration | **157.459 s** full trailer | **measured** |
| standard windows | 3/3 ready; ~40.1 s; ~5.1 win/min; sample proxy **920 194 B**, CRF **30** | **measured** |
| fine windows | 20/20 ready; ~65.2 s; ~19.9 win/min; sample proxy **907 880 B**, CRF **26** | **measured** |
| Search relevance | standard top1 **4/5**, top3 **5/5**; fine top1 **5/5**, top3 **5/5** | **measured** (same-corpus range overlap) |
| Search wall time | **~62–196 ms** / query | **measured** |
| Media Range | HTTP **206** mid-file seek | **measured** |
| URL / local E2E | sanitize OK; full URL re-download optional; local skipped (`LOCAL_IMPORT_ROOT` unset) | partial |

---

## Search latency summary

| Metric | Target | Result | Kind |
| --- | --- | --- | --- |
| Warm text search | &lt; 2 s p95 | Phase 8 smoke (~1 chunk): **~200 ms**; Phase 10 Tiffany corpus: **~62–196 ms** per fixture | **measured** (not a formal multi-run p95 percentile; all samples ≪ 2 s) |

```bash
yarn smoke-phase8-search
yarn phase10-e2e
```

---

## Useful scripts

| Script | Purpose |
| --- | --- |
| `yarn probe` | Capability / budget probe |
| `yarn setup-indices` | Idempotent index create |
| `yarn test` | Vitest unit tests |
| `yarn test-embed-compat` | Provider modality fixtures |
| `yarn test-video-pipeline` | Proxy budget smoke |
| `yarn smoke-phase8-search` | Search API smoke |
| `yarn phase10-e2e` | Full Tiffany dual-variant E2E |
| `yarn dev` / `yarn build` / `yarn start` | App |
