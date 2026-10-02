import type { SearchModality } from '../es/search-core';
import type { VoiceLanguage } from './types';

/** The existing page's All value selects both vector channels. Description is text-only. */
export function voiceTargetForModality(modality: 'audio' | 'visual' | 'all' | 'description'): SearchModality | null {
  return modality === 'all' ? 'both' : modality === 'description' ? null : modality;
}

export function buildVoiceFormData(clip: Blob, input:
  | { mode: 'sound_sample'; target: SearchModality; variantId: string; size: number; videoId: string; filters: unknown }
  | { mode: 'spoken_request'; language: VoiceLanguage }): FormData {
  const form = new FormData();
  form.append('file', clip, 'voice'); form.append('mode', input.mode);
  if (input.mode === 'spoken_request') form.append('language', input.language);
  else {
    form.append('variant_id', input.variantId); form.append('target', input.target); form.append('size', String(input.size));
    if (input.videoId) form.append('video_id', input.videoId);
    if (input.filters) form.append('filters', JSON.stringify(input.filters));
  }
  return form;
}
