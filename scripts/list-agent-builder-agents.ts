import { loadDotenv } from './load-dotenv';

async function main() {
  loadDotenv();
  const es = (process.env.ELASTICSEARCH_URL || '').replace(/\/$/, '');
  const key = process.env.ELASTICSEARCH_API_KEY || '';
  const kb = es.includes('.es.') ? es.replace('.es.', '.kb.') : '';
  if (!kb || !key) {
    console.log(JSON.stringify({ ok: false, error: 'missing_es_or_kb' }));
    process.exit(1);
  }
  console.log(
    JSON.stringify({
      kb_host: kb.replace(/^https:\/\/[^.]+/, 'https://***'),
    }),
  );
  const res = await fetch(`${kb}/api/agent_builder/agents`, {
    headers: {
      Authorization: `ApiKey ${key}`,
      'kbn-xsrf': 'true',
    },
  });
  const text = await res.text();
  console.log(JSON.stringify({ status: res.status }));
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    console.log(JSON.stringify({ body_prefix: text.slice(0, 240) }));
    process.exit(1);
  }
  const results = (body as { results?: unknown[] }).results ?? body;
  const list = Array.isArray(results) ? results : [];
  for (const a of list as Array<{
    id?: string;
    name?: string;
    configuration?: {
      enable_elastic_capabilities?: boolean;
      skill_ids?: string[];
      tools?: Array<{ tool_ids?: string[] }>;
    };
  }>) {
    const toolIds =
      a.configuration?.tools?.flatMap((t) => t.tool_ids ?? []) ?? [];
    console.log(
      JSON.stringify({
        id: a.id,
        name: a.name,
        tool_count: toolIds.length,
        tools_sample: toolIds.slice(0, 20),
        skill_ids: a.configuration?.skill_ids ?? [],
        elastic_capabilities:
          a.configuration?.enable_elastic_capabilities ?? null,
      }),
    );
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
