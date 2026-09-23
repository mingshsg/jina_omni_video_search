# Todo — Smart-parse chip state model (2026-09-23)

Plan: `plan/05-parse-chip-state-model.md`. Origin: user report that
"Use as filter" appears inconsistently; investigation showed chips already
render from `extracted` but collapse every non-boosting reason into one
`unused` state, and that promote/dismiss suppression leaks across queries.

Decisions taken 2026-09-23 (recorded so they are not re-litigated):

- Auto re-search on promote / dismiss / restore: **yes**, with a request
  sequence guard.
- Dismiss: **kept**, shrunk to an inline ×; dismissed chips collapse to one
  "Ignored N · Restore" row.
- Suppress key: `field:value`, scoped to the submitted query text.
- Promote no longer writes suppress; rely on `boostsMinusHardFilters`.
- `hard_filter` chips shown without actions; edit in Facets panel.
- Validation-rejected values (`not in catalog`, `out of range`) never become
  chips.

## PR-A — fixes, no contract change

- [x] `promoteChip` stops pushing into `suppress_extracted`
- [x] Suppress list resets when the submitted (trimmed) query changes
- [x] `runSearch` request-sequence guard; stale responses ignored
- [x] `filtersDirty` reflects post-reset suppress state (no extra code
      needed — it already reads `suppressExtracted` state, which the
      query-change reset updates via `setSuppressExtracted([])`)
- [x] `yarn build` PASS (`app/page.tsx` 14.2 kB, no new warnings)
- [x] `yarn test` — 380 passed (61 files), same as before the change
      (no `lib/` files touched in PR-A)
- [ ] Manual: promote → clear facet by hand → chip returns to boosting/no_effect
      (not run — needs a browser session against live data; PR-B changes
      chip status rendering anyway, defer to PR-B's manual matrix)

## PR-B — status model in `lib/`

- [x] `lib/metadata/parse-chips.ts`: `deriveParseChips(...)` with statuses
      `suppressed | hard_filter | filter_mode | hybrid_off |
      snapshot_unavailable | no_effect | boosting`
- [x] `parse-chips.test.ts`: one case per status; precedence; year range
      label; filter-mode; validation-rejected → no chip (18 tests)
- [x] `app/page.tsx` renders from `deriveParseChips`; × for dismiss;
      collapsed ignored row with Restore; `no_effect` shows Use as filter
      as primary with tooltip "not in current candidates"
- [x] i18n EN/ZH per status; retired `parseChipUnused` /
      `parseChipBoosting` / `parseChipDismiss` in favour of
      `parseChipStatus*` + `parseChipHint*` + `parseChipRestore` /
      `parseChipIgnoredCount`
- [x] Client suppress keys become `field:value` (mapped down to bare field
      names in `runSearch` via `suppressKeyField` at send time — server
      still only accepts field-level `suppress_extracted` until PR-C)
- [x] `yarn test` — **398 passed (62 files)**, i.e. the prior 380 (61 files)
      plus the new `lib/metadata/parse-chips.test.ts` (18 tests, 1 file)
- [x] `yarn build` — PASS, `/` route 15 kB / 429 kB First Load JS, no new
      warnings, no type errors (`diagnostics` on `app/page.tsx` clean)
- [ ] Manual matrix from plan §"Manual verification matrix" — **browser
      session against live data not run** (same caveat as PR-A). Reasoned
      through instead against `deriveParseChips` inputs/outputs, each row
      backed by an existing unit test:
      | Row | Covered by | Result |
      | --- | --- | --- |
      | `Korean kissing`, pool has KR → `KR · boosting` | "marks a matched, hybrid-scored facet as boosting" | reasoned OK |
      | `Korean kissing`, pool has no KR → `KR · no_effect`, Use as filter primary | "marks a facet with zero fusion-candidate matches as no_effect, not hidden" | reasoned OK |
      | Smart parse on, hybrid off → `KR · hybrid_off`, only Use as filter | "marks a facet as hybrid_off when parse ran without the text channel" | reasoned OK |
      | country=KR hand-selected → `KR · hard_filter`, no actions | "marks every value on a field as hard_filter once any value on that field is hand-selected" | reasoned OK (rejected reason still `no_effect` pre-PR-C; status derives from `handFacets`, not from the rejected reason, so this holds today) |
      | × on KR, then search `Japanese kissing` → `JP` not suppressed | "does not suppress a different value on the same field (value-scoped suppression)" + `lastSubmittedQueryRef` reset from PR-A | reasoned OK |
      | × then Restore → chip returns, search re-runs | `restoreSuppressedChips` clears `suppressExtracted` and calls `runSearch` | logic present, not unit-tested (UI wiring, no pure-fn boundary) — **not verified** |
      | `QUERY_PARSER_FACET_MODE=filter` → all chips `filter_mode`, eval note shown | "marks every extracted value as filter_mode" + `filterModeActive` → `EuiCallOut` | reasoned OK |
      Only the Restore-then-re-search row has no automated coverage and is
      genuinely unverified end-to-end; everything else is verified at the
      pure-function boundary but **not** through an actual browser + live
      Elasticsearch pool, so treat this whole matrix as "logic verified,
      integration not verified" until someone runs it against `yarn dev`.

## PR-C — additive contract

- [ ] Route reports `rejected[].reason = 'hard_filter'` for boosts dropped by
      `boostsMinusHardFilters` (pure helper + test)
- [ ] `suppress_extracted` accepts `field[:value]`, item max length 128;
      value-level for `actor_ids` / `country` / `video_type`; `year` stays
      field-level
- [ ] Client sends `field:value` directly
- [ ] `docs/api-contract.md`: promote the "Planned" block to normative;
      `chn.docs/` mirror
- [ ] Regression assertion: no suppress + no hand filters ⇒ `applied` /
      `rejected` unchanged vs. fixtures

## Open

- [ ] Decide whether `hard_filter` chips stay visible (plan Decision 7)
- [ ] Measure whether chip clicks re-embed the same query; add a short-TTL
      text-query cache only if it shows in p95
- [ ] Wire dismiss events into the C4 over-trigger fixture when it exists
      (`todo/02` §C4)

## Out of scope

- `w_facet`, RRF constants, `deriveExtractedBoostEffects` semantics
- Pure-vector default path, image search, live search
- Parser / LLM changes; Suggest
