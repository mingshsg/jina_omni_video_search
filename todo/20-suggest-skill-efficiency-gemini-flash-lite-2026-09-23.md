# Suggest skill efficiency + Gemini Flash Lite — 2026-09-23

User ask: richer grounded title lookup + switch Suggest Agent Builder model
from default Sonnet 5 to Gemini 3.5 Flash Lite for speed.

## Done

- [x] Rewrite `grounded_title_lookup` skill (1 search + 1 read recipe;
      year/country/language/type/description/abstract/tags/actors;
      Wikidata allowlisted; file-level video_type wins over parent work)
- [x] Skill source of truth → `reference/agent-builder/skill-grounded_title_lookup.md`
      (loaded by `scripts/ensure-suggest-agent.ts`)
- [x] App schema + `applyAgentPayloadToLocal` accept richer fields
- [x] Allowlist adds `wikidata.org`
- [x] Flyout: country draft + apply when empty (never overwrite filled)
- [x] Suggest converse passes `connector_id` from
      `SUGGEST_AGENT_CONNECTOR_ID` (default
      `.google-gemini-3.5-flash-lite-chat_completion` →
      `google-gemini-3.5-flash-lite`)
- [x] Document in `.env.example`, `docs/agent-builder-jina-suggest.md`,
      `docs/api-contract.md`
- [x] Skill omit-nulls contract + hardened Agent Builder JSON parse
      (`stripNullKeys` / fence+balanced extract / coerce year+tags;
      live default + Flash Lite messages parse; unit tests)
- [x] 2026-09-23 follow-up: agent fields win over local Title clue; strip
      Title-clue prose when research ran; do not cache local/unavailable
      Suggest results; noisy title cleanup (`H Hur Jun MBC…` → `Hur Jun…`);
      skill requires full work-level drafts; pushed via
      `yarn tsx scripts/ensure-suggest-agent.ts`

## Operator follow-up

- [x] Run `yarn tsx scripts/ensure-suggest-agent.ts` to push the new skill
      body **and** agent instructions to Kibana (model is per-converse from
      app config — no agent-level model field)
- [ ] Re-smoke Tastefully Yours / multilingual titles; record latency vs prior
      39–43s Sonnet path
- [ ] Note: Elastic docs discourage mini models for Agent Builder tool use;
      Flash Lite is an explicit demo speed choice — watch tool-call quality
- [ ] Browser retest: Library → Edit metadata → Suggest on a Hur Jun /
      Heo Jun title; expect synopsis + KR/ko/`tv_episode` + cast candidates,
      not `Title clue:` at 35%
