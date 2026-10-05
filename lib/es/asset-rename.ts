import { getConfig } from '../config';
import { getEsClient } from './client';
import { getAsset } from './index-assets';
import { getJobByVideoId } from '../ingest/job-store';

/** Longest title a display name may be; mirrors the ES keyword subfield. */
export const ASSET_TITLE_MAX = 256;

export class AssetRenameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssetRenameError';
  }
}

export interface AssetRenameResult {
  video_id: string;
  previous_title: string;
  new_title: string;
  /** `updated` | `noop` — the asset document write result. */
  asset_result: string;
  /** Chunk documents matched by `video_id` (the redundant `video_title`). */
  chunks_total: number;
  /** Chunk documents actually rewritten (0 when already consistent). */
  chunks_updated: number;
  dry_run: boolean;
}

/**
 * Durable rename of an asset display title.
 *
 * A title is denormalized onto every chunk document as `video_title`
 * (`lib/ingest/pipeline.ts`) and search reads it from there
 * (`lib/es/search-core.ts`), so an asset-only rename leaves search showing the
 * stale name. This updates both in one call.
 *
 * Hard invariant 2: chunk vectors, `variant_id`, chunk counts and media paths
 * are untouched — the chunk `update_by_query` script writes **only**
 * `video_title`.
 *
 * `expectedTitle` is required: without it a caller could rename whatever
 * happens to occupy the id (a wrong-target write). Pass the title you looked
 * up and the rename aborts with {@link AssetRenameError} on a mismatch.
 */
export async function renameAssetTitle(params: {
  videoId: string;
  expectedTitle: string;
  newTitle: string;
  dryRun?: boolean;
}): Promise<AssetRenameResult> {
  const newTitle = params.newTitle.normalize('NFKC').trim();
  if (!newTitle) {
    throw new AssetRenameError('New title is empty');
  }
  if (newTitle.length > ASSET_TITLE_MAX) {
    throw new AssetRenameError(
      `New title exceeds ${ASSET_TITLE_MAX} characters`,
    );
  }

  const asset = await getAsset(params.videoId);
  if (!asset) {
    throw new AssetRenameError(`Asset not found: ${params.videoId}`);
  }
  if (asset.title !== params.expectedTitle && asset.title !== newTitle) {
    throw new AssetRenameError(
      `Title mismatch for ${params.videoId}: expected ${JSON.stringify(
        params.expectedTitle,
      )}, found ${JSON.stringify(asset.title)}`,
    );
  }

  const client = getEsClient();
  const cfg = getConfig();

  if (params.dryRun) {
    const counted = await client.count({
      index: cfg.ES_INDEX_CHUNKS,
      query: { term: { video_id: params.videoId } },
    });
    return {
      video_id: params.videoId,
      previous_title: asset.title,
      new_title: newTitle,
      asset_result: 'dry_run',
      chunks_total: counted.count,
      chunks_updated: 0,
      dry_run: true,
    };
  }

  const assetUpdate = await client.update({
    index: cfg.ES_INDEX_ASSETS,
    id: params.videoId,
    refresh: 'wait_for',
    retry_on_conflict: 3,
    // Check and write atomically; a third-party rename must not be overwritten.
    script: {
      lang: 'painless',
      source: `if (ctx._source.title != params.expected && ctx._source.title != params.title) { throw new IllegalArgumentException('Title changed concurrently'); } if (ctx._source.title == params.title) { ctx.op = 'noop'; } else { ctx._source.title = params.title; }`,
      params: { expected: params.expectedTitle, title: newTitle },
    },
  });

  // Keep an active job from restoring the old title on its next persist.
  const job = getJobByVideoId(params.videoId);
  if (job) job.title = newTitle;

  // Only video_title changes; any partial propagation is explicitly retryable.
  const chunkUpdate = await client.updateByQuery({
    index: cfg.ES_INDEX_CHUNKS,
    refresh: true,
    conflicts: 'proceed',
    query: { term: { video_id: params.videoId } },
    script: {
      lang: 'painless',
      source: `
        if (ctx._source.video_title != params.title) {
          ctx._source.video_title = params.title;
        } else {
          ctx.op = 'noop';
        }
      `,
      params: { title: newTitle },
    },
  });

  if (chunkUpdate.timed_out || (chunkUpdate.version_conflicts ?? 0) > 0 ||
      (chunkUpdate.failures?.length ?? 0) > 0) {
    throw new AssetRenameError('Title updated on asset but chunk propagation is incomplete; retry the same rename');
  }
  return {
    video_id: params.videoId,
    previous_title: asset.title,
    new_title: newTitle,
    asset_result: assetUpdate.result,
    chunks_total:
      typeof chunkUpdate.total === 'number' ? chunkUpdate.total : 0,
    chunks_updated:
      typeof chunkUpdate.updated === 'number' ? chunkUpdate.updated : 0,
    dry_run: false,
  };
}
