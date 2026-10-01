import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../config';

const mocks = vi.hoisted(() => ({ search: vi.fn(), getConfig: vi.fn() }));
vi.mock('../config', () => ({ getConfig: mocks.getConfig }));
vi.mock('../es/client', () => ({
  getEsClient: () => ({ search: mocks.search }),
}));

import { enumerateEligibleAssetIds } from './search-filters';

describe('eligible asset enumeration config', () => {
  it('uses the supplied assets index without reading ambient config', async () => {
    mocks.getConfig.mockImplementation(() => { throw new Error('ambient config used'); });
    mocks.search.mockResolvedValueOnce({ hits: { total: { value: 1, relation: 'eq' }, hits: [{ _id: 'video1' }] } });
    const cfg = { ES_INDEX_ASSETS: 'alternate-video-assets' } as AppConfig;
    const result = await enumerateEligibleAssetIds({ variantId: 'v1', cfg });
    expect(mocks.search).toHaveBeenCalledWith(expect.objectContaining({ index: 'alternate-video-assets' }));
    expect(result.videoIds).toEqual(['video1']);
    expect(mocks.getConfig).not.toHaveBeenCalled();
  });
});
