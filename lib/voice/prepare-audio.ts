import { spawn } from 'node:child_process';
import { VoiceError, throwIfAborted } from './errors';
import { VOICE_MAX_MS, VOICE_MIN_MS, VOICE_UPLOAD_MAX } from './types';

const FORMATS = 'wav,matroska,webm,mov,ogg,mp3,flac';
const PCM_MAX = 16000 * 2 * VOICE_MAX_MS / 1000;

/** Fixed commands, pipes only, bounded outputs and real process cancellation. */
export async function runAudioProcess(binary: string, args: string[], input: Buffer, maxOutput: number, signal: AbortSignal): Promise<Buffer> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['pipe', 'pipe', 'pipe'], shell: false });
    const parts: Buffer[] = [];
    let size = 0, failed: VoiceError | null = null;
    const stop = (error: VoiceError) => { failed ??= error; child.kill('SIGKILL'); };
    const abort = () => stop(new VoiceError('VOICE_TIMEOUT', 'Audio decoding was cancelled or timed out.', 504));
    const timer = setTimeout(abort, 5000);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxOutput) stop(new VoiceError('VOICE_DURATION_INVALID', 'Recording must be between 1 and 15 seconds.'));
      else parts.push(chunk);
    });
    // Drain without retaining provider/media filenames or attacker-controlled diagnostics.
    child.stderr.on('data', () => undefined);
    child.stdin.on('error', () => undefined);
    child.on('error', () => { failed = new VoiceError('VOICE_UNAVAILABLE', 'Audio decoder is unavailable.', 503); });
    child.on('close', (code) => {
      clearTimeout(timer); signal.removeEventListener('abort', abort);
      if (failed) reject(failed);
      else if (code !== 0) reject(new VoiceError('VOICE_UNSUPPORTED_AUDIO', 'Cannot decode this audio recording.', 415));
      else resolve(Buffer.concat(parts, size));
    });
    child.stdin.end(input);
  });
}

export function pcmToWav(pcm: Buffer): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF'); header.writeUInt32LE(pcm.length + 36, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22); header.writeUInt32LE(16000, 24); header.writeUInt32LE(32000, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export async function prepareQueryAudio(input: Buffer, signal: AbortSignal): Promise<{ wav: Buffer; durationMs: number }> {
  if (!input.length) throw new VoiceError('VOICE_EMPTY', 'A recording is required.');
  if (input.length > VOICE_UPLOAD_MAX) throw new VoiceError('VOICE_TOO_LARGE', 'Recording exceeds 5 MiB.', 413);
  // Probe bytes, not claimed MIME. Restrict all nested I/O to pipe protocol.
  const probe = await runAudioProcess('ffprobe', ['-v', 'error', '-protocol_whitelist', 'pipe',
    '-format_whitelist', FORMATS, '-show_streams', '-show_format', '-of', 'json', 'pipe:0'], input, 64 * 1024, signal);
  let streams: Array<{ codec_type?: string; codec_name?: string; duration?: string }>;
  try { streams = JSON.parse(probe.toString()).streams; }
  catch { throw new VoiceError('VOICE_UNSUPPORTED_AUDIO', 'Invalid audio container.', 415); }
  if (!Array.isArray(streams) || streams.length !== 1 || streams[0].codec_type !== 'audio' ||
      !['pcm_s16le', 'pcm_s24le', 'pcm_f32le', 'mp3', 'aac', 'opus', 'vorbis', 'flac'].includes(streams[0].codec_name ?? ''))
    throw new VoiceError('VOICE_UNSUPPORTED_AUDIO', 'Use a supported file with one audio stream and no video.', 415);
  const duration = Number(streams[0].duration);
  if (Number.isFinite(duration) && duration * 1000 > VOICE_MAX_MS)
    throw new VoiceError('VOICE_DURATION_INVALID', 'Recording must be between 1 and 15 seconds.');
  const pcm = await runAudioProcess('ffmpeg', ['-v', 'error', '-nostdin', '-threads', '1',
    '-protocol_whitelist', 'pipe', '-format_whitelist', FORMATS, '-i', 'pipe:0', '-map', '0:a:0',
    '-vn', '-ac', '1', '-ar', '16000', '-threads', '1', '-f', 's16le', 'pipe:1'], input, PCM_MAX, signal);
  const durationMs = pcm.length / 32;
  if (durationMs < VOICE_MIN_MS || durationMs > VOICE_MAX_MS || pcm.length % 2)
    throw new VoiceError('VOICE_DURATION_INVALID', 'Recording must be between 1 and 15 seconds.');
  return { wav: pcmToWav(pcm), durationMs };
}
