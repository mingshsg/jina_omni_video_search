import { getConfig } from '../config';
import { inferGroupFromVariants, parseFreeformGroupId } from '../metadata/groups';
import { getEsClient } from './client';
import { getAsset } from './index-assets';

export type GroupBackfillOutcome =
  | { status: 'updated'; group_id: string }
  | { status: 'already_set' | 'no_match' | 'not_found' | 'changed' };

/**
 * Explicit, single-video backfill only. A scripted guard keeps a concurrent
 * editorial write from being overwritten between the read and the update.
 */
export async function backfillAssetGroup(
  videoId: string,
  selectedGroup: string,
  /** Legacy inferred-only request. New manual selections omit this. */
  expectedSuggestion?: 'trailer' | 'demo',
): Promise<GroupBackfillOutcome> {
  const groupId = parseFreeformGroupId(selectedGroup);
  const asset = await getAsset(videoId);
  if (!asset) return { status: 'not_found' };
  if (asset.meta?.group_id) return { status: 'already_set' };

  if (expectedSuggestion) {
    const inferred = inferGroupFromVariants(asset.variants ?? []);
    if (!inferred) return { status: 'no_match' };
    if (inferred !== expectedSuggestion || groupId !== expectedSuggestion) {
      return { status: 'changed' };
    }
  }

  const client = getEsClient();
  const cfg = getConfig();
  const update = await client.update({
    index: cfg.ES_INDEX_ASSETS,
    id: videoId,
    refresh: 'wait_for',
    retry_on_conflict: 3,
    script: {
      lang: 'painless',
      source: `
        if (ctx._source.meta != null && ctx._source.meta.group_id != null) {
          ctx.op = 'noop';
        } else {
          if (ctx._source.meta == null) {
            ctx._source.meta = new HashMap();
          }
          def current = ctx._source.meta.revision;
          if (current == null) { current = 0L; }
          ctx._source.meta.revision = current + 1L;
          if (ctx._source.meta.review == null) {
            ctx._source.meta.review = new HashMap();
          }
          ctx._source.meta.group_id = params.group_id;
          ctx._source.meta.review.group_id = [
            'source': 'manual', 'confirmed': true
          ];
          ctx._source.meta.updated_at = params.now;
        }
      `,
      params: { group_id: groupId, now: new Date().toISOString() },
    },
  });
  return update.result === 'updated'
    ? { status: 'updated', group_id: groupId }
    : { status: 'already_set' };
}
