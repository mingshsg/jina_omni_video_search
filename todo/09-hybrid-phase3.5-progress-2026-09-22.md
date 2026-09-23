# Hybrid Phase 3.5 progress — 2026-09-22

Plan §C / Phase 3.5. Main todo: [`todo/02-hybrid-metadata-search-todo.md`](./02-hybrid-metadata-search-todo.md).

## Done

- [x] Deterministic dictionary matcher (`lib/metadata/query-parse.ts`)
- [x] Config: `ASSET_SEMANTIC_ENABLED`, `QUERY_PARSER_PROVIDER`
- [x] Mapping: `meta.description_embedding` + `description_embedding_meta`
- [x] `hybrid.parse_query` API (default false) + `meta.parse`
- [x] Save-time description embed behind flag; mark `stale` on text edit;
      publish only if revision still matches; failure → `failed` without
      failing the PATCH (`lib/metadata/description-embed.ts`)
- [x] Semantic asset knn branch (`state: current` only) + `w_semantic=0.3`
- [x] Extracted-facet boosts `w_facet=0.2`; hard filters win over boosts;
      `suppress_extracted` for dismissed chips
- [x] Sceneless parse down-weights vector channels (`×0.25`)
- [x] UI: parse switch, boost chips (promote/dismiss), parse-detail accordion

## Still open

- [ ] Two rapid consecutive edits race test against live ES
- [ ] Assert no chunk/`variant_id` mutation when semantic flag is on
- [ ] Labeled BM25-only vs BM25+semantic / raw vs dictionary measurement
- [ ] Hide parse switch when `QUERY_PARSER_PROVIDER=none` (needs config expose)
