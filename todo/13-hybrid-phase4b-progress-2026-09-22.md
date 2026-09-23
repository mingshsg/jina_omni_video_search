# Hybrid Phase 4b progress — 2026-09-22

Plan §Auto-enrichment / Phase 4b. Main todo: [`todo/02-hybrid-metadata-search-todo.md`](./02-hybrid-metadata-search-todo.md).

## Done (local, no network)

- [x] Title normalization (`normalizeTitle`) — strip extension, separators,
      quality noise; never invents a separate filename or exposes paths
- [x] Work-title extraction + abstention (`analyzeTitleClues`) for empty /
      generic / too-short titles
- [x] Title-clue `description` / `abstract` drafts that restate the title only
      (explicit non-claim of scenes/cast/events); EN + ZH wording
- [x] Explicit-token `tags` (type tokens + unambiguous year)
- [x] Wired through existing `POST …/meta/suggest` + Edit flyout merge
- [x] Response includes `title_clues` for transparency

## Deferred (needs product decision)

- [ ] Approved external catalog (attribution / reuse / cost / timeout)
- [ ] Text-only LLM wording from verified catalog facts
- [ ] Accuracy / abstention / cost gates before enabling network lookup

Until those decisions land, Suggest remains **provider: local** only.
