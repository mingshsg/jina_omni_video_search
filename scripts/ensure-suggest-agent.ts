/**
 * Idempotent: create/update the Suggest Agent Builder agent that uses Jina MCP tools.
 * Product path: Library web Suggest → app API → this agent → jina.search_web/read_url.
 * Usage: yarn tsx scripts/ensure-suggest-agent.ts
 *
 * Skill body source of truth:
 *   reference/agent-builder/skill-grounded_title_lookup.md
 *
 * Model is NOT set on the agent document. The app passes
 * SUGGEST_AGENT_CONNECTOR_ID as converse `connector_id` (default
 * .google-gemini-3.5-flash-lite-chat_completion).
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { loadDotenv } from './load-dotenv';

const AGENT_ID = 'video_metadata_research';
const SKILL_ID = 'grounded_title_lookup';
const TOOL_IDS = ['jina.search_web', 'jina.read_url'] as const;

const AGENT_INSTRUCTIONS = `You are the dedicated video metadata research agent.
For every request, use the grounded_title_lookup skill and follow its output contract.
Prefer the skill's two-phase budget: Phase 1 is one targeted Wikipedia/Wikidata search plus one page read to verify the work; Phase 2 (one more search + one more read) is optional and only for completing an actor's zh/native name after the work is already verified. Always pass a question argument to read_url so it returns only the relevant passages, never the whole page.
Early abstention on ambiguity; no duplicate fetches.
When a unique work is verified, return sourced drafts for description, abstract, year, country, primary_language, video_type, tags, and actors — not year alone.
Clean noisy filenames (letter prefixes, MBC/KBS/Netflix tokens, romanization aliases such as Hur Jun / Heo Jun) before searching.
For actor names: names.en is required (keep Chinese/Korean names family-name-first, no comma); names.zh is optional but worth finding for any actor; names.native ({lang, name}) is optional and only for the actor's own script, copied verbatim, and omitted when it would duplicate zh or en.
Omit every unknown field entirely — never emit null, empty placeholders, or "field": null.
You have no general Elastic capabilities and must use only the tools attached to that skill.
Never write to Elasticsearch or modify the video asset.
Return only the compact JSON object required by the skill, with no prose or markdown fences.`;

const SKILL_CONTENT = readFileSync(
  join(__dirname, '../reference/agent-builder/skill-grounded_title_lookup.md'),
  'utf8',
);

async function main() {
  loadDotenv();
  const es = (process.env.ELASTICSEARCH_URL || '').replace(/\/$/, '');
  const key =
    process.env.KIBANA_API_KEY || process.env.ELASTICSEARCH_API_KEY || '';
  const kb =
    (process.env.KIBANA_URL || '').replace(/\/$/, '') ||
    (es.includes('.es.') ? es.replace('.es.', '.kb.') : '');
  if (!kb || !key) {
    console.error(
      'Need KIBANA_URL (or Cloud ELASTICSEARCH_URL) and KIBANA_API_KEY/ELASTICSEARCH_API_KEY',
    );
    process.exit(1);
  }

  const headers = {
    Authorization: `ApiKey ${key}`,
    'kbn-xsrf': 'true',
    'Content-Type': 'application/json',
  };

  const skillCreateBody = {
    id: SKILL_ID,
    name: 'Grounded title lookup',
    description:
      'Use for edit-time video metadata research from a saved title. Efficient Wikipedia/Wikidata lookup returns cited year, country, language, type, tags, synopsis, and cast drafts; abstains on ambiguity.',
    content: SKILL_CONTENT,
    tool_ids: [...TOOL_IDS],
  };
  const skillUpdateBody = {
    name: skillCreateBody.name,
    description: skillCreateBody.description,
    content: skillCreateBody.content,
    tool_ids: skillCreateBody.tool_ids,
  };
  const skillGet = await fetch(
    `${kb}/api/agent_builder/skills/${SKILL_ID}`,
    { headers },
  );
  if (skillGet.status !== 200 && skillGet.status !== 404) {
    throw new Error(
      `Could not inspect skill ${SKILL_ID}: HTTP ${skillGet.status}`,
    );
  }
  const skillMethod = skillGet.status === 200 ? 'PUT' : 'POST';
  const skillUrl =
    skillMethod === 'PUT'
      ? `${kb}/api/agent_builder/skills/${SKILL_ID}`
      : `${kb}/api/agent_builder/skills`;
  const skillRes = await fetch(skillUrl, {
    method: skillMethod,
    headers,
    body: JSON.stringify(
      skillMethod === 'PUT' ? skillUpdateBody : skillCreateBody,
    ),
  });
  if (!skillRes.ok) {
    const detail = (await skillRes.text()).slice(0, 400);
    throw new Error(
      `Could not ${skillMethod === 'PUT' ? 'update' : 'create'} skill ${SKILL_ID}: HTTP ${skillRes.status} ${detail}`,
    );
  }

  const body = {
    id: AGENT_ID,
    name: 'Video metadata research',
    description:
      'Edit-time Suggest helper: grounded title lookup via Jina search_web/read_url. Does not write Elasticsearch.',
    labels: ['video-metadata', 'suggest'],
    avatar_color: '#0B64DD',
    avatar_symbol: 'VM',
    access_control: { access_mode: 'shared' },
    configuration: {
      enable_elastic_capabilities: false,
      instructions: AGENT_INSTRUCTIONS,
      skill_ids: [SKILL_ID],
      tools: [
        {
          tool_ids: [...TOOL_IDS],
        },
      ],
    },
  };
  const updateBody = {
    name: body.name,
    description: body.description,
    labels: body.labels,
    avatar_color: body.avatar_color,
    avatar_symbol: body.avatar_symbol,
    access_control: body.access_control,
    configuration: body.configuration,
  };

  const getRes = await fetch(`${kb}/api/agent_builder/agents/${AGENT_ID}`, {
    headers,
  });

  if (getRes.status !== 200 && getRes.status !== 404) {
    throw new Error(
      `Could not inspect agent ${AGENT_ID}: HTTP ${getRes.status}`,
    );
  }

  const method = getRes.status === 200 ? 'PUT' : 'POST';
  const url =
    method === 'PUT'
      ? `${kb}/api/agent_builder/agents/${AGENT_ID}`
      : `${kb}/api/agent_builder/agents`;

  const res = await fetch(url, {
    method,
    headers,
    body: JSON.stringify(method === 'PUT' ? updateBody : body),
  });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text.slice(0, 400) };
  }
  console.log(
    JSON.stringify(
      {
        ok: res.ok,
        status: res.status,
        method,
        agent_id: AGENT_ID,
        kibana_host: kb.replace(/^https:\/\/[^.]+/, 'https://***'),
        response_id: (parsed as { id?: string }).id ?? null,
        skill_id: SKILL_ID,
        elastic_capabilities: false,
        ...(res.ok
          ? {}
          : {
              error:
                (parsed as { message?: string; error?: string }).message ??
                (parsed as { error?: string }).error ??
                (parsed as { raw?: string }).raw ??
                'Agent update failed',
            }),
        tools:
          (parsed as { configuration?: { tools?: unknown } }).configuration
            ?.tools ?? null,
      },
      null,
      2,
    ),
  );
  if (!res.ok) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
