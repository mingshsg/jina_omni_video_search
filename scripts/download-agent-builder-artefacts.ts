/**
 * Validate live Agent Builder Suggest agent/skill/tools and download artefacts
 * into reference/agent-builder/.
 *
 * Usage: yarn tsx scripts/download-agent-builder-artefacts.ts
 */
import { createHash } from 'crypto';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { loadDotenv } from './load-dotenv';

const AGENT_ID = 'video_metadata_research';
const SKILL_ID = 'grounded_title_lookup';
const EXPECTED_TOOLS = ['jina.search_web', 'jina.read_url'] as const;

const OUT_DIR = join(process.cwd(), 'reference', 'agent-builder');

async function getJson(
  kb: string,
  key: string,
  path: string,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${kb}${path}`, {
    headers: {
      Authorization: `ApiKey ${key}`,
      'kbn-xsrf': 'true',
    },
  });
  const text = await res.text();
  try {
    return { status: res.status, body: JSON.parse(text) };
  } catch {
    return { status: res.status, body: { raw: text.slice(0, 2000) } };
  }
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function flatToolIds(agent: Record<string, unknown>): string[] {
  const cfg = agent.configuration as
    | { tools?: Array<{ tool_ids?: string[] }> }
    | undefined;
  return (cfg?.tools ?? []).flatMap((g) => g.tool_ids ?? []);
}

async function main() {
  loadDotenv();
  const es = (process.env.ELASTICSEARCH_URL || '').replace(/\/$/, '');
  const key = process.env.ELASTICSEARCH_API_KEY || '';
  const kb =
    (process.env.KIBANA_URL || '').replace(/\/$/, '') ||
    (es.includes('.es.') ? es.replace('.es.', '.kb.') : '');
  if (!kb || !key) {
    console.error('Need ELASTICSEARCH_URL/API_KEY (Cloud .es.→.kb.) or KIBANA_URL');
    process.exit(1);
  }

  const [agentRes, skillRes, toolsRes, skillsRes] = await Promise.all([
    getJson(kb, key, `/api/agent_builder/agents/${AGENT_ID}`),
    getJson(kb, key, `/api/agent_builder/skills/${SKILL_ID}`),
    getJson(kb, key, '/api/agent_builder/tools'),
    getJson(kb, key, '/api/agent_builder/skills'),
  ]);

  const agent = agentRes.body as Record<string, unknown>;
  const skill = skillRes.body as Record<string, unknown>;
  const allTools = Array.isArray((toolsRes.body as { results?: unknown })?.results)
    ? ((toolsRes.body as { results: Record<string, unknown>[] }).results)
    : [];
  const jinaCatalog = allTools.filter((t) =>
    String(t.id ?? '').startsWith('jina.'),
  );
  const assignedTools = jinaCatalog.filter((t) =>
    (EXPECTED_TOOLS as readonly string[]).includes(String(t.id)),
  );

  const agentToolIds = flatToolIds(agent);
  const skillToolIds = Array.isArray(skill.tool_ids)
    ? (skill.tool_ids as string[])
    : [];
  const skillIds =
    (agent.configuration as { skill_ids?: string[] } | undefined)?.skill_ids ??
    [];
  const skillContent = String(skill.content ?? '');
  const agentInstructions = String(
    (agent.configuration as { instructions?: string } | undefined)
      ?.instructions ?? '',
  );

  const checks = {
    agent_exists: agentRes.status === 200 && agent.id === AGENT_ID,
    skill_exists: skillRes.status === 200 && skill.id === SKILL_ID,
    agent_has_skill: skillIds.includes(SKILL_ID),
    agent_tools_exact:
      JSON.stringify([...agentToolIds].sort()) ===
      JSON.stringify([...EXPECTED_TOOLS].sort()),
    skill_tools_exact:
      JSON.stringify([...skillToolIds].sort()) ===
      JSON.stringify([...EXPECTED_TOOLS].sort()),
    elastic_capabilities_off:
      (agent.configuration as { enable_elastic_capabilities?: boolean })
        ?.enable_elastic_capabilities === false,
    assigned_tools_present: EXPECTED_TOOLS.every((id) =>
      assignedTools.some((t) => t.id === id),
    ),
  };
  const ok = Object.values(checks).every(Boolean);

  mkdirSync(OUT_DIR, { recursive: true });

  // Strip volatile / non-portable fields from agent export where present.
  const agentArtefact = {
    id: agent.id,
    name: agent.name,
    description: agent.description,
    labels: agent.labels,
    avatar_color: agent.avatar_color,
    avatar_symbol: agent.avatar_symbol,
    access_control: agent.access_control,
    configuration: agent.configuration,
  };
  const skillArtefact = {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    tool_ids: skill.tool_ids,
    content: skill.content,
  };

  writeFileSync(
    join(OUT_DIR, 'agent-video_metadata_research.json'),
    `${JSON.stringify(agentArtefact, null, 2)}\n`,
  );
  writeFileSync(
    join(OUT_DIR, 'skill-grounded_title_lookup.json'),
    `${JSON.stringify(skillArtefact, null, 2)}\n`,
  );
  writeFileSync(join(OUT_DIR, 'skill-grounded_title_lookup.md'), `${skillContent}\n`);
  writeFileSync(join(OUT_DIR, 'agent-instructions.md'), `${agentInstructions}\n`);
  writeFileSync(
    join(OUT_DIR, 'tools-assigned-jina.json'),
    `${JSON.stringify(assignedTools, null, 2)}\n`,
  );
  writeFileSync(
    join(OUT_DIR, 'tools-jina-catalog.json'),
    `${JSON.stringify(jinaCatalog, null, 2)}\n`,
  );

  const summary = {
    fetched_at: new Date().toISOString(),
    kibana_host: kb.replace(/^https:\/\/[^.]+/, 'https://***'),
    ok,
    checks,
    hashes: {
      skill_content_sha256: sha256(skillContent),
      agent_instructions_sha256: sha256(agentInstructions),
    },
    agent: {
      id: agent.id,
      skill_ids: skillIds,
      tool_ids: agentToolIds,
      enable_elastic_capabilities: (
        agent.configuration as { enable_elastic_capabilities?: boolean }
      )?.enable_elastic_capabilities,
    },
    skill: {
      id: skill.id,
      tool_ids: skillToolIds,
      content_len: skillContent.length,
    },
    tools: {
      assigned: EXPECTED_TOOLS,
      jina_catalog_count: jinaCatalog.length,
    },
    skills_list: Array.isArray(
      (skillsRes.body as { results?: unknown })?.results,
    )
      ? (
          skillsRes.body as {
            results: Array<{ id?: string; name?: string }>;
          }
        ).results
          .filter((s) =>
            /grounded|video_metadata|suggest/i.test(
              `${s.id ?? ''} ${s.name ?? ''}`,
            ),
          )
          .map((s) => ({ id: s.id, name: s.name }))
      : [],
  };

  writeFileSync(
    join(OUT_DIR, 'validation-summary.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
  );

  writeFileSync(
    join(OUT_DIR, 'README.md'),
    `# Agent Builder artefacts (Suggest)

Downloaded from the live Kibana Agent Builder instance used by this project.

**Product path:** Library web Suggest → Next.js API → agent \`${AGENT_ID}\` →
skill \`${SKILL_ID}\` → tools \`${EXPECTED_TOOLS.join('` / `')}\`.

## Files

| File | Contents |
| --- | --- |
| \`agent-video_metadata_research.json\` | Agent config export (no secrets) |
| \`agent-instructions.md\` | Agent system instructions |
| \`skill-grounded_title_lookup.json\` | Skill metadata + content |
| \`skill-grounded_title_lookup.md\` | Skill markdown body (source of truth for policy) |
| \`tools-assigned-jina.json\` | Only the two tools attached to agent/skill |
| \`tools-jina-catalog.json\` | Full \`jina.*\` tool catalog on the connector (reference; agent must not use extras) |
| \`tools-jina.json\` | Earlier full-catalog snapshot; prefer \`tools-jina-catalog.json\` |
| \`validation-summary.json\` | Last fetch time, checks, content hashes |

## Re-download / re-validate

\`\`\`bash
yarn download-agent-builder-artefacts
\`\`\`

Provision / sync live resources from repo definitions:

\`\`\`bash
yarn ensure-suggest-agent
\`\`\`

The ensure script embeds the same skill and instructions; after changing either,
run ensure then download so artefacts match production.

## Validation rules

- Agent id = \`${AGENT_ID}\`
- Skill id = \`${SKILL_ID}\` attached
- \`enable_elastic_capabilities\` = false
- Agent and skill tool lists exactly = ${JSON.stringify(EXPECTED_TOOLS)}
- No Elasticsearch write tools

Last validation: see \`validation-summary.json\` (\`ok\` must be true).
`,
  );

  console.log(
    JSON.stringify(
      {
        ok,
        out_dir: OUT_DIR,
        checks,
        hashes: summary.hashes,
      },
      null,
      2,
    ),
  );
  if (!ok) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
