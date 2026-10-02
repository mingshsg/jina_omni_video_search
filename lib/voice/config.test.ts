import { describe, expect, it } from 'vitest';
import { getVoiceConfig, voiceCapabilities, audioStackFingerprint, asrConfigFingerprint, validAsrUrl } from './config';
import { voiceTestConfig } from './test-fixtures';
describe('voice capability isolation', () => {
  it('stays disabled by default', () => {
    expect(voiceCapabilities(voiceTestConfig(), getVoiceConfig({})).sound_sample).toMatchObject({ available: false, reason: 'disabled' });
  });
  it('requires verification for the exact audio endpoint/stack', () => {
    const cfg = voiceTestConfig(), voice = getVoiceConfig({ VOICE_SEARCH_ENABLED: 'true', VOICE_AUDIO_VERIFIED_STACK: audioStackFingerprint(cfg) });
    expect(voiceCapabilities(cfg, voice).sound_sample.available).toBe(true);
    expect(voiceCapabilities({ ...cfg, EMBED_INFERENCE_ID: 'different' }, voice).sound_sample.available).toBe(false);
    expect(voiceCapabilities({ ...cfg, EMBED_TASK_QUERY: 'text-matching' }, voice).sound_sample.available).toBe(false);
  });
  it('missing ASR does not disable verified sound search', () => {
    const cfg = voiceTestConfig();
    const caps = voiceCapabilities(cfg, getVoiceConfig({ VOICE_SEARCH_ENABLED: 'true', VOICE_AUDIO_VERIFIED_STACK: audioStackFingerprint(cfg) }));
    expect(caps.sound_sample.available).toBe(true); expect(caps.spoken_request.reason).toBe('asr_not_configured');
  });
  it('ASR verification is invalidated by model, endpoint or advertised languages', () => {
    const voice = getVoiceConfig({ VOICE_SEARCH_ENABLED: 'true', VOICE_ASR_API_URL: 'http://localhost:9999/v1/audio/transcriptions', VOICE_ASR_MODEL: 'local-whisper' });
    voice.asrVerified = asrConfigFingerprint(voice);
    expect(voiceCapabilities(voiceTestConfig(), voice).spoken_request.available).toBe(true);
    expect(voiceCapabilities(voiceTestConfig(), { ...voice, languages: ['auto'] }).spoken_request.available).toBe(false);
    expect(JSON.stringify(voiceCapabilities(voiceTestConfig(), { ...voice, asrKey: 'secret-do-not-return' }))).not.toContain('secret-do-not-return');
  });
  it.each(['http://public.example/transcribe', 'https://user:secret@example.com/asr', 'https://example.com/asr?key=secret'])('rejects unsafe configured endpoint %s', (url) => expect(validAsrUrl(url)).toBe(false));
});
