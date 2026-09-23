# Actor name generalization + Suggest UI detail — implementation checklist

Plan: [`plan/06-actor-name-generalization-and-suggest-ui.md`](../plan/06-actor-name-generalization-and-suggest-ui.md).
Requested directly by the user (not a review finding). Scope: PR-D
(schema/catalog), PR-E (skill/tool instructions), PR-F (UI).

## PR-D — schema/catalog generalization

- [x] `lib/metadata/people.ts`: `PersonLocale` narrowed to `'en' | 'zh'`;
      `PersonEntry.native?: { lang, name }` added; `displayNameForPerson`
      simplified (ko/ja branches removed — dead code, app locale is only
      en/zh).
- [x] `config/people.json`: 3 Korean people (`lee-jung-jae`, `song-kang-ho`,
      `gong-yoo`) migrated `ko` → top-level `native`. `audrey-hepburn` and
      `zhang-ziyi` had their decorative `ko` display key dropped (string
      still present in `aliases`, unaffected for search).
- [x] `lib/metadata/agent-builder-suggest.ts`: zod schema + `AgentBuilder*`
      types use `names: { en, zh?, native?: { lang, name } }`;
      `sanitizeAgentSuggestRaw` canonicalizes `native.lang` via
      `canonicalizePrimaryLanguage` and drops `native` when it duplicates
      `en`/`zh`.
- [x] `lib/metadata/suggest-web.ts`: `SuggestWebActorCandidate.names` updated;
      `normalizeAgentActorCandidates` resolves alias matches against
      `en`/`zh`/`native.name`; added `SUGGEST_WEB_NAME_ALLOWLIST` (base +
      baike.baidu.com/movie.douban.com/mydramalist.com/hancinema.net/
      asianwiki.com) and `isNameAllowlistedUrl`, used only for actor URLs
      (work-fact reads still gated by the original `isAllowlistedUrl`).
- [x] `components/EditMetadataFlyout.tsx`: `SuggestActorCandidate.names` type
      updated to match (rendering redesign is PR-F, tracked separately below).
- [x] Test fixtures updated: `lib/metadata/agent-builder-suggest.test.ts`
      (2 tests: null-language-keys test, Hur-Jun-style payload test) and
      `lib/metadata/suggest-web.test.ts` (`normalizeAgentActorCandidates`,
      2 tests) now use `native: { lang, name }` instead of `ko`/`ja`.
      `lib/metadata/people.test.ts` needed no change (didn't touch ko/ja).
- [x] `yarn test` — 398/398 passed (62 files) after this step.
- [x] `yarn build` — passed after this step.

## PR-E — skill / tool instructions

- [x] `reference/agent-builder/skill-grounded_title_lookup.md` rewritten:
      two-phase budget (Phase 1 = 1 search + 1 read for work ID, always;
      Phase 2 = optional +1 search/+1 read for actor name completion, only
      after the work is unique and a name is still missing), mandatory
      `question` argument on every `read_url` call with phase-specific
      example questions, split readable-domains section (work-facts vs.
      name-only), new `names` output contract (`en` required,
      family-name-first for Chinese/Korean; `zh` optional; `native`
      `{lang,name}` optional, omitted when redundant with zh/en), updated
      JSON example and allowed-keys list.
- [x] `scripts/ensure-suggest-agent.ts`: `AGENT_INSTRUCTIONS` updated to
      describe the two-phase budget, the mandatory `question` argument, and
      the new names schema (en family-first, zh optional-but-wanted, native
      verbatim-and-optional).
- [x] `docs/agent-builder-jina-suggest.md`: skill-contract JSON example and
      surrounding prose updated to the new names shape and two-phase budget;
      allowlist section split into work-facts vs. name-only domains.

### Live verification (2026-09-23, follow-up session — credentials were in `.env` all along)

- [x] **RUN** — pushed the updated skill/agent to the live Kibana Agent
      Builder via `yarn tsx scripts/ensure-suggest-agent.ts`. Result:
      `{ "ok": true, "status": 200, "method": "PUT", "agent_id":
      "video_metadata_research", "skill_id": "grounded_title_lookup",
      "tools": [{ "tool_ids": ["jina.search_web", "jina.read_url"] }] }`.
      Both the skill body (two-phase budget, mandatory `question` param,
      `en`/`zh`/`native` schema) and the agent instructions were PUT-updated
      in one pass.
- [x] **RUN** — `yarn tsx scripts/smoke-suggest-agent.ts` against the live
      agent, two titles:
      - `더 글로리` (Korean, 6 actors) — PASS in 23.03s. Actor names came
        back as `{ en, native: { lang: "ko", name } }`, e.g.
        `{ en: "Song Hye-kyo", native: { lang: "ko", name: "송혜교" } }` —
        confirms the new schema shape end-to-end, not just `ko`/`ja` keys.
      - `琅琊榜` (Chinese, 3 actors) — PASS in 29.74s, no timeout retry
        needed this time. Actor names came back as `{ en, zh }` directly,
        e.g. `{ en: "Hu Ge", zh: "胡歌" }`.
      - Both runs were faster than the historical pre-change baseline in
        `docs/agent-builder-jina-suggest.md` (38.9s / 43.1s-with-retry), which
        is *consistent with* the two-phase, `question`-scoped read budget
        doing less work per call, but this is anecdotal (n=1 per title, no
        controlled A/B) — **not** a measured before/after gate.
- [ ] **STILL NOT VERIFIABLE from this script** — whether `read_url` calls
      actually carried a `question` argument. `smoke-suggest-agent.ts` only
      prints the final converse response (candidates/fields/actors), not the
      agent's intermediate tool-call trace, so no automated evidence either
      way was captured here. The two fast, correct, single-candidate PASSes
      above are consistent with the agent following the new two-phase/
      `question`-scoped instructions, but that is inference from outcome and
      timing, not direct observation of the tool call arguments. Confirming
      this directly would need Kibana's Agent Builder conversation trace/
      transcript UI (not exercised by this script).
- [ ] **NOT RUN** — no rigorous before/after token-cost or latency
      measurement for the `question`-scoped reads; the timings above are
      informal, single-sample observations, not a measured gate.

## PR-F — Suggest UI detail

- [x] New `PendingSuggestions` state
      (`Partial<Record<ScalarSuggestKey, SuggestField>>`) holds any
      suggestion that was NOT auto-applied because its field already had
      content — replacing the old behavior of silently discarding it.
- [x] `onSuggest`'s merge logic rewritten: for each of
      year/video_type/primary_language/country/description/abstract/tags,
      auto-apply only when the field was empty both at click-time and at
      response-time (unchanged rule for auto-apply); otherwise stash the
      draft into `pendingSuggestions` (new).
- [x] New `applyPendingSuggestion(key)` callback: single-value fields
      replace; `tags` merges/dedupes case-insensitively with existing tags;
      writes `fieldSources`/`fieldProvenance` and clears the pending entry,
      same as the existing auto-apply path.
- [x] New `renderPendingSuggestion(key)` renders a compact card (value,
      confidence %, evidence text, clickable source link, retrieved-at,
      "+" apply button) below every scalar `EuiFormRow` — description,
      abstract, year, video_type, primary_language, country, tags.
- [x] `evidenceHelp` (for already-applied suggestions) now also renders a
      clickable source link, not just a crammed text string.
- [x] `country` field gained the same evidence/pending treatment the other
      six fields already had — it had neither before this change (pre-
      existing gap, not previously flagged).
- [x] Actor-candidate list redesigned from one joined-string bullet into a
      structured per-candidate block: bold English name + character, a
      separate `中文名` line (only if present), a separate native-name line
      labeled with its language code (only if present), then source link +
      retrieved-at, then the add/added/unresolved control — same as before,
      just clearer.
- [x] New i18n keys added to `lib/i18n/ui.ts` (EN + ZH):
      `metaSuggestReviewBelow`, `metaSuggestPendingApply`,
      `metaSuggestPendingValue`, `metaActorCandidateZh`,
      `metaActorCandidateNative`.
- [x] `diagnostics` on `EditMetadataFlyout.tsx` — no new warnings (only the
      pre-existing unrelated "Props must be serializable" ones).
- [x] `yarn test` — 398/398 passed (62 files) after this step.
- [x] `yarn build` — passed after this step.

### Explicitly not done

- [ ] **NOT RUN** — no browser/manual QA of the new "+" buttons, the merged-
      tags behavior, or the redesigned actor cards. Everything above is
      verified only by compilation + the existing (unchanged-behavior)
      automated test suite; none of the new UI paths have dedicated tests
      because `vitest.config.ts` only includes `lib/**` and `worker/**` —
      component-level behavior here is compile-time-checked only.
- [ ] **NOT RUN** — no relevance/accuracy measurement of whether actual
      Wikipedia/Baidu Baike/etc. pages yield the expected `native`/`zh`
      fields in practice; that depends on the live skill push above.

## Out of scope, flagged not fixed

- `todo/22-hybrid-independent-code-review-2026-09-23.md`'s three P1 items
  (unrelated hybrid-search `msearch`/`retriever` typing issue, BM25
  free-text truncation, silent-catch logging) are **not** addressed here —
  different code path, different task, tracked separately.
