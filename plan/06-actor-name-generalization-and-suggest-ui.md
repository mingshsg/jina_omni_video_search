# Actor name generalization, agent tool efficiency, and Suggest UI detail

Status: implemented in this pass; see `todo/23-actor-name-and-suggest-ui-2026-09-23.md`
for the verification checklist and what remains unverified (live skill push,
browser QA).

## Goal

Three related improvements to the internet-grounded metadata Suggest feature
(`plan/04-internet-grounded-metadata-suggest.md`), requested directly by the
user rather than found by a review:

1. **Tool efficiency.** The agent's `grounded_title_lookup` skill previously
   read whole pages. `jina.read_url` supports a `question` parameter that
   returns only the passages answering it — cheaper and less untrusted page
   text in context. Use it everywhere, and spend the freed-up budget on a
   second, optional pass dedicated to actor names.
2. **Generalize actor names.** The old shape hardcoded `en/zh/ko/ja`. Actors
   are not only Korean or Japanese — any actor may need a native-script name.
   Replace with `en` (required) + `zh` (optional, always desired for
   Chinese-speaking searchers regardless of the actor's nationality) +
   `native` (optional, `{ lang, name }` in the actor's own script, verbatim,
   never reordered/reconstructed). Chinese and Korean names keep their
   natural family-name-first order in `en` too — never rewritten as
   "Given Family".
3. **Detailed Suggest UI.** The editor previously showed one crammed
   `helpText` string per field and no source link, and — the important bug —
   silently **discarded** any suggestion for a field that already had
   content. Every field now shows full evidence (value, confidence,
   evidence text, clickable source, retrieved-at) and, critically, a
   suggestion is shown as a card below the field with a "+" button even when
   the field already has a value, instead of vanishing.

## Decisions

- **No Wikidata requirement.** Free web search is fine as the discovery step;
  Wikipedia/Wikidata/IMDb/TMDB remain the trusted read domains for
  work-level facts.
- **Tool budget may grow, but stays bounded.** Two phases, each 1 search + 1
  read: Phase 1 (always) identifies the work; Phase 2 (optional) is spent
  only when the work is already unique and an actor still lacks `zh`/
  `native`. Worst case 2 searches + 2 reads total — unchanged from before,
  but now `question`-scoped so it's cheaper per call than before.
- **`names` schema** (agent payload → normalized candidate → saved actor,
  all three layers use the same shape):
  ```ts
  names: {
    en: string;                                 // required
    zh?: string | null;                         // optional, wanted for ANY actor
    native?: { lang: string; name: string } | null; // optional, actor's own script
  }
  ```
  `native` is omitted by the skill (and defensively dropped by the sanitizer)
  when it would duplicate `zh` or match `en` verbatim — it should only
  appear when it adds real information. The native-script string is never
  reordered or reconstructed; it is copied exactly as the source shows it.
- **Name-only domain allowlist.** Work-level facts stay on the strict
  Wikipedia/Wikidata/IMDb/TMDB allowlist. Actor name completion (Phase 2
  only) additionally allows Baidu Baike, Douban, MyDramaList, HanCinema,
  AsianWiki — lower-trust sources are acceptable here because actor
  candidates are already gated behind exact-alias resolution against
  `config/people.json` before they become save-able.
- **"+" apply semantics per field type**, used when a pending (non-empty-field)
  suggestion is applied:
  - Single-value fields (year / country / primary_language / video_type /
    description / abstract): replaces the current value.
  - `tags`: merges and de-dupes (case-insensitive) with existing tags.
  - Actors: unchanged — the candidate card's "add" button behavior didn't
    change, only its detail level.
- **Invariant preserved.** A field's saved value is never auto-overwritten by
  a background suggestion; only an explicit click (now via "+" even for
  filled fields) changes it.

## What changed, by file

- `lib/metadata/people.ts` — `PersonLocale` narrowed to `'en' | 'zh'`;
  `PersonEntry` gets an optional top-level `native: { lang, name }` beside
  `display`; `displayNameForPerson` simplified (ko/ja branches were dead code
  — the app's UI locale is only ever `en`/`zh`).
- `config/people.json` — the 3 actually-Korean people (Lee Jung-jae, Song
  Kang-ho, Gong Yoo) keep their Hangul name, now under `native`. Audrey
  Hepburn and Zhang Ziyi's decorative `ko` display key (a phonetic
  transliteration, not their identity) is dropped — the same string still
  lives in `aliases`, so search is unaffected.
- `lib/metadata/agent-builder-suggest.ts` — zod schema and
  `sanitizeAgentSuggestRaw` updated for the new `names` shape; sanitizer
  canonicalizes `native.lang` against the `PRIMARY_LANGUAGES` catalog and
  drops `native` when it duplicates `en`/`zh`.
- `lib/metadata/suggest-web.ts` — `SuggestWebActorCandidate.names` updated;
  `normalizeAgentActorCandidates` resolves catalog matches against
  `en`/`zh`/`native.name`; new `SUGGEST_WEB_NAME_ALLOWLIST` (superset of the
  work-facts allowlist) and `isNameAllowlistedUrl` used only for actor URLs.
- `components/EditMetadataFlyout.tsx` — `PendingSuggestions` state holds any
  suggestion that wasn't auto-applied because the field already had content;
  `onSuggest`'s merge logic stashes into it instead of discarding; a new
  `renderPendingSuggestion(key)` card (value, confidence, evidence, source
  link, retrieved-at, "+" button) renders below every scalar field;
  `evidenceHelp` now also renders a clickable source link for
  already-applied suggestions; the `country` field gained the same
  evidence/pending treatment the other fields already had (it had none
  before); the actor-candidate list was redesigned into structured
  per-candidate blocks (English name + character, `中文名` line, native-name
  line, source link + retrieved-at, add button) instead of a joined string.
- `lib/i18n/ui.ts` — new EN/ZH keys: `metaSuggestReviewBelow`,
  `metaSuggestPendingApply`, `metaSuggestPendingValue`,
  `metaActorCandidateZh`, `metaActorCandidateNative`.
- `reference/agent-builder/skill-grounded_title_lookup.md` — rewritten:
  two-phase budget, mandatory `question` on every `read_url` call, expanded
  name-only allowlist, new actor `names` output contract, CJK family-name-
  first rule for `names.en`.
- `scripts/ensure-suggest-agent.ts` — `AGENT_INSTRUCTIONS` updated to mention
  the two-phase budget, mandatory `question` argument, and the new names
  schema.
- `docs/agent-builder-jina-suggest.md` — skill contract example and prose
  updated to match.

## Verification run in this pass

- `yarn test` — 398/398 passed (62 files), both after PR-D (schema/catalog)
  and again after PR-F (UI) changes.
- `yarn build` — passed, twice (same checkpoints).
- `diagnostics` on `components/EditMetadataFlyout.tsx` — no new warnings
  (only the pre-existing "Props must be serializable" warnings for
  `onClose`/`onSaved`, unrelated to this change).

## Live verification (follow-up session, 2026-09-23)

- The `.env` in this repo already held working Elastic Cloud credentials
  (`ELASTICSEARCH_URL` + `ELASTICSEARCH_API_KEY`; Kibana host derived from the
  ES URL). `yarn tsx scripts/ensure-suggest-agent.ts` was run and PUT-updated
  both the `grounded_title_lookup` skill and the `video_metadata_research`
  agent (HTTP 200, `ok: true`).
- `yarn tsx scripts/smoke-suggest-agent.ts` was then run against two titles:
  `더 글로리` (PASS, 23.03s, actors in `{ en, native: { lang: "ko", name } }`
  shape) and `琅琊榜` (PASS, 29.74s, no timeout retry, actors in `{ en, zh }`
  shape). Both confirm the new `en`/`zh`/`native` schema is live end-to-end,
  and both were faster than the historical pre-change baseline (38.9s /
  43.1s), which is consistent with — but not rigorous proof of — the
  two-phase `question`-scoped read budget doing less work.
- Full details: `todo/23-actor-name-and-suggest-ui-2026-09-23.md` §"Live
  verification".

## Explicitly NOT verified in this pass

- Whether `read_url` calls actually carried a `question` argument.
  `smoke-suggest-agent.ts` only returns the final converse response, not the
  agent's intermediate tool-call trace, so this was **not** directly
  observed — only inferred from the faster, correct outcomes above.
  Confirming it directly would need Kibana's Agent Builder conversation
  trace/transcript UI, which this pass did not use.
- No browser/manual QA of the new "+" buttons or the redesigned actor cards.
- No rigorous measurement of whether the `question` parameter reduces token
  cost or latency in production — the timings above are informal,
  single-sample observations, not a measured gate.
- No re-litigation of the unrelated hybrid-search P1 findings from
  `todo/22-hybrid-independent-code-review-2026-09-23.md` — out of scope for
  this pass, flagged separately.
