# Search UI polish — 2026-09-23

Follow-up to hybrid Phase 4 search UX (filters accordion, explain flyout,
smart-parse placement, hybrid help as tooltip).

## Done

- [x] Text search: Filters `EuiAccordion` collapsed by default + active count
- [x] Text search: Smart parse switch beside Search (no helpText); ZH label
      `智能解析`
- [x] Text search: Hybrid long helpText removed; `EuiIconTip` on FormRow label
      (reuses `hybridTextHelp`)
- [x] Text search: `SearchQueryExplainFlyout` + Results “Executed query /
      已执行查询”
- [x] Image search: Filters accordion collapsed by default + active count
- [x] i18n EN+ZH: `parseQuery*` shortened; `queryExplain*` present
- [x] Gates: `yarn test` (57 files / 333 tests), `yarn build` (pass after
      clean `.next`; first attempt hit transient `pages-manifest.json` ENOENT)

## Notes

Hybrid tip clarifies: facet filters are optional; switch on = BM25 metadata +
vector fusion; off = pure vector.
