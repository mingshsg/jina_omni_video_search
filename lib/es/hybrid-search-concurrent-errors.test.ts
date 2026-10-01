import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  enumerate: vi.fn(),
  embed: vi.fn(),
}));

vi.mock('../config', () => ({ getConfig: () => ({}) }));
vi.mock('../embed/provider', () => ({
  createEmbeddingProvider: () => ({ embedText: mocks.embed }),
}));
vi.mock('../metadata/search-filters', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../metadata/search-filters')>()),
  enumerateEligibleAssetIds: mocks.enumerate,
}));

import { searchChunksHybrid } from './hybrid-search';

describe('hybrid search concurrent setup failures', () => {
  it('handles an embedding rejection while eligibility enumeration fails', async () => {
    let failEnumeration: ((reason: Error) => void) | undefined;
    mocks.enumerate.mockImplementationOnce(() => new Promise((_, reject) => {
      failEnumeration = reject;
    }));
    mocks.embed.mockRejectedValueOnce(new Error('embed failed'));

    const outcome = searchChunksHybrid({ query: 'scene', modality: 'visual', variantId: 'v1' });
    const assertion = expect(outcome).rejects.toThrow('eligibility failed');
    // Let embedding reject before the still-pending enumeration settles.
    await new Promise((resolve) => setTimeout(resolve, 0));
    failEnumeration?.(new Error('eligibility failed'));
    await assertion;
    expect(mocks.embed).toHaveBeenCalledOnce();
  });
});
