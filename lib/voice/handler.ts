import { getConfig } from '../config';
import { SearchFilterError } from '../metadata/search-filters';
import { getVoiceConfig, voiceCapabilities } from './config';
import { parseVoiceRequest } from './request';
import { prepareQueryAudio } from './prepare-audio';
import { searchAudioMoments } from './search-audio';
import { transcribeAudio } from './transcribe';
import { VoiceError, throwIfAborted } from './errors';
import { voiceDeadline, voiceGate } from './runtime';

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...(status === 429 ? { 'Retry-After': '2' } : {}) } });
export async function voicePost(request: Request): Promise<Response> {
  const deadline = voiceDeadline(request.signal);
  const start = performance.now();
  try {
    return await voiceGate.run(async () => {
      const cfg = getConfig(), voice = getVoiceConfig();
      if (!voice.enabled) throw new VoiceError('VOICE_UNAVAILABLE', 'Voice search is disabled for this deployment.', 503);
      const input = await parseVoiceRequest(request, deadline.signal);
      const capabilities = voiceCapabilities(cfg, voice);
      if (!capabilities[input.mode].available || (input.mode === 'sound_sample' && !voice.targets.includes(input.target)))
        throw new VoiceError('VOICE_UNAVAILABLE', 'This voice mode or target has not been verified for this deployment.', 503);
      const { wav, durationMs } = await prepareQueryAudio(input.audio, deadline.signal);
      if (input.mode === 'sound_sample') {
        const result = await searchAudioMoments(input, wav, durationMs, cfg, deadline.signal);
        result.meta.took_ms = Math.round(performance.now() - start);
        return json(result);
      }
      const transcript = await transcribeAudio(wav, input.language, voice, deadline.signal);
      return json({ kind: 'transcript', transcript: transcript.text,
        meta: { mode: 'spoken_request', language: transcript.language, query_duration_ms: durationMs, took_ms: Math.round(performance.now() - start) } });
    });
  } catch (err) {
    try { throwIfAborted(deadline.signal); } catch (cancelled) { err = cancelled; }
    if (err instanceof VoiceError || err instanceof SearchFilterError) return json({ error: { code: err.code, message: err.message } }, err.status);
    return json({ error: { code: 'VOICE_PROVIDER_FAILED', message: 'Voice processing failed. Please retry.' } }, 502);
  } finally { deadline.dispose(); }
}

export function voiceCapabilitiesGet(): Response {
  try { return json(voiceCapabilities(getConfig())); }
  catch { return json({ error: { code: 'VOICE_UNAVAILABLE', message: 'Voice search is not configured.' } }, 503); }
}
