/**
 * One-off naming repair for todo/41 (task 1). Two operations:
 *
 *   1. DELETE the `O_SpringOfTheBlade…` asset (+ its chunks) from ES only.
 *      Disk files are kept (NFR-5). Auto-rollback is not possible.
 *   2. RENAME the `75f1e202-….mp4` asset to its readable name, updating the
 *      asset title AND every chunk's denormalized `video_title` so search
 *      shows one consistent name.
 *
 * Safety:
 *   - Dry-run by default. Pass `--apply` to write.
 *   - Both targets are pinned by `_id` AND asserted against their expected
 *     title at execution time, so a changed id/content aborts instead of
 *     deleting or renaming the wrong document.
 *
 * Change record: chn.docs/数据变更-命名修复-2026-09-30.md
 * Executed against live ES on 2026-09-30 (see todo/41).
 *
 * Usage:
 *   yarn tsx scripts/fix-naming-2026-09-30.ts            # dry-run
 *   yarn tsx scripts/fix-naming-2026-09-30.ts --apply    # write
 */
import { loadDotenv } from './load-dotenv';

loadDotenv();

import { getConfig } from '../lib/config';
import { getEsClient } from '../lib/es/client';
import { getAsset } from '../lib/es/index-assets';
import { removeAssetFromIndex } from '../lib/es/list-assets';
import { renameAssetTitle } from '../lib/es/asset-rename';

const DELETE_ID = '050f80a5-2ce6-420e-a9a9-ca2d66927a6e';
const DELETE_TITLE = 'O_SpringOfTheBlade_iQIYI_BTS_3m28s_U5m0UgmU2kA';

const RENAME_ID = '399fccc1-b2d0-4e76-a9e7-3dcc8e6e73ed';
const RENAME_FROM = '75f1e202-ad61-470e-aab9-0d7cff56c067.mp4';
const RENAME_TO =
  'Q_ZhenHuanZhuan_EmpressesInThePalace_EP38_LetvOfficial_45m10s_xPic_NctWfg.mp4';

async function applyDelete(): Promise<Record<string, unknown>> {
  const asset = await getAsset(DELETE_ID);
  if (!asset) {
    return { id: DELETE_ID, outcome: 'not_found' };
  }
  if (asset.title !== DELETE_TITLE) {
    throw new Error(
      `Refusing to delete ${DELETE_ID}: expected title ${JSON.stringify(
        DELETE_TITLE,
      )}, found ${JSON.stringify(asset.title)}`,
    );
  }
  const result = await removeAssetFromIndex(DELETE_ID);
  return {
    id: DELETE_ID,
    title: asset.title,
    media_path_kept: asset.media_path,
    deleted_asset: result.deleted_asset,
    deleted_chunks: result.deleted_chunks,
  };
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const dryRun = !apply;
  const cfg = getConfig();
  const client = getEsClient();

  console.log(
    JSON.stringify(
      {
        mode: dryRun ? 'DRY-RUN (pass --apply to write)' : 'APPLY',
        index_assets: cfg.ES_INDEX_ASSETS,
        index_chunks: cfg.ES_INDEX_CHUNKS,
      },
      null,
      2,
    ),
  );

  // ---- 1. delete ----------------------------------------------------------
  const before = await getAsset(DELETE_ID);
  const chunksBefore = await client.count({
    index: cfg.ES_INDEX_CHUNKS,
    query: { term: { video_id: DELETE_ID } },
  });
  console.log(
    JSON.stringify(
      {
        step: 'delete',
        id: DELETE_ID,
        found_title: before?.title ?? null,
        title_matches: before?.title === DELETE_TITLE,
        chunks_before: chunksBefore.count,
      },
      null,
      2,
    ),
  );
  if (!dryRun) {
    console.log(JSON.stringify({ step: 'delete_result', ...(await applyDelete()) }, null, 2));
    const after = await getAsset(DELETE_ID);
    const chunksAfter = await client.count({
      index: cfg.ES_INDEX_CHUNKS,
      query: { term: { video_id: DELETE_ID } },
    });
    console.log(
      JSON.stringify(
        {
          step: 'delete_verify',
          asset_exists: after !== null,
          chunks_after: chunksAfter.count,
        },
        null,
        2,
      ),
    );
  }

  // ---- 2. rename ----------------------------------------------------------
  const renameResult = await renameAssetTitle({
    videoId: RENAME_ID,
    expectedTitle: RENAME_FROM,
    newTitle: RENAME_TO,
    dryRun,
  });
  console.log(JSON.stringify({ step: 'rename', ...renameResult }, null, 2));

  if (!dryRun) {
    const verified = await getAsset(RENAME_ID);
    const chunkTitles = await client.search({
      index: cfg.ES_INDEX_CHUNKS,
      size: 0,
      query: { term: { video_id: RENAME_ID } },
      aggs: {
        titles: { terms: { field: 'video_title.keyword', size: 10 } },
      },
    });
    console.log(
      JSON.stringify(
        {
          step: 'rename_verify',
          asset_title: verified?.title ?? null,
          chunk_title_buckets: (
            (chunkTitles.aggregations?.titles as { buckets?: unknown[] })
              ?.buckets ?? []
          ),
        },
        null,
        2,
      ),
    );
  }
}

main().catch((err: unknown) => {
  console.error(
    JSON.stringify(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      null,
      2,
    ),
  );
  process.exit(1);
});
