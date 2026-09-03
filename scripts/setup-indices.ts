/**
 * Phase 3 — idempotent Elasticsearch index setup (NFR-6).
 * Creates video-assets and video-chunks if missing; second run is a no-op.
 */
import { loadDotenv } from './load-dotenv';

loadDotenv();

import { ensureIndices } from '../lib/es/indices';

async function main(): Promise<void> {
  const result = await ensureIndices();
  const summary = {
    ...result,
    message:
      result.assets === 'skipped' && result.chunks === 'skipped'
        ? 'All indices already exist — no changes applied.'
        : 'Index setup complete.',
  };
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(JSON.stringify({ ok: false, error: message }, null, 2));
  process.exit(1);
});
