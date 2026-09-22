/** Resolution rungs: long edge with reference 16:9 dimensions (FR-8). */
export const RESOLUTION_RUNGS = [
  { longEdge: 1280, width: 1280, height: 720 },
  { longEdge: 960, width: 960, height: 540 },
  { longEdge: 854, width: 854, height: 480 },
  { longEdge: 720, width: 720, height: 405 },
  { longEdge: 640, width: 640, height: 360 },
] as const;

export const DEFAULT_CRF_LADDER = [23, 26, 28, 30, 32] as const;

/** Frame-count reduction steps when resolution/CRF ladder is exhausted. */
export const FRAME_REDUCTION_LADDER = [32, 24, 16] as const;

export type ProxyStrategy = 'ladder' | 'frame_reduced';

export interface VideoProxyMetadata {
  bytes: number;
  width: number;
  height: number;
  frames: number;
  crf: number;
  strategy: ProxyStrategy;
  ladder_exhausted: boolean;
  encode_ms: number;
  output_path: string;
}

export interface AudioProxyMetadata {
  bytes: number;
  bitrate: string;
  codec: string;
  encode_ms: number;
  output_path: string;
}

export class ProxyBudgetExhaustedError extends Error {
  readonly code = 'PROXY_BUDGET_EXHAUSTED';
  readonly ladder_exhausted = true;

  constructor(
    message: string,
    readonly budgetBytes: number,
    readonly smallestBytes: number,
  ) {
    super(message);
    this.name = 'ProxyBudgetExhaustedError';
  }
}

/** Scale filter: fit inside long-edge rung, preserve aspect ratio, even dims. */
export function scaleFilterForLongEdge(longEdge: number): string {
  // `-2` keeps the free axis even for libx264. Do not add
  // force_original_aspect_ratio=decrease here — it can override `-2` and yield
  // odd heights (e.g. 720x405) that fail libx264.
  return (
    `scale='if(gt(iw\\,ih)\\,min(iw\\,${longEdge})\\,-2)` +
    `':'if(gt(iw\\,ih)\\,-2\\,min(ih\\,${longEdge}))'`
  );
}

export function windowDurationSec(startMs: number, endMs: number): number {
  return Math.max(0, endMs - startMs) / 1000;
}

export function msToFfmpegTime(ms: number): string {
  const sec = ms / 1000;
  return sec.toFixed(3);
}
