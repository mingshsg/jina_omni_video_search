# Plan — Smart-parse chip state model ("Use as filter" visibility)

Status: proposed 2026-09-23. Scope: file-video search page only. Written
against the working tree on `live-video-search` as of this date; file:line
references are to that tree and will drift — re-verify before editing.

Parent plan: `plan/03-hybrid-metadata-search-plan.md` §C (Rule 1, boost
formula, `applied` / `rejected`), §UI item 3. Tracking: `todo/21-*`.

## Goal

Make the extracted-facet chips on the search page an honest, reversible view
of what the parser found and what the ranker did with it, so "Use as filter"
is available exactly when it can change the result, and a dismissed boost can
never silently follow the user into a different query.

## Current baseline (verified)

What already works in the working tree:

- Chips render from `meta.parse.extracted`, not `applied`
  (`app/page.tsx:447-534`), with a binary status `boosting | unused`.
- `promoteChip` / `dismissChip` re-run the search immediately with override
  facets / suppress lists (`app/page.tsx:536-582`).
- Parse details shows `extracted`, `applied`, `rejected`, `confidence`,
  `suppress_extracted` (`app/page.tsx:819-840`).
- Server: `boostsMinusHardFilters` (`lib/metadata/query-parse.ts:386-413`)
  drops a boost **field** whenever the same field is hand-filtered;
  `deriveExtractedBoostEffects` (`lib/es/hybrid-fusion.ts:96-165`) reports
  `no_effect` / `snapshot_unavailable` for facets matching no fusion
  candidate; the route overwrites `applied` from `boost_effects`
  (`app/api/search/route.ts:280-289`).
- `hybrid.suppress_extracted` is a list of **field names**, each ≤ 32 chars,
  max 20 (`app/api/search/route.ts:29-35`, applied at `:144-155`).

Defects that remain:

| # | Defect | Where | Consequence |
| --- | --- | --- | --- |
| D1 | `unused` conflates four different reasons | `page.tsx:486,497,508,530` | User cannot tell "not in candidate pool" (filter would help) from "hybrid off" or "snapshot failed" |
| D2 | `promoteChip` also pushes the field into `suppress_extracted` | `page.tsx:559-564` | Redundant with `boostsMinusHardFilters`; and when the user later clears the facet by hand, the boost never returns |
| D3 | Suppression is keyed by field and survives query changes | `page.tsx:154,573-582`; only cleared by `resetFilters` or turning Smart parse off | Dismissing `country=KR` on "Korean kissing" silently suppresses `JP` on "Japanese kissing" |
| D4 | Dismissed chips disappear with no restore | `page.tsx:479,490,501,513` (`continue`) | Only recovery is Reset filters, which also wipes hand facets |
| D5 | Chip derivation lives in `app/page.tsx` | `page.tsx:468-534` | Untestable — `vitest.config.ts` only collects `lib/**` and `worker/**` (AGENTS.md trap #6) |
| D6 | Server never says *why* a hand-filtered boost vanished | `route.ts:143` result is not reported | It is absent from both `applied` and `rejected`; client must infer |
| D7 | `QUERY_PARSER_FACET_MODE=filter` shows every chip as `unused` | `route.ts:211` sets `applied: {}` in filter mode | Eval mode looks broken |
| D8 | No request-sequence guard on auto re-search | `runSearch` has no seq/abort | Two quick chip clicks can land out of order |

`no_effect` deserves emphasis because it inverts the intuition: it means the
facet matched **zero fusion candidates**, not zero assets. A boost can only
re-order the pool; a hard filter re-enumerates the catalog (§D) and pulls the
matching assets in. So the `no_effect` chip is the one where "Use as filter"
is most useful, and today it is the least informative.

## Decisions

1. **Chips are derived from `extracted`; status is a closed enum.**

   | Status | Derivation (precedence top→bottom) | Actions |
   | --- | --- | --- |
   | `suppressed` | value in client suppress list | Restore |
   | `hard_filter` | same **field** is in hand-selected facets (mirrors `boostsMinusHardFilters`, field-level by design) | none — edit in Facets panel |
   | `filter_mode` | `meta.parse.facet_mode === 'filter'` | none; show "eval mode" note |
   | `hybrid_off` | `rejected` has `hybrid_text_required` for this value | Use as filter |
   | `snapshot_unavailable` | `rejected` reason `snapshot_unavailable` | Use as filter · Dismiss |
   | `no_effect` | `rejected` reason `no_effect` | **Use as filter** (primary) · Dismiss |
   | `boosting` | value present in `applied` | Use as filter · Dismiss |

   Values rejected by validation (`not in catalog`, `out of range`, `not in
   candidate set`) never reach `extracted` and therefore never become chips;
   they stay in Parse details only.

2. **Promote never writes suppress.** Hand filter ⇒ server drops the boost
   field. Clearing the facet by hand restores the boost automatically.

3. **Suppress is scoped to the submitted query and keyed by value.**
   Client key `field:value` (`year` for the year range). Cleared when the
   trimmed query submitted to `runSearch` differs from the previous
   submission. Server accepts both `field` (legacy) and `field:value`.

4. **Dismiss shrinks to an inline ×; dismissed chips collapse to one row**
   "Ignored N · Restore". Keeps Rule 1's "removable chip" and preserves the
   negative signal C4 needs, without competing visually with Use as filter.

5. **Auto re-search stays** for promote / dismiss / restore, guarded by a
   request sequence so a stale response cannot overwrite a newer one.

6. **Server additions are additive only.** `applied` / `rejected` keep their
   shape and meaning. New: `rejected[].reason = 'hard_filter'`;
   `suppress_extracted` items may be `field:value`, item length limit raised
   to 128. `boostsMinusHardFilters` stays field-level — a hand filter on a
   field makes any boost on that field moot, whatever the value.

7. **`hard_filter` chips are shown, not hidden**, so the user can see that
   the parser and the Facets panel agree. Optional if it crowds the row;
   the Facets accordion already shows a count.

## Non-goals

- No change to `w_facet`, RRF constants, `deriveExtractedBoostEffects`
  semantics, or `hybrid-fusion.test.ts` expectations.
- No change to the pure-vector default path, `/api/search/image`, or live
  search (invariant 1).
- No parser changes; no new LLM calls.
- No persistence of suppressions across page loads.

## Work breakdown — one concern per PR

### PR-A — fixes, no contract change

Files: `app/page.tsx`.

- Remove the suppress push from `promoteChip` (D2). Keep the re-search.
- Track `lastSubmittedQueryRef`; in `runSearch`, if `q !==` previous, use
  `[]` for `activeSuppress` and `setSuppressExtracted([])` (D3, reset part).
- Add `requestSeqRef`; ignore responses whose seq is not current (D8).
- `filtersDirty` (`page.tsx:595`) should count suppressions only if any
  remain after the reset rule.

Gate: `yarn build`; `yarn test` unchanged count; manual: promote → clear
facet in panel → chip returns to `boosting`/`no_effect`.

### PR-B — status model, testable derivation

Files: new `lib/metadata/parse-chips.ts` + `parse-chips.test.ts`;
`app/page.tsx`; `lib/i18n/ui.ts`.

- `deriveParseChips({ extracted, applied, rejected, facet_mode, filters,
  suppressed }) → ParseChip[]` with the enum above and `actions[]`. Pure,
  no React.
- `page.tsx` replaces the `useMemo` block with a call; renders by status
  (badge color, hint tooltip, primary vs secondary action, × for dismiss,
  collapsed "Ignored N · Restore" row).
- i18n keys per status for EN/ZH; retire `parseChipUnused`.
- Suppress key becomes `field:value` on the client (D3, key part) — still
  sent as legacy field names until PR-C lands, by mapping key→field at send
  time. This keeps PR-B deployable before PR-C.

Tests (in `lib/`): one case per status; precedence (suppressed beats
hard_filter beats no_effect); year range labelling; filter-mode all
`filter_mode`; validation-rejected values produce no chip.

Gate: `yarn test` (new cases counted), `yarn build`; manual matrix below.

### PR-C — additive contract

Files: `app/api/search/route.ts`; new helper in `lib/metadata/query-parse.ts`
(or sibling) + test; `docs/api-contract.md`; `chn.docs/`.

- Compute the diff between `parsed.extracted` and
  `boostsMinusHardFilters(...)`, push `{ field, value, reason: 'hard_filter' }`
  into `parseMeta.rejected` (D6). Put the diff in a pure helper with tests.
- `suppress_extracted` schema: `z.string().min(1).max(128)`; parse
  `field[:value]`; value-level suppression for `actor_ids` / `country` /
  `video_type`; `year` stays field-level.
- Client sends `field:value` keys directly once this lands.
- Docs: move the "Planned" block in `docs/api-contract.md` into the
  normative section.

Gate: `yarn test`, `yarn build`; regression: a request without
`suppress_extracted` and without hand filters produces byte-identical
`meta.parse.applied` / `rejected` (assert in the helper test with fixtures
from `hybrid-fusion.test.ts`).

### Manual verification matrix (run after PR-B, record in todo/21)

| Query | Setup | Expected chip |
| --- | --- | --- |
| `Korean kissing` | hybrid on, pool has KR | `KR · boosting` |
| `Korean kissing` | hybrid on, pool has no KR | `KR · no_effect`, Use as filter primary; clicking yields KR-only results |
| `Korean kissing` | Smart parse on, then hybrid switch forced off via API client | `KR · hybrid_off`, only Use as filter |
| `Korean kissing`, country=KR hand-selected | — | `KR · hard_filter`, no actions; `rejected` has `hard_filter` (after PR-C) |
| `Korean kissing` → × on KR → search `Japanese kissing` | — | `JP` chip present, not suppressed |
| `Korean kissing` → × → Restore | — | chip returns, search re-runs |
| any | `QUERY_PARSER_FACET_MODE=filter` | all chips `filter_mode`, eval note shown |

## Open items carried to todo/21

- Whether the `hard_filter` chip is worth the row space (Decision 7).
- Whether `embedTextQueryVector` should get a short-TTL cache like
  `lib/live/query-cache.ts` so chip clicks on the same query do not re-embed.
  Not required for correctness; measure before adding.
- Feed dismiss events into the C4 over-trigger set once that fixture exists.
