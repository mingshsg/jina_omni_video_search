import { describe, expect, it } from 'vitest';
import { buildVoiceFormData, voiceTargetForModality } from './ui-request';
import { parseVoiceRequest } from './request';
import { testWav } from './test-fixtures';

describe('shared Modality controls the voice upload contract', () => {
  it.each([['audio', 'audio'], ['visual', 'visual'], ['all', 'both']] as const)('submits %s as %s without a second target selector', async (modality, target) => {
    const selected = voiceTargetForModality(modality);
    expect(selected).toBe(target);
    if (!selected) throw new Error('Expected a sample target');
    const form = buildVoiceFormData(new Blob([new Uint8Array(testWav())]), { mode: 'sound_sample', target: selected,
      variantId: 'selected-variant', size: 10, videoId: 'selected-video', filters: { country: ['KR'] } });
    const parsed = await parseVoiceRequest(new Request('http://localhost/api/search/voice', { method: 'POST', body: form }), new AbortController().signal);
    expect(parsed).toMatchObject({ mode: 'sound_sample', target, variantId: 'selected-variant', videoId: 'selected-video', size: 10 });
    expect(form.get('filters')).toBe(JSON.stringify({ country: ['KR'] }));
  });
  it('does not map Description to an audio fallback', () => expect(voiceTargetForModality('description')).toBeNull());
  it('preserves the selected Group without requiring a video selection', async () => {
    const form = buildVoiceFormData(new Blob([new Uint8Array(testWav())]), { mode: 'sound_sample', target: 'visual',
      variantId: 'group-selected-variant', size: 10, videoId: '', filters: { group_id: ['training'] } });
    const parsed = await parseVoiceRequest(new Request('http://localhost/api/search/voice', { method: 'POST', body: form }), new AbortController().signal);
    expect(form.has('video_id')).toBe(false);
    expect(parsed).toMatchObject({ variantId: 'group-selected-variant', videoId: null, filters: { group_id: ['training'] } });
  });
  it('transcription excludes target/search fields and leaves review to ordinary text search', async () => {
    const form = buildVoiceFormData(new Blob([new Uint8Array(testWav())]), { mode: 'spoken_request', language: 'zh' });
    expect([...form.keys()].sort()).toEqual(['file', 'language', 'mode']);
    expect(await parseVoiceRequest(new Request('http://localhost/api/search/voice', { method: 'POST', body: form }), new AbortController().signal)).toMatchObject({ mode: 'spoken_request', language: 'zh' });
  });
});
