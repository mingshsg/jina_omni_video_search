import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocked = vi.hoisted(() => ({ prepare: vi.fn(), search: vi.fn(), transcribe: vi.fn() }));
vi.mock('./prepare-audio', () => ({ prepareQueryAudio: mocked.prepare }));
vi.mock('./search-audio', () => ({ searchAudioMoments: mocked.search }));
vi.mock('./transcribe', () => ({ transcribeAudio: mocked.transcribe }));
import { voicePost, voiceCapabilitiesGet } from './handler';
import { resetConfig } from '../config';
import { audioStackFingerprint, asrConfigFingerprint, getVoiceConfig } from './config';
import { voiceTestConfig } from './test-fixtures';

beforeEach(() => {
  resetConfig(); vi.resetAllMocks();
  vi.stubEnv('ELASTICSEARCH_URL', 'https://example.invalid'); vi.stubEnv('ELASTICSEARCH_API_KEY', 'test-only');
  vi.stubEnv('EMBED_INFERENCE_ID', 'test-omni'); vi.stubEnv('EIS_MAX_BINARY_BYTES', '1000000'); vi.stubEnv('VOICE_SEARCH_ENABLED', 'true');
  vi.stubEnv('VOICE_AUDIO_VERIFIED_STACK', audioStackFingerprint(voiceTestConfig()));
  vi.stubEnv('VOICE_ASR_API_URL', 'http://localhost/asr'); vi.stubEnv('VOICE_ASR_MODEL', 'test');
  vi.stubEnv('VOICE_ASR_VERIFIED_CONFIG', asrConfigFingerprint(getVoiceConfig()));
  mocked.prepare.mockResolvedValue({ wav: Buffer.from('wav'), durationMs: 1200 });
  mocked.search.mockResolvedValue({ kind: 'moments', hits: [], meta: { mode: 'sound_sample' } });
  mocked.transcribe.mockResolvedValue({ text: 'find a car chase', language: null });
});
function upload(fields: Record<string, string>) {
  const form = new FormData(); form.append('file', new Blob(['audio']), 'voice');
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return new Request('http://localhost/api/search/voice', { method: 'POST', body: form });
}
describe('new voice route response union and mode isolation', () => {
  it('default request invokes sound search only', async () => {
    const res = await voicePost(upload({ variant_id: 'variant' }));
    expect(res.status).toBe(200); expect((await res.json()).kind).toBe('moments');
    expect(mocked.search).toHaveBeenCalledTimes(1); expect(mocked.transcribe).not.toHaveBeenCalled();
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
  it('spoken mode transcribes but does not submit a text or vector search', async () => {
    const res = await voicePost(upload({ mode: 'spoken_request' }));
    expect(res.status).toBe(200); expect(await res.json()).toMatchObject({ kind: 'transcript', transcript: 'find a car chase' });
    expect(mocked.search).not.toHaveBeenCalled();
  });
  it('unknown/unverified capability fails before decode or inference', async () => {
    vi.stubEnv('VOICE_AUDIO_VERIFIED_STACK', 'outdated');
    const res = await voicePost(upload({ variant_id: 'variant' }));
    expect(res.status).toBe(503); expect(mocked.prepare).not.toHaveBeenCalled();
  });
  it('generic upstream failures never leak credentials', async () => {
    mocked.search.mockRejectedValue(new Error('secret-key-123'));
    const res = await voicePost(upload({ variant_id: 'variant' }));
    expect(res.status).toBe(502); expect(JSON.stringify(await res.json())).not.toContain('secret-key-123');
  });
  it('capability GET never performs provider calls', () => {
    expect(voiceCapabilitiesGet().status).toBe(200);
    expect(mocked.transcribe).not.toHaveBeenCalled(); expect(mocked.search).not.toHaveBeenCalled();
  });
});
