# Self-review — 2026-08-26

Post Phase 10 / Phase 11 documentation close-out. Complements
[e2e-verification-2026-08-26.md](./e2e-verification-2026-08-26.md). Does **not**
replace earlier readiness reviews (those files are historical and not rewritten).

---

## Verdict

The demo meets its stated acceptance for an EIS-backed, dual-track video search
on a single developer machine. Remaining gaps are mostly optional providers,
optional import modes, and inherent trade-offs of the byte budget and window
presets — not blocking bugs for the primary path.

---

## Picture quality under the measured byte budget

| Fact | Source |
| --- | --- |
| Operational ceiling | **1 048 576** decoded bytes (`EIS_MAX_BINARY_BYTES`) — **operational**, aligned with Serverless docs |
| Probe lower bound | No size-limit 400 up to ~**3.1 MB** on direct `_inference/embedding` (OQ1 partial) |
| Tiffany proxies | ~**907–920 KB** at **1270×720**, CRF **26** (fine) / **30** (standard), ladder strategy |

**Assessment:** Under the 1 MB operational budget the encoder kept native trailer
resolution and only stepped CRF, so visual quality is “good enough for a demo”
rather than bitrate-starved. The hard constraint remains: the model samples at
most **32 frames** per window regardless of window length, so dollars of budget
should stay on those frames — which the ladder does. Raising the operational
budget toward the probe lower bound is an experiment, not a requirement, until
a true ceiling (first 400) is mapped.

---

## Temporal precision: 64 s windows vs fine preset

| Preset | Window / overlap | Tiffany windows | Fixture top1 / top3 |
| --- | --- | --- | --- |
| standard | 64 s / 4 s | 3 | **4/5** / **5/5** |
| fine | 10 s / 2 s | 20 | **5/5** / **5/5** |

**Assessment:** Standard windows are intentionally coarse. Early scenes often
“win” top-1 by covering a large span; late beats (e.g. rain kiss) can land
top-2 while still counting as a top-3 success. Fine preset localizes to ~10 s
labels and cleared all five fixtures at top-1. For demos that care about
*when*, prefer **fine** (or both variants side-by-side). Neither matches
PySceneDetect scene cuts used in Elastic’s public numbers — score comparison
across corpora remains invalid.

---

## Client-only EUI / residual FOUC

| Decision | Rationale |
| --- | --- |
| Next **14.2.35** + React **18.3.1** + EUI **119.1.0** | Only combination inside both declared support ranges |
| Client-only Emotion / EUI | Official SSR support for EUI + Next is still lacking |

**Assessment:** Phase 1 spike passed (no hydration / duplicate React / Emotion
insertion failures). Residual risk is **FOUC**: `curl` HTML lacks Emotion
tags until hydration. Acceptable for this demo; mitigate with
`dynamic(..., { ssr: false })` if first paint becomes a product issue. No
evidence of incorrect interactive behaviour from this path in the spike.

---

## Embedding `query_vector_builder` maturity

| Path | Status |
| --- | --- |
| EIS query | `query_vector_builder.embedding` **works** in probe (~343 ms) and Phase 10 searches (~62–196 ms) |
| EIS task field | Top-level `task` **rejected**; use `input_type` where needed (OQ3) |
| jina / local query | App-side `query_vector` with `retrieval.query` — implemented, **unexercised** live without keys |

**Assessment:** Builder is “new surface area” relative to classic dense_vector
workflows, but it is **proven** on this Serverless project for text→video knn.
Fallback code for app-side vectors already exists for other providers. Risk is
provider-portability and undocumented task settings, not day-to-day EIS search.

---

## Remaining gaps

| Gap | Severity | Notes |
| --- | --- | --- |
| **OQ2** — hosted Jina binary ceiling | Open | Needs `JINA_API_KEY` + probe |
| **LOCAL_IMPORT_ROOT** unset | Optional | Local path mode disabled until configured |
| Full **URL ingest** E2E via API | Partial | Sanitize + offline Commons fetch done; live re-download opt-in (`PHASE10_URL_IMPORT=1`) |
| **Jina / local** providers in production path | Unprobed | Code present; isolation policy forbids mixing in one variant |
| Browser **click-to-play ≤1 s** | Unmeasured | Range **206** verified; UI timing not instrumented |
| Formal search **p95** multi-run | Soft | All measured samples ≪ 2 s target |
| `hive-mind` submodule | Cancelled / blocked | Private repo |
| EIS token accounting in responses | Missing fields | Workload estimate uses call counts |

---

## Documentation hygiene (Phase 11)

- `docs/architecture.md`, `data-flow.md`, `ui-mockup.md` written to match the
  built system.
- `docs/operations.md` separates **measured** / **cited** / **operational**.
- Placeholder “TBD” for Phase 10 search latency removed.
- README lists real yarn scripts and E2E-known limits.

---

## Conclusion

Ship the EIS demo as-is for walkthroughs. Prefer the **fine** variant when
temporal demos matter; keep **standard** for cheaper ingest. Close OQ2 and
configure `LOCAL_IMPORT_ROOT` only when those paths are needed for a talk or
customer environment.
