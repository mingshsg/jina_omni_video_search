# Hybrid Phase 4a progress — 2026-09-22

Plan §Auto-enrichment / Phase 4a. Main todo: [`todo/02-hybrid-metadata-search-todo.md`](./02-hybrid-metadata-search-todo.md).

## Done

- [x] `lib/metadata/suggest-local.ts` — year (unambiguous 19xx/20xx),
      video_type (title tokens), language only from explicit `media_language`
- [x] `POST /api/library/{videoId}/meta/suggest` — draft only, never writes
- [x] Library Edit flyout **Suggest** button; merges into empty fields only;
      late responses dropped; typing during request wins
- [x] PATCH optional `field_sources` so accepted suggestions persist as
      `review.*.source = suggestion`
- [x] Docs: `docs/api-contract.md`; i18n EN/ZH

## Not in 4a

- Actors / country / description drafts (manual or Phase 4b)
- External catalog lookup / generative wording (Phase 4b decision)
- Media-language tags on the asset document (probe does not store them yet;
  clients may pass `media_language` when known)
