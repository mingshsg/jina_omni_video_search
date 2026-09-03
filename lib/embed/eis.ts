import { errors } from '@elastic/elasticsearch';
import type { AppConfig } from '../config';
import { getEsClient } from '../es/client';
import { getEmbedConcurrencyGate } from './concurrency';
import { extractEmbeddingVector, extractTokenUsage } from './extract';
import { ensureNormalized } from './normalize';
import { isRetryableEmbedError, withRetry } from './retry';
import type {
  EmbedResult,
  EmbedRole,
  EmbeddingProvider,
  ProviderIdentity,
  TokenUsage,
} from './types';

function bufferToDataUrl(data: Buffer | string, mime: string): string {
  if (typeof data === 'string') {
    if (data.startsWith('data:')) return data;
    return `data:${mime};base64,${data}`;
  }
  return `data:${mime};base64,${data.toString('base64')}`;
}

function buildBinaryBody(
  modality: 'video' | 'audio',
  dataUrl: string,
): Record<string, unknown> {
  return {
    input: [
      {
        content: [
          {
            type: modality,
            format: 'base64',
            value: dataUrl,
          },
        ],
      },
    ],
  };
}

function buildTextBody(text: string, role: EmbedRole): Record<string, unknown> {
  // OQ3: omni embedding honors input_type=ingest for passage; input_type=query
  // is rejected (no InputType.QUERY). Query-side vectors use the default path or
  // query_vector_builder at search time.
  if (role === 'passage') {
    return { input: [text], input_type: 'ingest' };
  }
  return { input: [text] };
}

function taskForRole(cfg: AppConfig, role: EmbedRole): string {
  return role === 'query' ? cfg.EMBED_TASK_QUERY : cfg.EMBED_TASK_PASSAGE;
}

export function eisProviderIdentity(cfg: AppConfig): ProviderIdentity {
  return {
    provider: 'eis',
    model: cfg.EMBED_MODEL,
    task: cfg.EMBED_TASK_PASSAGE,
    dims: cfg.EMBED_DIMS,
    normalizedBy: 'provider',
  };
}

export function createEisEmbeddingProvider(cfg: AppConfig): EmbeddingProvider {
  const identity = eisProviderIdentity(cfg);
  const client = getEsClient();
  const gate = getEmbedConcurrencyGate(cfg);
  const inferenceId = cfg.EMBED_INFERENCE_ID;

  async function infer(
    body: Record<string, unknown>,
    role: EmbedRole,
  ): Promise<EmbedResult> {
    const start = performance.now();
    const data = await gate.run(() =>
      withRetry(
        async () => {
          try {
            return await client.transport.request({
              method: 'POST',
              path: `/_inference/embedding/${encodeURIComponent(inferenceId)}`,
              body,
            });
          } catch (e) {
            if (e instanceof errors.ResponseError) {
              const msg =
                typeof e.body === 'object' && e.body && 'error' in e.body
                  ? JSON.stringify((e.body as { error: unknown }).error)
                  : e.message;
              const err = new Error(`EIS inference failed (${e.statusCode}): ${msg}`);
              (err as Error & { statusCode: number }).statusCode =
                e.statusCode ?? 0;
              throw err;
            }
            throw e;
          }
        },
        isRetryableEmbedError,
      ),
    );

    const raw = extractEmbeddingVector(data);
    if (!raw?.length) {
      throw new Error('EIS inference returned no embedding vector');
    }
    if (raw.length !== identity.dims) {
      throw new Error(
        `EIS returned ${raw.length} dims, expected ${identity.dims}`,
      );
    }

    const embedding = ensureNormalized(raw, identity.normalizedBy);
    const tokens: TokenUsage = extractTokenUsage(data);

    return {
      embedding,
      tokens,
      latencyMs: performance.now() - start,
    };
  }

  return {
    ...identity,
    task: identity.task,

    async embedText(text: string, role: EmbedRole): Promise<EmbedResult> {
      const result = await infer(buildTextBody(text, role), role);
      return { ...result, /* task pinned on identity for passage ingest */ };
    },

    async embedVideo(
      data: Buffer | string,
      role: EmbedRole = 'passage',
    ): Promise<EmbedResult> {
      const dataUrl = bufferToDataUrl(data, 'video/mp4');
      return infer(buildBinaryBody('video', dataUrl), role);
    },

    async embedAudio(
      data: Buffer | string,
      role: EmbedRole = 'passage',
    ): Promise<EmbedResult> {
      const dataUrl = bufferToDataUrl(data, 'audio/wav');
      return infer(buildBinaryBody('audio', dataUrl), role);
    },
  };
}

/** Resolve the task string for a given role (used when recording variant metadata). */
export function eisTaskForRole(cfg: AppConfig, role: EmbedRole): string {
  return taskForRole(cfg, role);
}
