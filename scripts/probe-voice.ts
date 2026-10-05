/** Read-only capability probe; prints verification stamps, never changes .env or indices. */
import fs from 'node:fs';
import { loadDotenv } from './load-dotenv';
import { getConfig } from '../lib/config';
import { audioStackFingerprint, asrConfigFingerprint, getVoiceConfig } from '../lib/voice/config';
import { pcmToWav, prepareQueryAudio } from '../lib/voice/prepare-audio';
import { embedQueryAudio } from '../lib/voice/embed-audio';
import { transcribeAudio } from '../lib/voice/transcribe';
import { voiceDeadline } from '../lib/voice/runtime';
import { VoiceError } from '../lib/voice/errors';
import type { VoiceLanguage } from '../lib/voice/types';

loadDotenv();
async function main() {
  const args = process.argv.slice(2);
  const deadline = voiceDeadline(new AbortController().signal);
  try {
    if (args.includes('--audio')) {
      const cfg = getConfig();
      const pcm = Buffer.alloc(38400);
      for (let i = 0; i < pcm.length / 2; i++) pcm.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 440 / 16000) * 1000), i * 2);
      const audio = await prepareQueryAudio(pcmToWav(pcm), deadline.signal);
      const embedded = await embedQueryAudio(audio.wav, cfg, deadline.signal);
      console.log(JSON.stringify({ gate: 'audio_query_transport', status: 'PASS', provider: cfg.EMBED_PROVIDER,
        dimensions: embedded.vector.length, duration_ms: audio.durationMs, usage: embedded.usage,
        setting: `VOICE_AUDIO_VERIFIED_STACK=${audioStackFingerprint(cfg)}`,
        relevance: 'NOT RUN', visual_and_both_relevance: 'NOT RUN' }, null, 2));
    } else if (args.includes('--asr')) {
      // A fixture for each advertised language is required; auto uses an explicitly supplied fixture too.
      const voice = getVoiceConfig();
      for (const language of voice.languages) {
        const file = args.find((arg) => arg.startsWith(`--${language}=`))?.slice(language.length + 3);
        if (!file) throw new VoiceError('VOICE_INVALID_REQUEST', `Provide --${language}=<audio-file> for every advertised language.`);
        const size = fs.statSync(file).size;
        if (size > 5 * 1024 * 1024) throw new VoiceError('VOICE_TOO_LARGE', 'Fixture is too large.', 413);
        const audio = await prepareQueryAudio(fs.readFileSync(file), deadline.signal);
        const transcript = await transcribeAudio(audio.wav, language as VoiceLanguage, voice, deadline.signal);
        console.log(JSON.stringify({ gate: 'asr_transport', status: 'PASS', language, transcript_chars: transcript.text.length, human_quality: 'NOT RUN' }));
      }
      if (!voice.languages.length) throw new VoiceError('VOICE_UNAVAILABLE', 'No ASR languages configured.', 503);
      console.log(`VOICE_ASR_VERIFIED_CONFIG=${asrConfigFingerprint(voice)}`);
    } else throw new VoiceError('VOICE_INVALID_REQUEST', 'Use --audio or --asr --auto=<file> --en=<file> --zh=<file>.');
  } catch (error) {
    console.error(JSON.stringify({ status: 'FAIL', code: error instanceof VoiceError ? error.code : 'VOICE_PROBE_FAILED', message: error instanceof VoiceError ? error.message : 'Voice probe failed. Check configuration and provider availability.' }));
    process.exitCode = 1;
  } finally { deadline.dispose(); }
}
void main();
