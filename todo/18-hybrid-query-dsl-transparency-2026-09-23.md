# Todo — Hybrid / query DSL transparency (2026-09-23)

## Done

- [x] Explain `no_effect` vs confidence for extracted country (candidate snapshot match, not parse confidence)
- [x] UI: Smart parse on → auto-enable Include text (`use_text`); disable hybrid switch while parse is on
- [x] API: `meta.query_dsl` — truncated asset BM25 + knn filter summary; parse-only → `status: not_applied` / `hybrid_text_required`
- [x] UI accordion “Hybrid / query DSL” near Results
- [x] i18n EN/ZH; `docs/api-contract.md` note
- [x] `yarn test` + `yarn build` (run in this change)

## Out of scope

- Suggest / Wikidata (paused)
- Auto-commit
