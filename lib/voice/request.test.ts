import { describe, expect, it } from 'vitest';
import { parseVoiceRequest, readBoundedBody } from './request';
import { VOICE_BODY_MAX, VOICE_UPLOAD_MAX } from './types';

function request(fields: Record<string, string> = {}, blob = new Blob(['audio'])) {
  const form = new FormData(); form.append('file', blob, 'recording');
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return new Request('http://localhost/api/search/voice', { method: 'POST', body: form });
}
const signal = () => new AbortController().signal;
describe('voice multipart contract', () => {
  it('omitted mode always defaults to sound sample, including speech-like content', async () => {
    const parsed = await parseVoiceRequest(request({ variant_id: 'variant' }), signal());
    expect(parsed).toMatchObject({ mode: 'sound_sample', variantId: 'variant', target: 'audio', size: 20 });
  });
  it('omitted mode without variant is not implicit transcription', async () => {
    await expect(parseVoiceRequest(request(), signal())).rejects.toMatchObject({ code: 'VOICE_INVALID_REQUEST' });
  });
  it('spoken request accepts only recording and language', async () => {
    expect(await parseVoiceRequest(request({ mode: 'spoken_request', language: 'zh' }), signal())).toMatchObject({ mode: 'spoken_request', language: 'zh' });
  });
  it.each([{ mode: '' }, { mode: 'auto' }, { mode: 'spoken_request', variant_id: 'variant' },
    { variant_id: 'variant', language: 'zh' }, { variant_id: 'variant', target: 'hybrid' },
    { variant_id: 'variant', size: '1.2' }, { variant_id: 'variant', size: '101' },
    { variant_id: 'variant', filters: '{' }, { variant_id: 'variant', url: 'https://example.invalid' },
    { mode: 'spoken_request', language: 'unsupported' }])('rejects invalid or contradictory controls %j', async (fields) => {
    await expect(parseVoiceRequest(request(fields), signal())).rejects.toMatchObject({ status: 400 });
  });
  it('rejects duplicate fields and multiple files', async () => {
    const form = new FormData(); form.append('file', new Blob(['x'])); form.append('file', new Blob(['y']));
    await expect(parseVoiceRequest(new Request('http://localhost', { method: 'POST', body: form }), signal())).rejects.toMatchObject({ code: 'VOICE_INVALID_REQUEST' });
  });
  it('rejects file-byte overflow before decoding', async () => {
    await expect(parseVoiceRequest(request({ variant_id: 'v' }, new Blob([new Uint8Array(VOICE_UPLOAD_MAX + 1)])), signal())).rejects.toMatchObject({ status: 413 });
  });
  it('rejects multipart overflow even without Content-Length and cancels its stream', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(VOICE_BODY_MAX)); c.enqueue(new Uint8Array(1)); }, cancel() { cancelled = true; } });
    await expect(readBoundedBody(stream, VOICE_BODY_MAX, signal())).rejects.toMatchObject({ status: 413 });
    expect(cancelled).toBe(true);
  });
  it('interrupts an upload stream that never produces data', async () => {
    const controller = new AbortController();
    const reading = readBoundedBody(new ReadableStream(), 10, controller.signal);
    controller.abort();
    await expect(reading).rejects.toMatchObject({ code: 'VOICE_TIMEOUT' });
  });
});
