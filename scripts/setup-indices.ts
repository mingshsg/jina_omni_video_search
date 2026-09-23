/**
 * Idempotent Elasticsearch index setup (NFR-6).
 * Creates video-assets and video-chunks if missing; upgrades asset mapping
 * with new `meta.*` properties when the index already exists.
 */
import { loadDotenv } from './load-dotenv';

loadDotenv();

import { ensureIndices } from '../lib/es/indices';

async function main(): Promise<void> {
  const result = await ensureIndices();
  const unchanged =
    result.assets === 'skipped' && result.chunks === 'skipped';
  const summary = {
    ...result,
    message: unchanged
      ? 'All indices already exist — mapping already current.'
      : result.assets === 'upgraded'
        ? 'Index setup complete (video-assets mapping upgraded).'
        : 'Index setup complete.',
  };
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  const payload: Record<string, unknown> = { ok: false, error: message };
  if (
    err &&
    typeof err === 'object' &&
    'conflicts' in err &&
    Array.isArray((err as { conflicts: unknown }).conflicts)
  ) {
    payload.conflicts = (err as { conflicts: unknown }).conflicts;
  }
  console.error(JSON.stringify(payload, null, 2));
  process.exit(1);
});
