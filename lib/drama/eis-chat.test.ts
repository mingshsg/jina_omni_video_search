import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../config', () => ({
  getConfig: () => ({
    ELASTICSEARCH_URL: 'https://es.test',
    ELASTICSEARCH_API_KEY: 'test',
  }),
}));

vi.mock('./env', () => ({
  getDramaEnv: () => ({
    DRAMA_EIS_CHAT_INFERENCE_ID: 'test-chat',
    DRAMA_DIRECTORS_TIMEOUT_MS: 60_000,
  }),
}));

import { callDramaEisChat, DramaEisChatError } from './eis-chat';

function sseResponse(chunks: string[]): Response {
  const enc = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const c of chunks) controller.enqueue(enc.encode(c));
        controller.close();
      },
    }),
  );
}

describe('callDramaEisChat stream timeout (R11)', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('parses a normal SSE stream', async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse(['data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n']),
    );
    const res = await callDramaEisChat({
      messages: [{ role: 'user', content: 'hi' }],
      timeoutMs: 5_000,
    });
    expect(res.text).toBe('hi');
  });

  it('times out a stalled mid-stream body instead of hanging', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(new ReadableStream<Uint8Array>({})),
    );
    await expect(
      callDramaEisChat({
        messages: [{ role: 'user', content: 'hi' }],
        timeoutMs: 60,
      }),
    ).rejects.toMatchObject({ name: 'DramaEisChatError', code: 'timeout' });
  });

  it('maps errors to DramaEisChatError codes', async () => {
    fetchMock.mockResolvedValueOnce(sseResponse([]));
    const err = await callDramaEisChat({
      messages: [{ role: 'user', content: 'hi' }],
      timeoutMs: 5_000,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(DramaEisChatError);
    expect(err.code).toBe('empty');
  });
});
