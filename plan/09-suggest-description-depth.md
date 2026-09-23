# Suggest description depth: logline → real plot synopsis

Status: implemented and pushed live in this pass. See
`todo/26-suggest-description-depth-2026-09-23.md` for the live verification
run and its honest result (improved, but short of the requested sentence
count on the one title tried).

## Goal

The user found the agent-generated `description` "too rough" — one or two
sentences, capped at 480 characters — and asked for 4-7 sentences of real
plot/storyline instead of a logline.

## Root cause (confirmed, not guessed)

Two independent places capped this, both fixed:

1. `reference/agent-builder/skill-grounded_title_lookup.md` §"Field rules"
   told the agent: *"one or two short sentences, ≤480 characters ... Do not
   paste a long plot dump."* This is the skill markdown the live Kibana
   Agent Builder skill's `content` is loaded from verbatim
   (`scripts/ensure-suggest-agent.ts`'s `SKILL_CONTENT = readFileSync(...)`),
   so editing the file and re-running the push script is sufficient — no
   separate copy to keep in sync.
2. `lib/metadata/agent-builder-suggest.ts`'s zod validation had a **second,
   independent cap**: every field sharing `agentFieldSchema` (year, country,
   primary_language, video_type, description, abstract) had
   `value: z.union([z.number().int(), z.string().trim().max(480)])`. Even if
   the agent had ignored the skill instructions and returned a longer
   description, this would have silently rejected the whole payload (`.strict()`
   zod parse failure) once it exceeded 480 characters. This would have been a
   real, live-breaking bug the moment the skill change worked.

## Fix

- Skill markdown: `description` field rule rewritten to **4-7 sentences,
  ≤1600 characters**, a real plot synopsis, grounded in the read page —
  preferring Wikipedia's lead + any dedicated Plot/Synopsis section over the
  lead alone (the lead alone is usually too short to reach 4-7 sentences of
  real content). Explicit anti-padding instruction: shorter is fine if the
  source itself is short; never invent detail to hit the sentence count.
  `abstract` is unchanged (still one short sentence, ≤240 chars) — this was
  never the complaint and stays a logline by design (it's the short label,
  `description` is the synopsis).
- `lib/metadata/agent-builder-suggest.ts`: split a dedicated
  `agentDescriptionFieldSchema` (`value: z.string().trim().max(1600)`,
  string-only since description is never a number) off the shared
  `agentFieldSchema`, used only for the `fields.description` key. Every
  other field keeps the original 480-char bound — this was a targeted fix,
  not a blanket loosening.
- `scripts/ensure-suggest-agent.ts`'s `AGENT_INSTRUCTIONS` (the agent's own
  top-level prompt, separate from the skill content) got one added line
  reinforcing the new length/depth expectation, since it's the first thing
  the agent sees before it even loads the skill.
- Checked `lib/metadata/catalogs.ts`'s `META_BOUNDS.descriptionMax` (4000)
  and `abstractMax` (500) — both already comfortably above the new 1600
  bound; no change needed there, this was never the actual ceiling.
- Checked `docs/agent-builder-jina-suggest.md` for a worked example quoting
  the old short description — none found; no doc edit needed.

## Explicitly not changed

- `abstract`'s length/behavior — not the complaint, stays a one-line label.
- The 4000-char `descriptionMax` ceiling used by the *editor's* manual PATCH
  path (`lib/metadata/validate.ts`) — untouched; a human editing the field by
  hand can still paste up to 4000 characters, unrelated to what the agent
  is instructed to draft.
