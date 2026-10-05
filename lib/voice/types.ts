import type { SearchHit, SearchModality } from '../es/search-core';

export const VOICE_UPLOAD_MAX = 5 * 1024 * 1024;
export const VOICE_BODY_MAX = 6 * 1024 * 1024;
export const VOICE_MIN_MS = 1000;
export const VOICE_MAX_MS = 15000;
export const VOICE_DEADLINE_MS = 30000;
export type VoiceMode = 'sound_sample' | 'spoken_request';
export type VoiceLanguage = 'auto' | 'en' | 'zh' | 'ko' | 'th';
export type VoiceMoments = {
  kind: 'moments'; hits: SearchHit[];
  meta: {
    mode: 'sound_sample'; query_modality: 'audio'; modality: SearchModality;
    sort_by: 'audio' | 'visual' | 'rrf'; variant_id: string;
    query_duration_ms: number; query_mime: 'audio/wav'; took_ms: number;
    size: number; rank_window_size: number; badge_strategy: string;
    filter: { eligible_assets: number; filters_applied: boolean };
    audio_channel_status: 'ok' | 'no_indexed_audio';
  };
};
export type VoiceTranscript = {
  kind: 'transcript'; transcript: string;
  meta: { mode: 'spoken_request'; language: string | null; query_duration_ms: number; took_ms: number };
};
export type VoiceResponse = VoiceMoments | VoiceTranscript;
export type VoiceCapabilities = {
  enabled: boolean;
  sound_sample: { available: boolean; reason: string | null; destination: string; targets: SearchModality[] };
  spoken_request: { available: boolean; reason: string | null; destination: string; languages: VoiceLanguage[] };
  limits: { min_ms: number; max_ms: number; upload_bytes: number };
};
