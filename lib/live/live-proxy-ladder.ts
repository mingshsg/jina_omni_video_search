import type { ProxySettings } from '../ingest/variant';
import { DEFAULT_CRF_LADDER } from '../video/types';

/**
 * Fixed live video-proxy ladder (ops / Phase 4 latency tuning).
 * Starts at LIVE_PROXY_MAX_LONG_EDGE (default 720) with at most
 * LIVE_PROXY_MAX_ATTEMPTS CRF attempts — narrower than the file pipeline.
 */

export const LIVE_PROXY_VIDEO_FRAMES = 16 as const;

export interface LiveProxyLadderConfig {
  maxLongEdge: number;
  maxAttempts: number;
}

/**
 * Build ProxySettings for live windows.
 * Single resolution rung at maxLongEdge; CRF ladder truncated to maxAttempts.
 */
export function liveProxySettings(cfg: LiveProxyLadderConfig): ProxySettings {
  const maxAttempts = Math.max(1, Math.floor(cfg.maxAttempts));
  const maxLongEdge = Math.max(1, Math.floor(cfg.maxLongEdge));
  const crfLadder = DEFAULT_CRF_LADDER.slice(0, maxAttempts);
  return {
    videoFrames: LIVE_PROXY_VIDEO_FRAMES,
    maxLongEdge,
    resolutionLadder: [maxLongEdge],
    crfLadder: crfLadder.length > 0 ? crfLadder : [23],
  };
}

/** Estimate worst-case encode attempts (frames × resolution × CRF). */
export function liveProxyAttemptBudget(settings: ProxySettings): number {
  // Live ladder does not use frame reduction for the primary path estimate;
  // encoder still may fall back to FRAME_REDUCTION_LADDER after exhaustion.
  return (
    1 *
    settings.resolutionLadder.length *
    settings.crfLadder.length
  );
}
