Plan: [`plan/09-suggest-description-depth.md`](../plan/09-suggest-description-depth.md).
Requested directly by the user (not a review finding).

## Changes

- [x] `reference/agent-builder/skill-grounded_title_lookup.md` — `description`
      field rule rewritten to 4-7 sentences / ≤1600 chars, real plot synopsis,
      anti-padding instruction kept.
- [x] `lib/metadata/agent-builder-suggest.ts` — new
      `agentDescriptionFieldSchema` (string-only, max 1600) used only for
      `fields.description`; every other field keeps the 480-char
      `agentFieldSchema` bound. This was a **second, independent cap** found
      while investigating — would have silently broken the feature the
      moment the skill change worked, since the zod schema is `.strict()`.
- [x] `scripts/ensure-suggest-agent.ts` — `AGENT_INSTRUCTIONS` got one line
      reinforcing the new depth expectation.
- [x] Checked `META_BOUNDS.descriptionMax` (4000) / `abstractMax` (500) in
      `lib/metadata/catalogs.ts` — already above 1600, no change needed.
- [x] Checked `docs/agent-builder-jina-suggest.md` for a stale worked
      example — none found quoting the old short description.

## Verification

- [x] `yarn vitest run lib/metadata/agent-builder-suggest.test.ts` — 17/17
      passed (schema split didn't break existing fixtures).
- [x] `yarn tsx scripts/ensure-suggest-agent.ts` — pushed live,
      `{"ok": true, "status": 200, "agent_id": "video_metadata_research",
      "skill_id": "grounded_title_lookup"}`.
- [x] `yarn tsx scripts/smoke-suggest-agent.ts "琅琊榜"` (Nirvana in Fire) —
      live run against the pushed skill. Result, honestly reported:
      **3 sentences, ~450 characters** of real plot content (character name,
      alias, the conspiracy, the political maneuvering with Prince Jing) —
      a genuine improvement over the old 1-2 sentence logline, and it made
      the effort (5 tool calls: 2 searches + 3 reads, one explicitly
      re-querying for "plot cast") — but **short of the requested 4-7
      sentences**. Most likely cause: the Wikipedia page's directly
      extractable Plot content for this title didn't yield more distinct
      grounded beats within the tool budget, and the skill's own
      anti-padding instruction ("never invent content to reach the sentence
      count") correctly stopped it short rather than padding. This is a
      single-title sample, not a statistically meaningful eval.
- **NOT RUN**: no second/third title tried to see if 4-7 sentences is
  reliably reached on richer pages. No before/after side-by-side eval across
  a title set — this was a single smoke check, not a quality gate.
- **NOT RUN** in isolation: full `yarn build` / `yarn test` for just this
  change — bundled with the item 3/4 work in the same working tree; see that
  commit's full-suite result.

## Open question for the user

The live result landed at 3 sentences, not 4-7. Options if you want it
pushed further: (a) accept this as sufficient (real plot content beats a
logline, even short of the target count), (b) explicitly instruct the skill
to keep reading additional sections when the first pass comes back under 4
sentences, accepting the extra tool-call cost, or (c) try a richer-Wikipedia
title to see if this was page-specific before changing anything further.
