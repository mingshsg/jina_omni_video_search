import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseTranscript, transcribeAudio } from './transcribe';
import { getVoiceConfig } from './config';
import { testWav } from './test-fixtures';
afterEach(() => vi.unstubAllGlobals());
describe('original-language voice transcription', () => {
  it('preserves original Chinese text and requires subsequent user search', () => {
    expect(parseTranscript({ text: '  找李政宰的追逐场景  ', language: 'zh' })).toEqual({ text: '找李政宰的追逐场景', language: 'zh' });
  });
  it.each([{ text: '' }, { text: '   ' }, {}, { text: 12 }, { text: 'x'.repeat(2001) }])('rejects empty, malformed and overlong speech %j', (data) => {
    expect(() => parseTranscript(data)).toThrow();
  });
  it('does not invent language or confidence', () => expect(parseTranscript({ text: 'find a car' })).toEqual({ text: 'find a car', language: null }));
  it('sends WAV and native transcription language without translation', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ text: '找汽车' })); vi.stubGlobal('fetch', fetch);
    const cfg = getVoiceConfig({ VOICE_ASR_API_URL: 'http://localhost/asr', VOICE_ASR_MODEL: 'whisper' });
    expect(await transcribeAudio(testWav(), 'zh', cfg, new AbortController().signal)).toEqual({ text: '找汽车', language: null });
    const options = fetch.mock.calls[0][1];
    expect(options.body.get('language')).toBe('zh'); expect(options.body.get('response_format')).toBe('json');
    expect(options.body.get('file').type).toBe('audio/wav'); expect(options.redirect).toBe('error');
  });
  it('sanitizes an upstream error containing credentials', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Authorization Bearer secret', { status: 500 })));
    await expect(transcribeAudio(testWav(), 'auto', getVoiceConfig({ VOICE_ASR_API_URL: 'http://localhost/asr', VOICE_ASR_MODEL: 'whisper' }), new AbortController().signal))
      .rejects.toMatchObject({ message: 'Transcription service could not process this recording.' });
  });
  it('preserves the ASR compute deadline as a sanitized timeout', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('private timeout diagnostics', { status: 504 })));
    await expect(transcribeAudio(testWav(), 'auto', getVoiceConfig({ VOICE_ASR_API_URL: 'http://localhost/asr', VOICE_ASR_MODEL: 'whisper' }), new AbortController().signal))
      .rejects.toMatchObject({ code: 'VOICE_TIMEOUT', status: 504, message: 'Transcription timed out. Please retry.' });
  });
});
