import { createHash } from 'node:crypto';
import type { AppConfig } from '../config';
import type { VoiceCapabilities, VoiceLanguage } from './types';
import { VOICE_MAX_MS, VOICE_MIN_MS, VOICE_UPLOAD_MAX } from './types';
import type { SearchModality } from '../es/search-core';

export function getVoiceConfig(env: Record<string, string | undefined> = process.env) {
  return {
    enabled: env.VOICE_SEARCH_ENABLED === 'true',
    audioVerified: env.VOICE_AUDIO_VERIFIED_STACK ?? '',
    targets: (env.VOICE_AUDIO_TARGETS ?? 'audio').split(',').filter((s): s is SearchModality => ['audio', 'visual', 'both'].includes(s)),
    asrUrl: env.VOICE_ASR_API_URL?.trim() ?? '',
    asrModel: env.VOICE_ASR_MODEL?.trim() ?? '',
    asrKey: env.VOICE_ASR_API_KEY?.trim() ?? '',
    asrVerified: env.VOICE_ASR_VERIFIED_CONFIG ?? '',
    languages: (env.VOICE_ASR_LANGUAGES ?? 'auto,en,zh').split(',').filter((s): s is VoiceLanguage => ['auto', 'en', 'zh', 'ko', 'th'].includes(s)),
  };
}
export type VoiceConfig = ReturnType<typeof getVoiceConfig>;
const fingerprint = (data: unknown) => createHash('sha256').update(JSON.stringify(data)).digest('hex');

/** Includes endpoint and query/passage pairing; never exposes credentials. */
export function audioStackFingerprint(cfg: AppConfig): string {
  return fingerprint([1, cfg.EMBED_PROVIDER, cfg.EMBED_MODEL, cfg.EMBED_DIMS,
    cfg.EMBED_TASK_PASSAGE, cfg.EMBED_TASK_QUERY,
    cfg.EMBED_PROVIDER === 'local' ? 'application' : 'provider',
    cfg.EMBED_PROVIDER === 'eis' ? [cfg.ELASTICSEARCH_URL, cfg.EMBED_INFERENCE_ID]
      : cfg.EMBED_PROVIDER === 'local' ? cfg.LOCAL_EMBED_URL : 'https://api.jina.ai/v1/embeddings']);
}
export function asrConfigFingerprint(cfg: VoiceConfig): string {
  return fingerprint([1, cfg.asrUrl, cfg.asrModel, cfg.languages]);
}
export function validAsrUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return !u.username && !u.password && !u.hash && !u.search &&
      (u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]', 'host.docker.internal'].includes(u.hostname)));
  } catch { return false; }
}
export function voiceCapabilities(cfg: AppConfig, voice = getVoiceConfig()): VoiceCapabilities {
  const providerConfigured = cfg.EMBED_PROVIDER === 'eis' ? Boolean(cfg.EMBED_INFERENCE_ID)
    : cfg.EMBED_PROVIDER === 'jina' ? Boolean(cfg.JINA_API_KEY) : Boolean(cfg.LOCAL_EMBED_URL);
  const soundReason = !voice.enabled ? 'disabled' : !providerConfigured ? 'provider_not_configured'
    : voice.audioVerified !== audioStackFingerprint(cfg) ? 'provider_not_verified' : !voice.targets.length ? 'no_verified_targets' : null;
  const spokenReason = !voice.enabled ? 'disabled' : !voice.asrModel || !validAsrUrl(voice.asrUrl) ? 'asr_not_configured'
    : voice.asrVerified !== asrConfigFingerprint(voice) || !voice.languages.length ? 'asr_not_verified' : null;
  return {
    enabled: voice.enabled,
    sound_sample: { available: soundReason === null, reason: soundReason, destination: cfg.EMBED_PROVIDER === 'eis' ? 'Elastic Inference Service' : cfg.EMBED_PROVIDER === 'jina' ? 'Jina API' : 'Configured local embedding service', targets: voice.targets },
    spoken_request: { available: spokenReason === null, reason: spokenReason, destination: 'Configured transcription service', languages: voice.languages },
    limits: { min_ms: VOICE_MIN_MS, max_ms: VOICE_MAX_MS, upload_bytes: VOICE_UPLOAD_MAX },
  };
}
