import type { AppConfig } from '../config';
import { getEmbedConcurrencyGate } from './concurrency';
import { extractEmbeddingVector, extractTokenUsage } from './extract';
import { ensureNormalized } from './normalize';
import {
  HttpEmbedError,
  isRetryableEmbedError,
  withRetry,
} from './retry';
import type {
  EmbedResult,
  EmbedRole,
  EmbeddingProvider,
  ProviderIdentity,
} from './types';

const JINA_EMBED_URL = 'https://api.jina.ai/v1/embeddings';

function bufferToDataUrl(data: Buffer | string, mime: string): string {
  if (typeof data === 'string') {
    if (data.startsWith('data:')) return data;
    return `data:${mime};base64,${data}`;
  }
  return `data:${mime};base64,${data.toString('base64')}`;
}

function taskForRole(cfg: AppConfig, role: EmbedRole): string {
  return role === 'query' ? cfg.EMBED_TASK_QUERY : cfg.EMBED_TASK_PASSAGE;
}

export function jinaProviderIdentity(cfg: AppConfig): ProviderIdentity {
  return {
    provider: 'jina',
    model: cfg.EMBED_MODEL,
    task: cfg.EMBED_TASK_PASSAGE,
    dims: cfg.EMBED_DIMS,
    normalizedBy: 'provider',
  };
}

/** True when JINA_API_KEY is set (optional probe / compatibility runs). */
export function isJinaConfigured(cfg: AppConfig): boolean {
  return cfg.JINA_API_KEY.trim().length > 0;
}

export function createJinaEmbeddingProvider(cfg: AppConfig): EmbeddingProvider {
  if (!isJinaConfigured(cfg)) {
    throw new Error(
      'JINA_API_KEY is required for the jina embedding provider',
    );
  }

  const identity = jinaProviderIdentity(cfg);
  const gate = getEmbedConcurrencyGate(cfg);
  const apiKey = cfg.JINA_API_KEY;

  async function post(body: Record<string, unknown>): Promise<unknown> {
    return gate.run(() =>
      withRetry(
        async () => {
          const res = await fetch(JINA_EMBED_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify(body),
          });
          const text = await res.text();
          if (!res.ok) {
            throw new HttpEmbedError(
              res.status,
              `Jina embeddings failed (${res.status}): ${text.slice(0, 400)}`,
            );
          }
          return JSON.parse(text) as unknown;
        },
        isRetryableEmbedError,
      ),
    );
  }

  async function embedInput(
    input: unknown[],
    role: EmbedRole,
  ): Promise<EmbedResult> {
    const start = performance.now();
    const task = taskForRole(cfg, role);
    const data = await post({
      model: identity.model,
      task,
      normalized: true,
      embedding_type: 'float',
      input,
    });

    const raw = extractEmbeddingVector(data);
    if (!raw?.length) {
      throw new Error('Jina embeddings returned no vector');
    }
    if (raw.length !== identity.dims) {
      throw new Error(
        `Jina returned ${raw.length} dims, expected ${identity.dims}`,
      );
    }

    return {
      embedding: ensureNormalized(raw, identity.normalizedBy),
      tokens: extractTokenUsage(data),
      latencyMs: performance.now() - start,
    };
  }

  return {
    ...identity,

    embedText(text: string, role: EmbedRole): Promise<EmbedResult> {
      return embedInput([text], role);
    },

    embedVideo(
      data: Buffer | string,
      role: EmbedRole = 'passage',
    ): Promise<EmbedResult> {
      const dataUrl = bufferToDataUrl(data, 'video/mp4');
      return embedInput([{ video: dataUrl }], role);
    },

    embedAudio(
      data: Buffer | string,
      role: EmbedRole = 'passage',
    ): Promise<EmbedResult> {
      const dataUrl = bufferToDataUrl(data, 'audio/wav');
      return embedInput([{ audio: dataUrl }], role);
    },
  };
}
