/**
 * Backfill `meta.group_id` from chunk window:
 *   fine / 10 s → trailer
 *   2s / 2 s   → demo
 *
 * Usage:
 *   yarn backfill-group-id           # only assets missing group_id
 *   yarn backfill-group-id --force   # overwrite existing group_id
 *   yarn backfill-group-id --dry-run # count only
 */
import { loadDotenv } from './load-dotenv';

loadDotenv();

import { getConfig } from '../lib/config';
import { getEsClient } from '../lib/es/client';
import { inferGroupFromVariants } from '../lib/metadata/groups';

type AssetHit = {
  _id?: string;
  _source?: {
    meta?: { group_id?: string; revision?: number };
    variants?: Array<{
      chunk_preset?: string;
      chunk_window_ms?: number;
    }>;
  };
};

async function main(): Promise<void> {
  const force = process.argv.includes('--force');
  const dryRun = process.argv.includes('--dry-run');
  const client = getEsClient();
  const cfg = getConfig();

  let from = 0;
  const size = 200;
  let scanned = 0;
  let updated = 0;
  let skippedHasGroup = 0;
  let skippedNoMatch = 0;
  const counts = { trailer: 0, demo: 0 };

  for (;;) {
    const res = await client.search({
      index: cfg.ES_INDEX_ASSETS,
      from,
      size,
      _source: ['meta.group_id', 'meta.revision', 'variants'],
      query: { match_all: {} },
    });
    const hits = (res.hits.hits ?? []) as AssetHit[];
    if (hits.length === 0) break;

    for (const hit of hits) {
      scanned += 1;
      const id = hit._id;
      if (!id) continue;
      const src = hit._source ?? {};
      const existing = src.meta?.group_id;
      if (existing && !force) {
        skippedHasGroup += 1;
        continue;
      }
      const inferred = inferGroupFromVariants(src.variants ?? []);
      if (!inferred) {
        skippedNoMatch += 1;
        continue;
      }
      counts[inferred] += 1;
      if (dryRun) {
        updated += 1;
        continue;
      }
      const now = new Date().toISOString();
      const prevRev =
        typeof src.meta?.revision === 'number' ? src.meta.revision : 0;
      await client.update({
        index: cfg.ES_INDEX_ASSETS,
        id,
        refresh: false,
        retry_on_conflict: 3,
        script: {
          lang: 'painless',
          source: `
            if (ctx._source.meta == null) {
              ctx._source.meta = new HashMap();
              ctx._source.meta.revision = 1L;
            } else {
              def current = ctx._source.meta.revision;
              if (current == null) { current = 0L; }
              ctx._source.meta.revision = current + 1L;
            }
            if (ctx._source.meta.review == null) {
              ctx._source.meta.review = new HashMap();
            }
            ctx._source.meta.group_id = params.group_id;
            ctx._source.meta.review.group_id = [
              'source': 'manual',
              'confirmed': true
            ];
            ctx._source.meta.updated_at = params.now;
          `,
          params: { group_id: inferred, now, expected_base: prevRev },
        },
      });
      updated += 1;
    }

    from += hits.length;
    if (hits.length < size) break;
  }

  if (!dryRun && updated > 0) {
    await client.indices.refresh({ index: cfg.ES_INDEX_ASSETS });
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        dry_run: dryRun,
        force,
        scanned,
        updated,
        skipped_has_group: skippedHasGroup,
        skipped_no_match: skippedNoMatch,
        counts,
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
