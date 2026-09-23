# Hybrid metadata search — Phase 3 / 3.5 / 3.6 review fixes

Date: 2026-09-22  
Source review: [`hybrid-metadata-search-phase3-3.5-3.6-review-2026-09-22.md`](./hybrid-metadata-search-phase3-3.5-3.6-review-2026-09-22.md)

## Summary

All four **P1** findings and the actionable **P2** code findings from the combined Phase 3–3.6 review were fixed. Unit suite: **310** passed. New AppConfig fixture tsc errors cleared (remaining ~41 are the pre-existing live `ProcessEnv` baseline). Live semantic/EIS acceptance gates remain open (need configured endpoints).

## P1 fixes

| Finding | Fix |
| --- | --- |
| Facet term dwarfed RRF ranks (`+0.2` raw) | `facetBoostScore` now uses `rrfTerm(w_facet, 1) × matched/selected`; plan §C arithmetic updated to match. Rank-order + unrelated-video negative tests added. |
| Semantic ranks without chunk expansion | After semantic asset kNN, assets absent from the global/BM25 union get the same bounded floor/pooled chunk expansion as lexical assets. |
| EIS `null` could not clear dictionary | `validateEisParsePayload` records `cleared` for explicit null/empty; merge deletes those dictionary fields. Test: `Audrey Hepburn interview` + `video_type:null`. |
| Silent `msearch` item failure | Floor responses must match asset count; per-item `error` / missing `hits` / HTTP ≥400 throw → existing text-path fallback (`text_channel_status=failed`). |

## P2 fixes

| Finding | Fix |
| --- | --- |
| Semantic identity not filtered | Semantic kNN filter requires `provider`/`model`/`task`/`dims` matching active config, not only `state:current`. |
| `parse.applied` lied | Hybrid returns `boost_effects` from candidate facet matches; route overwrites `applied`/`rejected` (`no_effect` / `snapshot_unavailable`). Parser-only (`use_text=false`) reports `hybrid_text_required`. `QUERY_PARSER_FACET_MODE=filter` merges extracted into hard filters. |
| EIS skip blocked CJK generalization | `no_catalog_hit` still skips ASCII scene queries; CJK/Hangul queries (e.g. `南朝鲜的片子`) call EIS. Plan §C2 skip note updated. |
| Actors validated vs full catalog | Validation accepts optional `allowedActorIds` from the prompt candidate list. |
| Sync embed + stranded stale | PATCH schedules fire-and-forget publish (8s soft bound). Publish re-reads asset and publishes under **current** revision; identity+digest skip when already current. |
| Embed metrics ignored speculative | Route passes `speculativeEmbed` + `priorEmbedCalls`; hybrid awaits after eligibility, counts speculative + residual accurately. |
| AppConfig fixtures | `chunk-presets` / `pipeline` test factories include `ASSET_SEMANTIC_*` and `QUERY_PARSER_*`. |

## Still open (acceptance)

- Live EIS + semantic paths on a configured project
- ~50-pair parse over-trigger / p50/p95 with real completion endpoint
- Labeled video/scene Recall@5, embedding cosine check, full UI regression
