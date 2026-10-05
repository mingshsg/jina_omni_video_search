import { describe, expect, it, vi } from 'vitest';
vi.mock('../config', () => ({ getConfig: () => ({}) }));
vi.mock('./start-existing', () => ({ startExistingDrama: vi.fn(), ExistingDramaStartError: class extends Error {} }));
import { POST } from '../../app/api/library/[videoId]/drama/route';
import { GET } from '../../app/api/drama-media/[videoId]/[runId]/[...rest]/route';
import { contentTypeForPath } from '../media/serve-file';

describe('enrichment request validation', () => {
  it('returns 400 for malformed JSON and escaped video IDs', async () => {
    const body = () => new Request('http://localhost/drama', { method: 'POST', body: '{broken' });
    expect((await POST(body(), { params: { videoId: 'v1' } })).status).toBe(400);
    expect((await POST(body(), { params: { videoId: '%ZZ' } })).status).toBe(400);
  });
  it.each([
    { videoId: '%ZZ', runId: 'run1', rest: ['scripts', 'en.md'] },
    { videoId: 'v1', runId: '%ZZ', rest: ['scripts', 'en.md'] },
    { videoId: 'v1', runId: 'run1', rest: ['scripts', '%ZZ'] },
  ])('returns 400 for malformed artifact route encodings %j', async (params) => {
    expect((await GET(new Request('http://localhost/media'), { params })).status).toBe(400);
  });
  it('serves director scripts as readable UTF-8 text', () => {
    expect(contentTypeForPath('directors_script_zh.md')).toBe('text/plain; charset=utf-8');
    expect(contentTypeForPath('video.mp4')).toBe('video/mp4');
  });
});
