import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ web: vi.fn() }));
vi.mock('../config', () => ({ getConfig: () => ({ SUGGEST_WEB_PROVIDER: 'agent', SUGGEST_AGENT_ID: 'test', SUGGEST_AGENT_CONNECTOR_ID: 'test' }) }));
vi.mock('../es/asset-meta', () => ({
  getAssetMetaEditorDto: async () => ({ title: 'Video', meta_revision: 1, meta: {} }),
  MetaNotFoundError: class extends Error {},
}));
vi.mock('./suggest-local', () => ({ buildLocalSuggestions: () => ({ suggestions: {}, title_clues: [] }) }));
vi.mock('./suggest-web', () => ({ enrichSuggestionsWithWeb: mocks.web }));
import { POST } from '../../app/api/library/[videoId]/meta/suggest/route';
import { getSuggestJob, resetSuggestJobsForTests } from './suggest-jobs';
import { resolveOperatorHint } from './operator-hint';
const request = (hint: string) => POST(new Request('http://localhost/suggest', { method: 'POST', body: JSON.stringify({ operator_hint: hint }) }), { params: { videoId: 'v1' } });

describe('Suggest cache respects the complete operator hint', () => {
  beforeEach(() => {
    resetSuggestJobsForTests(); vi.clearAllMocks();
    mocks.web.mockResolvedValue({ suggestions: { year: { value: 2000 } }, title_clues: [], provider: 'local+agent', web: { status: 'ok' } });
  });
  it('does not reuse a cached result for different unparsed operator instructions', async () => {
    const firstHint = 'Please research the actors carefully, and compare two sources.';
    const secondHint = 'Please research the director carefully, and compare three sources.';
    expect(resolveOperatorHint(firstHint).workTitle).toBeNull();
    expect(resolveOperatorHint(secondHint).workTitle).toBeNull();
    const first = await (await request(firstHint)).json();
    await vi.waitFor(() => expect(getSuggestJob(first.request_id, 'v1')?.status).toBe('complete'));
    const second = await (await request(secondHint)).json();
    await vi.waitFor(() => expect(getSuggestJob(second.request_id, 'v1')?.status).toBe('complete'));
    expect(second.cache_hit).not.toBe(true);
    expect(mocks.web).toHaveBeenCalledTimes(2);
    const repeat = await (await request(`  ${secondHint}  `)).json();
    expect(repeat.cache_hit).toBe(true);
    expect(mocks.web).toHaveBeenCalledTimes(2);
  });
});
