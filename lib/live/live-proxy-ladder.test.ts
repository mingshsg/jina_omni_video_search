import { describe, expect, it } from 'vitest';
import { liveProxyAttemptBudget, liveProxySettings } from './live-proxy-ladder';
import { DEFAULT_CRF_LADDER, scaleFilterForLongEdge } from '../video/types';
import { DEFAULT_RESOLUTION_LADDER } from '../ingest/variant';

describe('live proxy ladder', () => {
  it('starts at configured long edge with at most N CRF attempts', () => {
    const settings = liveProxySettings({ maxLongEdge: 720, maxAttempts: 3 });
    expect(settings.maxLongEdge).toBe(720);
    expect(settings.resolutionLadder).toEqual([720]);
    expect(settings.crfLadder).toEqual(DEFAULT_CRF_LADDER.slice(0, 3));
    expect(settings.videoFrames).toBe(16);
    expect(liveProxyAttemptBudget(settings)).toBe(3);
  });

  it('is narrower than the file-pipeline default ladder', () => {
    const live = liveProxySettings({ maxLongEdge: 720, maxAttempts: 3 });
    expect(live.resolutionLadder.length).toBeLessThan(
      DEFAULT_RESOLUTION_LADDER.length,
    );
    expect(live.crfLadder.length).toBeLessThan(DEFAULT_CRF_LADDER.length);
  });

  it('scale filter keeps -2 free axis without foar odd-height override', () => {
    const vf = scaleFilterForLongEdge(720);
    expect(vf).toContain('-2');
    expect(vf).not.toContain('force_original_aspect_ratio');
  });
});
