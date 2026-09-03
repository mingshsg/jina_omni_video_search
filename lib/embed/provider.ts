import type { AppConfig } from '../config';
import { getConfig } from '../config';
import type { VariantConfig } from '../ingest/variant';
import { createEisEmbeddingProvider } from './eis';
import { createJinaEmbeddingProvider } from './jina';
import { createLocalEmbeddingProvider } from './local';
import type {
  EmbeddingProvider,
  ProviderIdentity,
  RecordedVariantStack,
} from './types';

export type { EmbedModality, EmbedResult, EmbedRole, EmbeddingProvider, ProviderIdentity, RecordedVariantStack, TokenUsage } from './types';
export { cosineSimilarity, ensureNormalized, l2Normalize } from './normalize';
export { ConcurrencyGate, getEmbedConcurrencyGate, resetEmbedConcurrencyGate } from './concurrency';
export { withRetry, isRetryableHttpStatus, HttpEmbedError } from './retry';
export { createEisEmbeddingProvider, eisProviderIdentity } from './eis';
export { createJinaEmbeddingProvider, isJinaConfigured, jinaProviderIdentity } from './jina';
export { createLocalEmbeddingProvider, isLocalConfigured, localProviderIdentity } from './local';

/** Thrown when an existing variant's embedding stack differs from current config (FR-9). */
export class VariantIsolationError extends Error {
  readonly recorded: RecordedVariantStack;
  readonly current: ProviderIdentity;

  constructor(recorded: RecordedVariantStack, current: ProviderIdentity, detail: string) {
    super(
      `Variant embedding stack mismatch — refusing to write/embed: ${detail}. ` +
        `Recorded: provider=${recorded.provider} model=${recorded.model} task=${recorded.task} dims=${recorded.dims}. ` +
        `Current: provider=${current.provider} model=${current.model} task=${current.task} dims=${current.dims}. ` +
        `Cross-provider mixing inside one variant is prohibited.`,
    );
    this.name = 'VariantIsolationError';
    this.recorded = recorded;
    this.current = current;
  }
}

/**
 * Assert the recorded variant stack matches the active provider (FR-9 isolation).
 * Call before embedding or upserting chunks for an existing variant.
 */
export function assertVariantEmbeddingStack(
  recorded: RecordedVariantStack,
  current: ProviderIdentity,
): void {
  const mismatches: string[] = [];
  if (recorded.provider !== current.provider) {
    mismatches.push(`provider ${recorded.provider} → ${current.provider}`);
  }
  if (recorded.model !== current.model) {
    mismatches.push(`model ${recorded.model} → ${current.model}`);
  }
  if (recorded.task !== current.task) {
    mismatches.push(`task ${recorded.task} → ${current.task}`);
  }
  if (recorded.dims !== current.dims) {
    mismatches.push(`dims ${recorded.dims} → ${current.dims}`);
  }
  if (
    recorded.normalizedBy !== undefined &&
    recorded.normalizedBy !== current.normalizedBy
  ) {
    mismatches.push(
      `normalized_by ${recorded.normalizedBy} → ${current.normalizedBy}`,
    );
  }
  if (mismatches.length > 0) {
    throw new VariantIsolationError(recorded, current, mismatches.join('; '));
  }
}

/** Convenience: compare a full VariantConfig against the live provider. */
export function assertVariantConfigCompatible(
  variant: VariantConfig,
  provider: EmbeddingProvider,
): void {
  assertVariantEmbeddingStack(
    {
      provider: variant.provider,
      model: variant.model,
      task: variant.task,
      dims: variant.dims,
      normalizedBy: variant.normalizedBy,
    },
    provider,
  );
}

/** Factory — selects implementation from EMBED_PROVIDER (FR-9). */
export function createEmbeddingProvider(cfg?: AppConfig): EmbeddingProvider {
  const config = cfg ?? getConfig();
  switch (config.EMBED_PROVIDER) {
    case 'eis':
      return createEisEmbeddingProvider(config);
    case 'jina':
      return createJinaEmbeddingProvider(config);
    case 'local':
      return createLocalEmbeddingProvider(config);
    default: {
      const _exhaustive: never = config.EMBED_PROVIDER;
      throw new Error(`Unknown EMBED_PROVIDER: ${_exhaustive}`);
    }
  }
}

/** Identity metadata for the configured provider without performing inference. */
export function providerIdentityFromConfig(cfg?: AppConfig): ProviderIdentity {
  const config = cfg ?? getConfig();
  switch (config.EMBED_PROVIDER) {
    case 'eis':
      return createEisEmbeddingProvider(config);
    case 'jina':
      return createJinaEmbeddingProvider(config);
    case 'local':
      return createLocalEmbeddingProvider(config);
    default: {
      const _exhaustive: never = config.EMBED_PROVIDER;
      throw new Error(`Unknown EMBED_PROVIDER: ${_exhaustive}`);
    }
  }
}
