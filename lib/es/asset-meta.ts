import { getConfig } from '../config';
import { publishDescriptionEmbedding } from '../metadata/description-embed';
import type { AssetMeta, MetaPatchApply } from '../metadata/validate';
import { toEditorDto, type AssetMetaEditorDto } from '../metadata/validate';
import { getEsClient } from './client';
import { getAsset } from './index-assets';

export class MetaConflictError extends Error {
  readonly code = 'META_CONFLICT';
  readonly status = 409;
  readonly current_revision: number;

  constructor(currentRevision: number, message?: string) {
    super(message ?? 'Metadata revision conflict');
    this.name = 'MetaConflictError';
    this.current_revision = currentRevision;
  }
}

/**
 * Elasticsearch update-version retries exhausted while meta.revision is
 * unchanged — retryable transport race, not a stale editor revision.
 */
export class MetaTransportConflictError extends Error {
  readonly code = 'META_TRANSPORT_CONFLICT';
  readonly status = 409;
  readonly current_revision: number;

  constructor(currentRevision: number, message?: string) {
    super(
      message ??
        'Concurrent document write conflict; retry without reloading metadata',
    );
    this.name = 'MetaTransportConflictError';
    this.current_revision = currentRevision;
  }
}

export class MetaNotFoundError extends Error {
  readonly code = 'LIBRARY_NOT_FOUND';
  readonly status = 404;

  constructor(videoId: string) {
    super(`Video not found: ${videoId}`);
    this.name = 'MetaNotFoundError';
  }
}

const CLEARABLE_META_KEYS = [
  'description',
  'abstract',
  'year',
  'actors',
  'actor_ids',
  'actor_aliases',
  'actor_keys',
  'video_type',
  'primary_language',
  'country',
  'tags',
  'tags_key',
  'work_title',
] as const;

const REVIEW_FIELD_KEYS = [
  'description',
  'abstract',
  'year',
  'actors',
  'video_type',
  'primary_language',
  'country',
  'tags',
  'work_title',
] as const;

/**
 * Painless update script:
 * - expected_revision=0 bootstraps missing meta
 * - semantic mismatch throws revision_mismatch (not retried by retry_on_conflict)
 * - null field values clear the field and its review entry
 */
const META_UPDATE_SCRIPT = `
  def expected = params.expected_revision;
  def now = params.now;
  def fields = params.fields;
  def reviewPatch = params.review;

  if (ctx._source.meta == null) {
    if (expected != 0L && expected != 0) {
      throw new Exception('revision_mismatch');
    }
    ctx._source.meta = new HashMap();
    ctx._source.meta.revision = 1L;
  } else {
    def current = ctx._source.meta.revision;
    if (current == null) {
      current = 0L;
    }
    if (current != expected) {
      throw new Exception('revision_mismatch');
    }
    ctx._source.meta.revision = current + 1L;
  }

  if (ctx._source.meta.review == null) {
    ctx._source.meta.review = new HashMap();
  }

  for (entry in fields.entrySet()) {
    def key = entry.getKey();
    def val = entry.getValue();
    if (val == null) {
      ctx._source.meta.remove(key);
      if (params.clear_review_keys.contains(key)) {
        ctx._source.meta.review.remove(key);
      }
    } else {
      ctx._source.meta[key] = val;
    }
  }

  if (reviewPatch != null) {
    for (entry in reviewPatch.entrySet()) {
      ctx._source.meta.review[entry.getKey()] = entry.getValue();
    }
  }

  // Drop review entries for cleared editorial fields
  for (rk in params.clear_review_keys) {
    if (fields.containsKey(rk) && fields[rk] == null) {
      ctx._source.meta.review.remove(rk);
    }
  }

  // Phase 3.5: mark description embedding stale when text fields change.
  // Gated by mark_semantic_stale — live indices without the dense_vector /
  // description_embedding_meta mapping must not fail editorial PATCH.
  if (
    params.mark_semantic_stale == true
    && (fields.containsKey('description') || fields.containsKey('abstract'))
  ) {
    if (ctx._source.meta.description_embedding_meta == null) {
      ctx._source.meta.description_embedding_meta = new HashMap();
    }
    ctx._source.meta.description_embedding_meta.state = 'stale';
  }

  ctx._source.meta.updated_at = now;
`;

/** True when ES rejects a field not present under dynamic:strict. */
export function isStrictDynamicMappingException(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as {
    meta?: { body?: { error?: { type?: string; reason?: string } } };
    message?: string;
  };
  const type = e.meta?.body?.error?.type;
  if (type === 'strict_dynamic_mapping_exception') return true;
  const reason = e.meta?.body?.error?.reason ?? '';
  const message = typeof e.message === 'string' ? e.message : '';
  return (
    reason.includes('strict_dynamic_mapping_exception') ||
    message.includes('strict_dynamic_mapping_exception') ||
    (message.includes('mapping set to strict') &&
      message.includes('dynamic introduction'))
  );
}

function isVersionConflict(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as {
    meta?: { statusCode?: number; body?: { error?: { type?: string } } };
    message?: string;
  };
  if (e.meta?.statusCode === 409) return true;
  const type = e.meta?.body?.error?.type;
  if (type === 'version_conflict_engine_exception') return true;
  return typeof e.message === 'string' && e.message.includes('version_conflict');
}

function isDocumentMissing(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as {
    meta?: { statusCode?: number; body?: { error?: { type?: string } } };
  };
  if (e.meta?.statusCode === 404) return true;
  return e.meta?.body?.error?.type === 'document_missing_exception';
}

function isRevisionMismatch(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const message = (err as { message?: string }).message ?? '';
  if (message.includes('revision_mismatch')) return true;

  // Walk nested caused_by chain (illegal_argument → script_exception → exception)
  let node: unknown =
    (err as { meta?: { body?: { error?: unknown } } }).meta?.body?.error;
  for (let depth = 0; depth < 6 && node && typeof node === 'object'; depth++) {
    const rec = node as {
      reason?: string;
      caused_by?: unknown;
      script_stack?: string[];
    };
    if (typeof rec.reason === 'string' && rec.reason.includes('revision_mismatch')) {
      return true;
    }
    if (
      Array.isArray(rec.script_stack) &&
      rec.script_stack.some((s) => s.includes('revision_mismatch'))
    ) {
      return true;
    }
    node = rec.caused_by;
  }
  return false;
}

/** Safe editor DTO — no media paths. */
export async function getAssetMetaEditorDto(
  videoId: string,
): Promise<AssetMetaEditorDto> {
  const asset = await getAsset(videoId);
  if (!asset) throw new MetaNotFoundError(videoId);
  return toEditorDto(videoId, asset.title, asset.meta ?? null);
}

export interface PatchAssetMetaResult {
  video_id: string;
  meta_revision: number;
  meta: AssetMetaEditorDto['meta'];
}

/**
 * Atomic metadata PATCH with expected_revision and refresh=wait_for.
 * retry_on_conflict handles transport version races only.
 *
 * When ASSET_SEMANTIC_ENABLED is on but the live index still lacks
 * `meta.description_embedding(_meta)`, a first attempt may hit
 * strict_dynamic_mapping_exception. We soft-fail that channel and retry
 * the editorial write without marking semantic stale so Save still works.
 * Operators should run `yarn setup-indices` to put the mapping.
 */
export async function patchAssetMeta(
  videoId: string,
  apply: MetaPatchApply,
): Promise<PatchAssetMetaResult> {
  const client = getEsClient();
  const cfg = getConfig();

  const clearReviewKeys = REVIEW_FIELD_KEYS.filter((k) => {
    if (k === 'actors') return apply.fields.actor_ids === null;
    return apply.fields[k] === null;
  });

  const clear_review_keys = [
    ...clearReviewKeys,
    // Also clear review when clearing derived actor bags
    ...(apply.fields.actor_ids === null ? (['actors'] as const) : []),
  ];

  const runUpdate = async (markSemanticStale: boolean) => {
    await client.update({
      index: cfg.ES_INDEX_ASSETS,
      id: videoId,
      refresh: 'wait_for',
      retry_on_conflict: 3,
      script: {
        source: META_UPDATE_SCRIPT,
        lang: 'painless',
        params: {
          expected_revision: apply.expected_revision,
          now: new Date().toISOString(),
          fields: apply.fields,
          review: apply.review ?? null,
          clear_review_keys,
          clearable: CLEARABLE_META_KEYS,
          mark_semantic_stale: markSemanticStale,
        },
      },
    });
  };

  const wantSemanticStale =
    cfg.ASSET_SEMANTIC_ENABLED &&
    ('description' in apply.fields || 'abstract' in apply.fields);

  try {
    await runUpdate(wantSemanticStale);
  } catch (err: unknown) {
    // Mapping drift: semantic fields not on live index yet — keep editorial save.
    if (wantSemanticStale && isStrictDynamicMappingException(err)) {
      try {
        await runUpdate(false);
      } catch (retryErr: unknown) {
        await classifyPatchError(retryErr, videoId, apply.expected_revision);
      }
    } else {
      await classifyPatchError(err, videoId, apply.expected_revision);
    }
  }

  const dto = await getAssetMetaEditorDto(videoId);

  // Optional asset semantic channel — never fails / blocks the save.
  // Always reconcile under the latest revision. Soft 8s bound; on timeout
  // schedule one delayed retry so a slow provider cannot permanently strand
  // stale vectors after process continues.
  // If the live mapping still lacks description_embedding*, publish also
  // soft-fails (strict_dynamic_mapping); run yarn setup-indices to enable it.
  if (cfg.ASSET_SEMANTIC_ENABLED) {
    void (async () => {
      try {
        const run = () =>
          publishDescriptionEmbedding({
            videoId,
            sourceRevision: dto.meta_revision,
            cfg,
          });
        const outcome = await Promise.race([
          run().then((r) => ({ kind: 'done' as const, r })),
          new Promise<{ kind: 'timeout' }>((resolve) =>
            setTimeout(() => resolve({ kind: 'timeout' }), 8_000),
          ),
        ]);
        if (outcome.kind === 'timeout') {
          setTimeout(() => {
            void run().catch(() => undefined);
          }, 2_000);
        }
      } catch {
        // leave stale/failed; editorial save already committed
      }
    })();
  }

  return {
    video_id: videoId,
    meta_revision: dto.meta_revision,
    meta: dto.meta,
  };
}

async function classifyPatchError(
  err: unknown,
  videoId: string,
  expectedRevision: number,
): Promise<never> {
  if (isDocumentMissing(err)) {
    throw new MetaNotFoundError(videoId);
  }
  if (isRevisionMismatch(err)) {
    const current = await getAsset(videoId);
    throw new MetaConflictError(current?.meta?.revision ?? 0);
  }
  // Exhausted transport version retries. Only META_CONFLICT when the
  // editorial revision actually moved; otherwise a distinct retryable code.
  if (isVersionConflict(err)) {
    const current = await getAsset(videoId);
    const rev = current?.meta?.revision ?? 0;
    if (rev === expectedRevision) {
      throw new MetaTransportConflictError(rev);
    }
    throw new MetaConflictError(rev);
  }
  throw err;
}

export type { AssetMeta };
