# Agent Builder artefacts (Suggest)

Downloaded from the live Kibana Agent Builder instance used by this project.

**Product path:** Library web Suggest → Next.js API → agent `video_metadata_research` →
skill `grounded_title_lookup` → tools `jina.search_web` / `jina.read_url`.

## Files

| File | Contents |
| --- | --- |
| `agent-video_metadata_research.json` | Agent config export (no secrets) |
| `agent-instructions.md` | Agent system instructions |
| `skill-grounded_title_lookup.json` | Skill metadata + content |
| `skill-grounded_title_lookup.md` | Skill markdown body (source of truth for policy) |
| `tools-assigned-jina.json` | Only the two tools attached to agent/skill |
| `tools-jina-catalog.json` | Full `jina.*` tool catalog on the connector (reference; agent must not use extras) |
| `tools-jina.json` | Earlier full-catalog snapshot; prefer `tools-jina-catalog.json` |
| `validation-summary.json` | Last fetch time, checks, content hashes |

## Re-download / re-validate

```bash
yarn download-agent-builder-artefacts
# or: yarn tsx scripts/download-agent-builder-artefacts.ts
```

Provision / sync live resources from repo definitions:

```bash
yarn tsx scripts/ensure-suggest-agent.ts
```

The ensure script embeds the same skill and instructions; after changing either,
run ensure then download so artefacts match production.

## Validation rules

- Agent id = `video_metadata_research`
- Skill id = `grounded_title_lookup` attached
- `enable_elastic_capabilities` = false
- Agent and skill tool lists exactly = ["jina.search_web","jina.read_url"]
- No Elasticsearch write tools

Last validation: see `validation-summary.json` (`ok` must be true).
