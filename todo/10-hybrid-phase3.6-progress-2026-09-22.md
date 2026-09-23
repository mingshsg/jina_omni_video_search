# Hybrid Phase 3.6 progress — 2026-09-22

Plan §C2. Main todo: [`todo/02-hybrid-metadata-search-todo.md`](./02-hybrid-metadata-search-todo.md).

## Done

- [x] Config: `QUERY_PARSER_TIMEOUT_MS` (800), `MAX_TOKENS`, `FACET_MODE`,
      `CACHE_TTL_MS`, `CACHE_MAX`, `CONCURRENCY`; eis requires inference id
- [x] EIS `client.inference.completion` client (`eis-completion.ts`) with
      **separate** parser concurrency gate (not `EMBED_CONCURRENCY`)
- [x] Prompt + catalog validation + one repair retry; timeout/malformed →
      dictionary fallback (never fails search)
- [x] Skip EIS on exact alias / no catalog hit; three-tier eis→dictionary→raw
- [x] Parse result cache (TTL+LRU on `globalThis`)
- [x] Speculative parallel embed of full query when residual matches
- [x] Labeled parse set (`parse-eval.ts`, 25 cases) + dictionary over-trigger
      gate (<25%)
- [x] `yarn probe-query-parser` ops probe (no secrets in output)
- [x] Wire `POST /api/search` via `resolveQueryParse`
- [x] `.env.example` documents parser variables

## Ops note

Create the completion endpoint out-of-band:

`PUT _inference/completion/<id>` backed by `google-gemini-3.5-flash-lite`,
then set `QUERY_PARSER_PROVIDER=eis` and `QUERY_PARSER_INFERENCE_ID=<id>`.
Run `yarn probe-query-parser` to verify. Structured-output via `task_settings`
is soft-hinted (`max_tokens`); correctness is catalog validation, not the
provider schema.

## Still open / deferred

- [ ] Live EIS+dictionary over-trigger comparison on a full ~50-pair set with
      measured p50/p95 (requires a configured completion endpoint)
- [ ] Confirm Gemini `responseSchema` passthrough on the target Serverless
      project (probe documents availability)
