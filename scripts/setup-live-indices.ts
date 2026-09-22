/**
 * Phase 1 — idempotent live Elasticsearch index / data-stream setup.
 *
 * Targets ONLY the external Elastic instance from `.env`
 * (`ELASTICSEARCH_URL` + `ELASTICSEARCH_API_KEY`). Does not install, download,
 * or start Elasticsearch. Does not modify file-video indices.
 *
 * Retention (product decision 2026-09-10): DSL enabled without data_retention
 * — indefinite keep until explicit delete. Never configure age-based purge.
 */
import { loadDotenv } from './load-dotenv';

loadDotenv();

import { getEsClient, resetEsClient } from '../lib/es/client';
import { ensureLiveIndices } from '../lib/live/indices';
import { getLiveConfig, resetLiveConfig } from '../lib/live/config';

async function main(): Promise<void> {
  resetEsClient();
  resetLiveConfig();

  const url = process.env.ELASTICSEARCH_URL;
  if (!url || !url.trim()) {
    throw new Error('ELASTICSEARCH_URL is required in .env (external Elastic only)');
  }
  if (!process.env.ELASTICSEARCH_API_KEY?.trim()) {
    throw new Error('ELASTICSEARCH_API_KEY is required in .env');
  }

  const liveCfg = getLiveConfig();
  const result = await ensureLiveIndices(getEsClient(), liveCfg);

  const allSkipped =
    result.sources === 'skipped' &&
    result.sessions === 'skipped' &&
    result.workers === 'skipped' &&
    result.protectRanges === 'skipped' &&
    result.chunksStream === 'skipped' &&
    result.eventsStream === 'skipped';

  console.log(
    JSON.stringify(
      {
        ok: true,
        message: allSkipped
          ? 'Live indices/streams already exist — templates refreshed; lifecycle read-back verified.'
          : 'Live index setup complete.',
        note:
          'Retention is indefinite (no data_retention). Spool byte caps optional/unlimited by default.',
        ...result,
      },
      null,
      2,
    ),
  );
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(JSON.stringify({ ok: false, error: message }, null, 2));
  process.exit(1);
});
