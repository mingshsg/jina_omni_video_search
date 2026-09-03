import type { AppConfig } from '../config';
import type { EmbedProvider } from '../ingest/variant';

const BUDGET_ENV: Record<EmbedProvider, keyof AppConfig> = {
  eis: 'EIS_MAX_BINARY_BYTES',
  jina: 'JINA_MAX_BINARY_BYTES',
  local: 'LOCAL_MAX_BINARY_BYTES',
};

/**
 * Per-provider decoded-media byte budget from config (FR-8 / Phase 2 probe).
 */
export function embedBudgetBytes(
  cfg: AppConfig,
  provider: EmbedProvider = cfg.EMBED_PROVIDER,
): number {
  const key = BUDGET_ENV[provider];
  const value = cfg[key] as number | undefined;
  if (value === undefined) {
    throw new Error(
      `${String(key)} is not set — run Phase 2 probe or set a budget for provider=${provider}`,
    );
  }
  return value;
}
