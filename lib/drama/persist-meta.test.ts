import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ update: vi.fn().mockResolvedValue({}) }));

vi.mock('../es/client', () => ({ getEsClient: () => ({ update: mocks.update }) }));
vi.mock('../config', () => ({
  getConfig: () => ({ ES_INDEX_ASSETS: 'video-assets' }),
}));

import { persistDramaMeta } from './persist-meta';

describe('persistDramaMeta', () => {
  it('sends the drama payload and a bounded run-history cap to the scripted update', async () => {
    mocks.update.mockClear();
    await persistDramaMeta('v1', {
      run_id: 'run2',
      enrichment_status: 'succeeded',
      modules: ['subtitles'],
      languages: ['en'],
    });

    expect(mocks.update).toHaveBeenCalledTimes(1);
    const call = mocks.update.mock.calls[0]![0] as {
      index: string;
      id: string;
      refresh: string;
      retry_on_conflict: number;
      script: { source: string; lang: string; params: Record<string, unknown> };
    };
    expect(call.index).toBe('video-assets');
    expect(call.id).toBe('v1');
    expect(call.refresh).toBe('wait_for');
    expect(call.retry_on_conflict).toBe(3);
    expect(call.script.lang).toBe('painless');
    expect(call.script.params.drama).toEqual({
      run_id: 'run2',
      enrichment_status: 'succeeded',
      modules: ['subtitles'],
      languages: ['en'],
    });
    // Regression: the history-trim branch in the Painless source reads
    // `params.historyMax` — without it, repeated re-enrichment would grow
    // `meta.drama.runs` without bound (live-cluster-verified separately,
    // since Painless execution can't run inside a unit test).
    expect(call.script.params.historyMax).toBe(5);
    expect(typeof call.script.params.now).toBe('string');
    expect(call.script.source).toContain('history.remove(0)');
    expect(call.script.source).toContain('params.historyMax');
  });
});
