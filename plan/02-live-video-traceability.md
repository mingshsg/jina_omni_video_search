# Live Video Planning Traceability

Status: **planning complete; implementation not started**  
Date: **2026-09-10**

This matrix is the implementation handoff index. It connects each canonical
capability to its detailed requirements, architecture rules, delivery phase, and
acceptance evidence. It does not replace those documents.

| Capability | Requirements | Architecture | Phase | Required acceptance evidence |
| --- | --- | --- | --- | --- |
| CAP-1: source/session control | LVR-FR-1–4, LVR-FR-23 | AD-1, AD-2, AD-5, AD-11, AD-14, AD-17 | 1, 2, 4, 6, 8 | source validation states; concurrent idempotent start; worker-unavailable response; start/stop/reconnect UI flow |
| CAP-2: deterministic windows | LVR-FR-5–9 | AD-2–4, AD-12, AD-16 | 2–4 | four-fragment/three-step fixtures; 2.03-second drift; no cross-epoch window; incomplete-tail record |
| CAP-3: immediate searchability | LVR-FR-10–14 | AD-6–8, AD-13, AD-15 | 3–6 | visible-before-event assertion; bounded bulk queue; cross-rollover lookup; outbox crash matrix; matching fingerprints |
| CAP-4: text/image live search | LVR-FR-15–17 | AD-4, AD-8, AD-9, AD-15 | 6–9 | variant and branch filters; one inference per follow TTL; per-session cursor replay; logical-ID collapse |
| CAP-5: operational health | LVR-FR-3–4, LVR-FR-20–21 | AD-5, AD-12–13, AD-15, AD-17 | 4, 6, 8, 9 | state/reason transitions; queue/spool high-water; explicit drops; p50/p95/p99 stages |
| CAP-6: retained playback | LVR-FR-18–19, LVR-FR-22 | AD-4, AD-10, AD-16 | 3, 7–9 | aligned thumbnail/clip; Range and 410 behavior; no traversal/symlink escape |
| CAP-7: restart recovery | LVR-FR-9, LVR-FR-12–14, LVR-NFR-4 | AD-4–7, AD-15 | 1, 3–5, 9 | every recovery-matrix fault; no duplicate logical hit; stopped-session replay |
| CAP-8: safe remote input | LVR-FR-24–25, LVR-NFR-7 | AD-2, AD-11, AD-14 | 1, 2, 6, 9 | no web secret access; SSRF/rebinding/protocol tests; redaction scan; egress proof |
| Elastic deployment boundary | LVR-NFR-10 | AD-8 | 1, 5, 9 | no local Elasticsearch service/container; recorded `.env` endpoint origin; scratch-resource cleanup; existing indices unchanged |

## Phase Exit Evidence

| Phase | Exit artifact |
| --- | --- |
| Planning prerequisite | current review says planning complete; links and terminology checks pass; 50-window feasibility spike is the Phase 3 entry gate |
| 1: contracts and storage | unit results, worker capability manifest, target Elasticsearch setup/read-back report |
| 2: RTSP adapter | adapter/security test results, MediaMTX connect/reconnect trace, and 50-window feasibility-spike report before Phase 3 |
| 3: fragments/windows | deterministic fixture manifest and crash-boundary unit results |
| 4: worker/recovery | restart, singleton, slow-consumer, and stopped-session reconciliation report |
| 5: embedding/indexing | provider-call trace, full-stream pre-create lookup, bulk item results, outbox recovery, service-time/429-storm results, file-ingest regression |
| 6: APIs/SSE | route contract matrix, cursor replay/gap/expiry tests, redaction scan |
| 7: search/media | file-response compatibility fixture, follow-cache count, media security/expiry results |
| 8: UI | browser flow, accessibility output, hydration log, stale-revision test |
| 9: RTSP readiness | one dated run manifest and current implementation review under `reviews/` |
| 10: protocol extensions | one independent acceptance report per adopted protocol |

## Change Control

Any change to source secret ownership, session identity, event ordering, window
identity, vector dimensions, retention ordering, worker/web replica assumptions,
Elastic deployment boundary, or protocol security requires updates to the spec, architecture spine, affected
contract, implementation plan, TODO, and this matrix before implementation
continues.
