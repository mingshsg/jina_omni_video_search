/**
 * Smoke-test Jina Search + Reader (REST equivalents of MCP search_web / read_url).
 * Usage: yarn probe-jina-suggest
 * Requires JINA_API_KEY in .env. Never prints the key.
 */
import { getConfig } from '../lib/config';
import { jinaReadUrl, jinaSearchWeb } from '../lib/metadata/jina-web';
import {
  isAllowlistedUrl,
  pickReadableCandidates,
} from '../lib/metadata/suggest-web';

async function main() {
  const cfg = getConfig();
  if (!cfg.JINA_API_KEY.trim()) {
    console.error('JINA_API_KEY is empty — set it in .env first.');
    process.exit(1);
  }

  const query = process.argv[2] ?? '"Breakfast at Tiffany\'s" film 1961';
  console.log('search_web query:', query);
  const hits = await jinaSearchWeb({ query, num: 5, cfg, timeoutMs: 15_000 });
  console.log(
    'hits:',
    hits.map((h) => ({
      title: h.title.slice(0, 80),
      url: h.url,
      allowlisted: isAllowlistedUrl(h.url),
    })),
  );

  const readable = pickReadableCandidates(hits, "Breakfast at Tiffany's", 1);
  if (readable.length === 0) {
    console.log('No allowlisted readable candidate — search OK, read skipped.');
    return;
  }

  const page = await jinaReadUrl({
    url: readable[0]!.url,
    question: 'What is the original release year? Quote year only.',
    cfg,
    timeoutMs: 30_000,
  });
  console.log('read_url:', {
    title: page.title.slice(0, 80),
    url: page.url,
    content_preview: page.content.slice(0, 240),
  });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
