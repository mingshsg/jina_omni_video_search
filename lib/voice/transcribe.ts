import { VoiceError, throwIfAborted } from './errors';
import type { VoiceConfig } from './config';
import { validAsrUrl } from './config';
import type { VoiceLanguage } from './types';
import { readBoundedBody } from './request';

export function parseTranscript(value: unknown): { text: string; language: string | null } {
  if (!value || typeof value !== 'object' || !('text' in value) || typeof value.text !== 'string')
    throw new VoiceError('VOICE_PROVIDER_FAILED', 'Transcription service returned an invalid response.', 502);
  const text = value.text.trim();
  if (!text) throw new VoiceError('VOICE_NO_SPEECH', 'No speech was detected. Please record again.');
  if (text.length > 2000) throw new VoiceError('VOICE_PROVIDER_FAILED', 'Transcript exceeds the search limit.', 502);
  return { text, language: 'language' in value && typeof value.language === 'string' && /^[a-z]{2,3}(-[A-Za-z]{2,8})?$/.test(value.language) ? value.language : null };
}

export async function transcribeAudio(wav: Buffer, language: VoiceLanguage, cfg: VoiceConfig, signal: AbortSignal) {
  if (!validAsrUrl(cfg.asrUrl) || !cfg.asrModel || !cfg.languages.includes(language))
    throw new VoiceError('VOICE_UNAVAILABLE', 'This transcription configuration or language is unavailable.', 503);
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'voice.wav');
  form.append('model', cfg.asrModel); form.append('response_format', 'json');
  if (language !== 'auto') form.append('language', language);
  try {
    const response = await fetch(cfg.asrUrl, { method: 'POST', redirect: 'error', signal,
      headers: cfg.asrKey ? { Authorization: `Bearer ${cfg.asrKey}` } : {}, body: form });
    if (!response.ok) { await response.body?.cancel(); throw new Error('ASR request failed'); }
    const data = JSON.parse((await readBoundedBody(response.body, 16 * 1024, signal)).toString());
    return parseTranscript(data);
  } catch (err) {
    throwIfAborted(signal);
    if (err instanceof VoiceError) throw err;
    throw new VoiceError('VOICE_PROVIDER_FAILED', 'Transcription service could not process this recording.', 502);
  }
}
