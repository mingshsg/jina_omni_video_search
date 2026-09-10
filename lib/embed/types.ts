import type { EmbedProvider, NormalizedBy } from '../ingest/variant';

export type EmbedModality = 'text' | 'video' | 'audio' | 'image';
export type EmbedRole = 'passage' | 'query';

export interface TokenUsage {
  image_tokens?: number;
  video_tokens?: number;
  audio_tokens?: number;
  total_tokens?: number;
}

export interface EmbedResult {
  embedding: number[];
  tokens: TokenUsage;
  latencyMs: number;
}

/** Pinned provider stack recorded on every variant (FR-9). */
export interface ProviderIdentity {
  provider: EmbedProvider;
  model: string;
  task: string;
  dims: number;
  normalizedBy: NormalizedBy;
}

/** Minimal variant fields checked by the isolation policy. */
export interface RecordedVariantStack {
  provider: EmbedProvider;
  model: string;
  task: string;
  dims: number;
  normalizedBy?: NormalizedBy;
}

export interface EmbeddingProvider extends ProviderIdentity {
  embedText(text: string, role: EmbedRole): Promise<EmbedResult>;
  embedVideo(data: Buffer | string, role?: EmbedRole): Promise<EmbedResult>;
  embedAudio(data: Buffer | string, role?: EmbedRole): Promise<EmbedResult>;
  /** Image query / passage in the shared multimodal space. */
  embedImage(data: Buffer | string, role?: EmbedRole): Promise<EmbedResult>;
}
