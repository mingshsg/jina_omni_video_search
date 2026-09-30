import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAsset: vi.fn(),
  update: vi.fn(),
  updateByQuery: vi.fn(),
  count: vi.fn(),
}));

vi.mock('./index-assets', () => ({ getAsset: mocks.getAsset }));
vi.mock('./client', () => ({
  getEsClient: () => ({
    update: mocks.update,
    updateByQuery: mocks.updateByQuery,
    count: mocks.count,
  }),
}));
vi.mock('../config', () => ({
  getConfig: () => ({
    ES_INDEX_ASSETS: 'video-assets',
    ES_INDEX_CHUNKS: 'video-chunks',
  }),
}));

import { ASSET_TITLE_MAX, AssetRenameError, renameAssetTitle } from './asset-rename';

const OLD_TITLE = '75f1e202-ad61-470e-aab9-0d7cff56c067.mp4';
const NEW_TITLE = 'Q_ZhenHuanZhuan_EP38_LetvOfficial_45m10s_xPic_NctWfg.mp4';

describe('renameAssetTitle', () => {
  beforeEach(() => {
    mocks.getAsset.mockReset();
    mocks.update.mockReset();
    mocks.updateByQuery.mockReset();
    mocks.count.mockReset();
    mocks.getAsset.mockResolvedValue({ video_id: 'v1', title: OLD_TITLE });
    mocks.update.mockResolvedValue({ result: 'updated' });
    mocks.updateByQuery.mockResolvedValue({ total: 2709, updated: 2709 });
    mocks.count.mockResolvedValue({ count: 2709 });
  });

  it('updates the asset title and the denormalized chunk video_title', async () => {
    const result = await renameAssetTitle({
      videoId: 'v1',
      expectedTitle: OLD_TITLE,
      newTitle: NEW_TITLE,
    });

    expect(result).toMatchObject({
      video_id: 'v1',
      previous_title: OLD_TITLE,
      new_title: NEW_TITLE,
      chunks_total: 2709,
      chunks_updated: 2709,
      dry_run: false,
    });

    const assetReq = mocks.update.mock.calls[0]?.[0];
    expect(assetReq.index).toBe('video-assets');
    expect(assetReq.id).toBe('v1');
    expect(assetReq.doc).toEqual({ title: NEW_TITLE });

    const chunkReq = mocks.updateByQuery.mock.calls[0]?.[0];
    expect(chunkReq.index).toBe('video-chunks');
    expect(chunkReq.query).toEqual({ term: { video_id: 'v1' } });
    // Hard invariant 2: only video_title is written by the script.
    expect(chunkReq.script.source).toContain('video_title = params.title');
    expect(chunkReq.script.source).not.toMatch(/embedding|variant_id/);
  });

  it('refuses a wrong-target rename when the title does not match', async () => {
    await expect(
      renameAssetTitle({
        videoId: 'v1',
        expectedTitle: 'something-else.mp4',
        newTitle: NEW_TITLE,
      }),
    ).rejects.toBeInstanceOf(AssetRenameError);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.updateByQuery).not.toHaveBeenCalled();
  });

  it('reports a missing asset without writing', async () => {
    mocks.getAsset.mockResolvedValue(null);
    await expect(
      renameAssetTitle({
        videoId: 'missing',
        expectedTitle: OLD_TITLE,
        newTitle: NEW_TITLE,
      }),
    ).rejects.toThrow(/not found/i);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('rejects an empty or over-long new title before any write', async () => {
    await expect(
      renameAssetTitle({
        videoId: 'v1',
        expectedTitle: OLD_TITLE,
        newTitle: '   ',
      }),
    ).rejects.toThrow(/empty/i);
    await expect(
      renameAssetTitle({
        videoId: 'v1',
        expectedTitle: OLD_TITLE,
        newTitle: 'x'.repeat(ASSET_TITLE_MAX + 1),
      }),
    ).rejects.toThrow(String(ASSET_TITLE_MAX));
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('dry-run counts chunks but writes nothing', async () => {
    const result = await renameAssetTitle({
      videoId: 'v1',
      expectedTitle: OLD_TITLE,
      newTitle: NEW_TITLE,
      dryRun: true,
    });
    expect(result).toMatchObject({
      dry_run: true,
      chunks_total: 2709,
      chunks_updated: 0,
      asset_result: 'dry_run',
    });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.updateByQuery).not.toHaveBeenCalled();
  });
});
