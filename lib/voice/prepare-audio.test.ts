import { describe, expect, it } from 'vitest';
import { prepareQueryAudio, runAudioProcess } from './prepare-audio';
import { testWav } from './test-fixtures';

const signal = () => new AbortController().signal;
describe('real ffmpeg voice preparation through pipes', () => {
  it('produces correctly framed mono16k WAV in memory', async () => {
    const prepared = await prepareQueryAudio(testWav(), signal());
    expect(prepared.durationMs).toBe(1200);
    expect(prepared.wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(prepared.wav.readUInt32LE(4)).toBe(prepared.wav.length - 8);
    expect(prepared.wav.readUInt32LE(40)).toBe(prepared.wav.length - 44);
  });
  it.each([['webm', 'libopus', []], ['ogg', 'libopus', []], ['mp4', 'aac', ['-movflags', 'frag_keyframe+empty_moov']]] as const)
    ('decodes the browser %s container with actual codec bytes', async (format, codec, flags) => {
      const bytes = await runAudioProcess('ffmpeg', ['-v', 'error', '-i', 'pipe:0', '-c:a', codec, ...flags, '-f', format, 'pipe:1'], testWav(), 128000, signal());
      const decoded = await prepareQueryAudio(bytes, signal());
      expect(decoded.durationMs).toBeGreaterThanOrEqual(1000);
      expect(decoded.durationMs).toBeLessThan(1500);
    });
  it.each([500, 15010])('rejects authoritative duration %ims rather than truncating', async (ms) => {
    await expect(prepareQueryAudio(testWav(ms), signal())).rejects.toMatchObject({ code: 'VOICE_DURATION_INVALID' });
  });
  it('rejects MIME-spoofed playlist input without accessing its URL', async () => {
    await expect(prepareQueryAudio(Buffer.from('#EXTM3U\nhttp://127.0.0.1:1/private\n'), signal())).rejects.toMatchObject({ code: 'VOICE_UNSUPPORTED_AUDIO' });
  });
  it('rejects video streams in a valid MP4 container', async () => {
    const video = await runAudioProcess('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=size=32x32:rate=1:duration=1',
      '-an', '-c:v', 'mpeg4', '-movflags', 'frag_keyframe+empty_moov', '-f', 'mp4', 'pipe:1'], Buffer.alloc(0), 128000, signal());
    await expect(prepareQueryAudio(video, signal())).rejects.toMatchObject({ status: 415 });
  });
  it('refuses already-cancelled work', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(prepareQueryAudio(testWav(), controller.signal)).rejects.toMatchObject({ code: 'VOICE_TIMEOUT' });
  });
});
