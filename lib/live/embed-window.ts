import fs from 'node:fs';
import path from 'node:path';
import { getConfig } from '../config';
import {
  assertVariantEmbeddingStack,
  createEmbeddingProvider,
} from '../embed/provider';
import { prepareFiniteMedia } from '../media/prepare-finite-media';
import { embedBudgetBytes } from '../video/budget';
import { ProxyBudgetExhaustedError } from '../video/proxy-encode';
import type { LiveConfig } from './config';
import {
  appendManifestRecord,
  manifestPath,
  sha256File,
} from './fragment-manifest';
import { liveProxySettings } from './live-proxy-ladder';
import {
  buildLiveChunkDocument,
  type LiveWindowEmbedContext,
} from './live-chunk-builder';
import type { LiveIndexDraft } from './indexer';
import {
  classifyProviderError,
  type ProcessAttemptResult,
} from './processor';
import type { LiveWorkItem } from './queue';
import type { ProxySettings } from '../ingest/variant';
import type { EmbeddingProvider } from '../embed/types';
import { probeHasAudioStream } from './window-remux';
import { promoteThumbToRetainedMedia } from './serve-media';

/**
 * Real live window preparation + embedding (Phase 5).
 * Uses shared prepareFiniteMedia with concurrent video/audio under provider gate.
 */

export interface LiveEmbedWindowDeps {
  cfg: LiveConfig;
  ctx: LiveWindowEmbedContext;
  provider?: EmbeddingProvider;
  budgetBytes?: number;
  /** Override has-audio detection (tests). */
  hasAudio?: boolean;
}

/**
 * Factory returns a processWindow hook. AppConfig/provider are resolved lazily
 * on first call so constructing SessionRuntime in unit tests does not require
 * a full `.env` embedding stack.
 */
export function createLiveEmbedWindowHook(deps: LiveEmbedWindowDeps) {
  let provider: EmbeddingProvider | undefined = deps.provider;
  let budget: number | undefined = deps.budgetBytes;
  let stackAsserted = false;

  const assertStack = (emb: EmbeddingProvider): void => {
    if (stackAsserted) return;
    // A-18: fail closed on embedding stack mismatch (do not swallow).
    assertVariantEmbeddingStack(
      {
        provider: deps.ctx.session.embedding.provider as
          | 'eis'
          | 'jina'
          | 'local',
        model: deps.ctx.session.embedding.model,
        task: deps.ctx.session.embedding.task,
        dims: deps.ctx.session.embedding.dims,
        normalizedBy: deps.ctx.session.embedding.normalized_by as
          | 'provider'
          | 'application',
      },
      emb,
    );
    stackAsserted = true;
  };

  const ensureProvider = (): EmbeddingProvider => {
    if (provider) {
      assertStack(provider);
      return provider;
    }
    const appCfg = getConfig();
    provider = createEmbeddingProvider(appCfg);
    assertStack(provider);
    return provider;
  };

  const ensureBudget = (p: EmbeddingProvider): number => {
    if (budget != null) return budget;
    budget = embedBudgetBytes(getConfig(), p.provider);
    return budget;
  };

  return async (args: {
    item: LiveWorkItem;
    proxySettings: ProxySettings;
    signal: AbortSignal;
    attempt: number;
  }): Promise<ProcessAttemptResult> => {
    const started = performance.now();
    const item = args.item;
    if (!item.media_path) {
      return {
        ok: false,
        service_time_ms: performance.now() - started,
        category: 'invalid_media',
        error: 'missing media_path',
      };
    }
    if (args.signal.aborted) {
      return {
        ok: false,
        service_time_ms: performance.now() - started,
        category: 'deadline',
        error: 'aborted before prepare',
      };
    }

    const sessionDir = path.dirname(path.dirname(item.media_path));
    const tmpDir = path.join(sessionDir, 'tmp');
    const videoProxy = path.join(tmpDir, `${item.chunk_id}.proxy.mp4`);
    const audioProxy = path.join(tmpDir, `${item.chunk_id}.proxy.opus`);
    const thumbPath = path.join(tmpDir, `${item.chunk_id}.thumb.jpg`);

    const windowReadyAt = item.receive_anchor_utc;
    const queueWaitMs = Math.max(
      0,
      Date.now() - Date.parse(item.enqueued_at),
    );
    const inferenceStartedAt = new Date().toISOString();

    try {
      const emb = ensureProvider();
      const budgetBytes = ensureBudget(emb);
      const hasAudio =
        deps.hasAudio ?? (await probeHasAudioStream(item.media_path));
      const prepared = await prepareFiniteMedia({
        inputPath: item.media_path,
        startMs: 0,
        endMs: Math.max(1000, item.duration_ms),
        hasAudio,
        budgetBytes,
        proxySettings:
          args.proxySettings ??
          liveProxySettings({
            maxLongEdge: deps.cfg.LIVE_PROXY_MAX_LONG_EDGE,
            maxAttempts: deps.cfg.LIVE_PROXY_MAX_ATTEMPTS,
          }),
        provider: emb,
        paths: {
          videoProxy,
          audioProxy,
          thumb: thumbPath,
        },
        options: {
          concurrentEmbed: true,
          extractThumb: true,
          signal: args.signal,
        },
      });

      // M4: promote thumb into retained media/ before indexing; serve only from media/.
      const tmpThumb = prepared.thumb?.output_path ?? thumbPath;
      if (prepared.thumb || fs.existsSync(tmpThumb)) {
        try {
          promoteThumbToRetainedMedia({
            sessionDir,
            chunkId: item.chunk_id,
            tmpThumbPath: tmpThumb,
          });
        } catch {
          // Thumb is best-effort for search UX; clip remains authoritative.
        }
      }

      const inferenceFinishedAt = new Date().toISOString();
      const indexRequestedAt = inferenceFinishedAt;

      // M3/A-15: bind fingerprint to remuxed MP4 digest.
      const mediaSha256 =
        item.media_sha256 && item.media_sha256 !== 'sha256:unknown'
          ? item.media_sha256
          : sha256File(item.media_path);

      const chunk = buildLiveChunkDocument({
        item,
        prepared,
        ctx: {
          ...deps.ctx,
          media_sha256: mediaSha256,
        },
        attempt: args.attempt,
        queueWaitMs,
        inferenceStartedAt,
        inferenceFinishedAt,
        indexRequestedAt,
        windowReadyAt,
      });

      // M2/A-14 start: durable processed draft before index-ack.
      appendManifestRecord(manifestPath(sessionDir), {
        type: 'window_processed',
        chunk_id: item.chunk_id,
        media_sha256: mediaSha256,
        immutable_fingerprint: chunk.immutable_fingerprint,
        duration_ms: item.duration_ms,
        window_end_at: item.window_end_at,
      });

      const draft: LiveIndexDraft = {
        chunk,
        session_dir: sessionDir,
      };

      return {
        ok: true,
        service_time_ms: performance.now() - started,
        draft: draft as unknown as Record<string, unknown>,
      };
    } catch (err) {
      if (err instanceof ProxyBudgetExhaustedError) {
        return {
          ok: false,
          service_time_ms: performance.now() - started,
          category: 'proxy_budget',
          error: err.message,
        };
      }
      const category = classifyProviderError(err);
      return {
        ok: false,
        service_time_ms: performance.now() - started,
        category,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  };
}
