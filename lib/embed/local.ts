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

function bufferToDataUrl(data: Buffer | string, mime: string): string {
  if (typeof data === 'string') {
    if (data.startsWith('data:')) return data;
    return `data:${mime};base64,${data}`;
  }
  return `data:${mime};base64,${data.toString('base64')}`;
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

function taskForRole(cfg: AppConfig, role: EmbedRole): string {
  return role === 'query' ? cfg.EMBED_TASK_QUERY : cfg.EMBED_TASK_PASSAGE;
}

export function localProviderIdentity(cfg: AppConfig): ProviderIdentity {
  return {
    provider: 'local',
    model: cfg.EMBED_MODEL,
    task: cfg.EMBED_TASK_PASSAGE,
    dims: cfg.EMBED_DIMS,
    normalizedBy: 'application',
  };
}

/** True when LOCAL_EMBED_URL is set. */
export function isLocalConfigured(cfg: AppConfig): boolean {
  return cfg.LOCAL_EMBED_URL.trim().length > 0;
}

export function createLocalEmbeddingProvider(cfg: AppConfig): EmbeddingProvider {
  if (!isLocalConfigured(cfg)) {
    throw new Error(
      'LOCAL_EMBED_URL is required for the local embedding provider',
    );
  }

  const identity = localProviderIdentity(cfg);
  const gate = getEmbedConcurrencyGate(cfg);
  const baseUrl = normalizeBaseUrl(cfg.LOCAL_EMBED_URL);
  const endpoint = `${baseUrl}/v1/embeddings`;

  async function post(body: Record<string, unknown>): Promise<unknown> {
    return gate.run(() =>
      withRetry(
        async () => {
          const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          const text = await res.text();
          if (!res.ok) {
            throw new HttpEmbedError(
              res.status,
              `Local embeddings failed (${res.status}): ${text.slice(0, 400)}`,
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
      input,
    });

    const raw = extractEmbeddingVector(data);
    if (!raw?.length) {
      throw new Error('Local embeddings returned no vector');
    }
    if (raw.length !== identity.dims) {
      throw new Error(
        `Local server returned ${raw.length} dims, expected ${identity.dims}`,
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
      // OpenAI-compatible omni servers accept typed modality objects.
      return embedInput([{ video: dataUrl }], role);
    },

    embedAudio(
      data: Buffer | string,
      role: EmbedRole = 'passage',
    ): Promise<EmbedResult> {
      const dataUrl = bufferToDataUrl(data, 'audio/wav');
      return embedInput([{ audio: dataUrl }], role);
    },

    embedImage(
      data: Buffer | string,
      role: EmbedRole = 'query',
    ): Promise<EmbedResult> {
      const dataUrl = bufferToDataUrl(data, 'image/jpeg');
      return embedInput([{ image: dataUrl }], role);
    },
  };
}
