import { loadDotenv } from './load-dotenv';

async function main() {
  loadDotenv();
  const es = (process.env.ELASTICSEARCH_URL || '').replace(/\/$/, '');
  const key = process.env.ELASTICSEARCH_API_KEY || '';
  const kb = es.replace('.es.', '.kb.');

  async function get(path: string) {
    const res = await fetch(`${kb}${path}`, {
      headers: {
        Authorization: `ApiKey ${key}`,
        'kbn-xsrf': 'true',
      },
    });
    const text = await res.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return { status: res.status, text: text.slice(0, 400) };
    }
    return { status: res.status, body };
  }

  for (const path of [
    '/api/agent_builder/tools',
    '/api/agent_builder/skills',
    '/api/agent_builder/agents/elastic-ai-agent',
  ]) {
    const r = await get(path);
    console.log('===', path, r.status);
    if ('text' in r && r.text) {
      console.log(r.text);
      continue;
    }
    const b = r.body as Record<string, unknown>;
    if (Array.isArray(b?.results)) {
      console.log('count', (b.results as unknown[]).length);
      for (const x of b.results as Array<Record<string, unknown>>) {
        const id = String(x.id ?? '');
        const name = String(x.name ?? x.description ?? '');
        const type = String(x.type ?? x.tool_type ?? '');
        const looksJina =
          /jina|search_web|read_url|mcp/i.test(id) ||
          /jina|search_web|read_url/i.test(name);
        if (looksJina || path.includes('skills') || (b.results as unknown[]).length <= 40) {
          console.log(
            JSON.stringify({
              id,
              name: name.slice(0, 120),
              type,
            }),
          );
        }
      }
      continue;
    }
    console.log(
      JSON.stringify({
        id: b.id,
        name: b.name,
        tools: b.configuration,
      }).slice(0, 1200),
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
