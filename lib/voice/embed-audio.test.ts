import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const transport = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../es/client', () => ({ getEsClient: () => ({ transport }) }));
import { embedQueryAudio, checkedAudioVector } from './embed-audio';
import { resetEmbedConcurrencyGate } from '../embed/concurrency';
import { voiceTestConfig, testWav } from './test-fixtures';
beforeEach(() => { resetEmbedConcurrencyGate(); vi.resetAllMocks(); });
afterEach(() => vi.unstubAllGlobals());
describe('cancellable query audio transport', () => {
  it.each([[0, 0], [Number.NaN, 0], [1], ['1', 0], [2, 0]])('rejects unsafe vector %j', (vector) => expect(() => checkedAudioVector(vector, 2, false)).toThrow());
  it('normalizes only when the local stack owns normalization', () => expect(checkedAudioVector([2, 0], 2, true)).toEqual([1, 0]));
  it('sends exact EIS binary audio shape with abort, no retries and bounded response', async () => {
    const cfg = { ...voiceTestConfig(), EMBED_DIMS: 2 };
    transport.request.mockResolvedValue({ embeddings: [{ embedding: [1, 0] }] });
    const signal = new AbortController().signal;
    expect((await embedQueryAudio(testWav(), cfg, signal)).vector).toEqual([1, 0]);
    const [body, options] = transport.request.mock.calls[0];
    expect(body.body.input[0].content[0]).toMatchObject({ type: 'audio', format: 'base64' });
    expect(body.body.input[0].content[0].value).toMatch(/^data:audio\/wav;base64,/);
    expect(options).toMatchObject({ signal, maxRetries: 0, maxResponseSize: 131072 });
  });
  it('provider byte budgets apply before any inference call', async () => {
    await expect(embedQueryAudio(testWav(), { ...voiceTestConfig(), EIS_MAX_BINARY_BYTES: 10 }, new AbortController().signal)).rejects.toMatchObject({ status: 413 });
    expect(transport.request).not.toHaveBeenCalled();
  });
  it('aborts underlying provider transport and releases embedding slots', async () => {
    transport.request.mockImplementation((_body, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('cancelled')))));
    const controller = new AbortController();
    const running = embedQueryAudio(testWav(), voiceTestConfig(), controller.signal);
    await Promise.resolve(); controller.abort();
    await expect(running).rejects.toMatchObject({ code: 'VOICE_TIMEOUT' });
    transport.request.mockResolvedValue({ embeddings: [{ embedding: [1, ...new Array(1023).fill(0)] }] });
    await expect(embedQueryAudio(testWav(), voiceTestConfig(), new AbortController().signal)).resolves.toHaveProperty('vector');
  });
  it('sanitizes raw provider exceptions', async () => {
    transport.request.mockRejectedValue(new Error('ApiKey supersecret'));
    await expect(embedQueryAudio(testWav(), voiceTestConfig(), new AbortController().signal)).rejects.toMatchObject({ message: 'Embedding provider could not process this recording.' });
  });
});
