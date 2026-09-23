/**
 * Asset-level description embedding (Phase 3.5).
 * Chunks are never re-embedded; this is a separate optional channel.
 */
import { createHash } from 'node:crypto';
import { getConfig, type AppConfig } from '../config';
import { createEmbeddingProvider } from '../embed/provider';
import { getEsClient } from '../es/client';
import { getAsset } from '../es/index-assets';

export type DescriptionEmbedState = 'current' | 'stale' | 'failed';

export interface DescriptionEmbeddingMeta {
  source_revision: number;
  source_digest: string;
  state: DescriptionEmbedState;
  provider: string;
  model: string;
  task: string;
  dims: number;
}

export function descriptionSourceDigest(
  description: string | null | undefined,
  abstract: string | null | undefined,
): string {
  const payload = `${description ?? ''}\n${abstract ?? ''}`;
  return `sha256:${createHash('sha256').update(payload, 'utf8').digest('hex')}`;
}

export function descriptionEmbedText(
  description: string | null | undefined,
  abstract: string | null | undefined,
): string {
  return [description, abstract]
    .map((s) => (typeof s === 'string' ? s.trim() : ''))
    .filter(Boolean)
    .join('\n')
    .trim();
}

/**
 * After a successful metadata save that touched description/abstract:
 * embed and publish against the *current* asset revision.
 * Failures leave state=failed/stale and never fail the save.
 *
 * Also safe to call after unrelated edits: if description digest already
 * matches a current vector of the active identity, returns skipped.
 */
export async function publishDescriptionEmbedding(params: {
  videoId: string;
  /** Ignored for identity; kept for call-site compatibility. */
  sourceRevision?: number;
  cfg?: AppConfig;
}): Promise<'published' | 'skipped' | 'failed' | 'disabled'> {
  const cfg = params.cfg ?? getConfig();
  if (!cfg.ASSET_SEMANTIC_ENABLED) return 'disabled';

  const asset = await getAsset(params.videoId);
  if (!asset) return 'skipped';
  const revision = asset.meta?.revision ?? 0;

  const description =
    typeof asset.meta?.description === 'string' ? asset.meta.description : null;
  const abstract =
    typeof asset.meta?.abstract === 'string' ? asset.meta.abstract : null;
  const text = descriptionEmbedText(description, abstract);
  const digest = descriptionSourceDigest(description, abstract);
  const client = getEsClient();

  const existingMeta = (
    asset.meta as { description_embedding_meta?: DescriptionEmbeddingMeta } | undefined
  )?.description_embedding_meta;
  if (
    existingMeta?.state === 'current' &&
    existingMeta.source_digest === digest &&
    existingMeta.provider === cfg.EMBED_PROVIDER &&
    existingMeta.model === cfg.EMBED_MODEL &&
    existingMeta.task === cfg.EMBED_TASK_PASSAGE &&
    existingMeta.dims === cfg.EMBED_DIMS
  ) {
    return 'skipped';
  }

  if (!text) {
    try {
      await client.update({
        index: cfg.ES_INDEX_ASSETS,
        id: params.videoId,
        refresh: 'wait_for',
        script: {
          lang: 'painless',
          source: `
            if (ctx._source.meta == null || ctx._source.meta.revision != params.rev) {
              ctx.op = 'noop';
            } else {
              ctx._source.meta.remove('description_embedding');
              ctx._source.meta.description_embedding_meta = params.meta;
            }
          `,
          params: {
            rev: revision,
            meta: {
              source_revision: revision,
              source_digest: digest,
              state: 'failed',
              provider: cfg.EMBED_PROVIDER,
              model: cfg.EMBED_MODEL,
              task: cfg.EMBED_TASK_PASSAGE,
              dims: cfg.EMBED_DIMS,
            } satisfies DescriptionEmbeddingMeta,
          },
        },
      });
    } catch {
      // Mapping missing or transport error — never fail the editorial save.
    }
    return 'failed';
  }

  try {
    const provider = createEmbeddingProvider(cfg);
    const result = await provider.embedText(text, 'passage');
    const meta: DescriptionEmbeddingMeta = {
      source_revision: revision,
      source_digest: digest,
      state: 'current',
      provider: provider.provider,
      model: provider.model,
      task: provider.task,
      dims: provider.dims,
    };

    const updateRes = await client.update({
      index: cfg.ES_INDEX_ASSETS,
      id: params.videoId,
      refresh: 'wait_for',
      script: {
        lang: 'painless',
        source: `
          if (ctx._source.meta == null || ctx._source.meta.revision != params.rev) {
            ctx.op = 'noop';
          } else {
            ctx._source.meta.description_embedding = params.vector;
            ctx._source.meta.description_embedding_meta = params.meta;
          }
        `,
        params: {
          rev: revision,
          vector: result.embedding,
          meta,
        },
      },
    });
    // Concurrent edit → revision guard no-ops; do not claim published.
    if (updateRes.result === 'noop') return 'skipped';
    return 'published';
  } catch {
    try {
      await client.update({
        index: cfg.ES_INDEX_ASSETS,
        id: params.videoId,
        refresh: 'wait_for',
        script: {
          lang: 'painless',
          source: `
            if (ctx._source.meta == null || ctx._source.meta.revision != params.rev) {
              ctx.op = 'noop';
            } else {
              if (ctx._source.meta.description_embedding_meta == null) {
                ctx._source.meta.description_embedding_meta = new HashMap();
              }
              ctx._source.meta.description_embedding_meta.state = 'failed';
              ctx._source.meta.description_embedding_meta.source_revision = params.rev;
              ctx._source.meta.description_embedding_meta.source_digest = params.digest;
            }
          `,
          params: {
            rev: revision,
            digest,
          },
        },
      });
    } catch {
      // ignore secondary failure
    }
    return 'failed';
  }
}

