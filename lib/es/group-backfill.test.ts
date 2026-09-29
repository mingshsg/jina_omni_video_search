import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAsset: vi.fn(),
  update: vi.fn(),
}));

vi.mock('./index-assets', () => ({ getAsset: mocks.getAsset }));
vi.mock('./client', () => ({ getEsClient: () => ({ update: mocks.update }) }));
vi.mock('../config', () => ({
  getConfig: () => ({ ES_INDEX_ASSETS: 'video-assets' }),
}));

import { backfillAssetGroup } from './group-backfill';

const fineAsset = {
  meta: undefined,
  variants: [{ chunk_preset: 'fine', chunk_window_ms: 10_000 }],
};

describe('single-video group backfill', () => {
  beforeEach(() => {
    mocks.getAsset.mockReset();
    mocks.update.mockReset();
    mocks.getAsset.mockResolvedValue(fineAsset);
    mocks.update.mockResolvedValue({ result: 'updated' });
  });

  it('writes only the confirmed inferred group through a guarded update', async () => {
    expect(await backfillAssetGroup('video-1', 'trailer')).toEqual({
      status: 'updated',
      group_id: 'trailer',
    });
    expect(mocks.update).toHaveBeenCalledTimes(1);
    const request = mocks.update.mock.calls[0]?.[0];
    expect(request.index).toBe('video-assets');
    expect(request.id).toBe('video-1');
    expect(request.script.params.group_id).toBe('trailer');
    expect(request.script.source).toContain('ctx.op = \'noop\'');
    expect(request.script.source).toContain('ctx._source.meta.group_id != null');
  });

  it('never writes when the group exists or the displayed suggestion is stale', async () => {
    mocks.getAsset.mockResolvedValueOnce({ ...fineAsset, meta: { group_id: 'custom' } });
    expect(await backfillAssetGroup('video-1', 'trailer')).toEqual({ status: 'already_set' });
    expect(await backfillAssetGroup('video-1', 'demo')).toEqual({ status: 'changed' });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('does not guess a group without a matching variant', async () => {
    mocks.getAsset.mockResolvedValue({ meta: undefined, variants: [] });
    expect(await backfillAssetGroup('video-1', 'demo')).toEqual({ status: 'no_match' });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('treats a concurrent no-op as already set', async () => {
    mocks.update.mockResolvedValue({ result: 'noop' });
    expect(await backfillAssetGroup('video-1', 'trailer')).toEqual({ status: 'already_set' });
  });
});
