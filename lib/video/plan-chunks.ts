export interface ChunkWindow {
  chunk_index: number;
  start_ms: number;
  end_ms: number;
}

export interface PlanChunksOptions {
  durationMs: number;
  windowMs: number;
  overlapMs: number;
  minMs: number;
}

/**
 * Plan non-overlapping chunk windows with overlap between consecutive windows.
 *
 * stride = window - overlap; trailing window shorter than minMs merges into
 * its predecessor (FR-8 / plan window planning).
 */
export function planChunks(options: PlanChunksOptions): ChunkWindow[] {
  const { durationMs, windowMs, overlapMs, minMs } = options;

  if (durationMs <= 0) return [];
  if (windowMs <= 0) {
    throw new Error('windowMs must be positive');
  }
  if (overlapMs < 0 || overlapMs >= windowMs) {
    throw new Error('overlapMs must be >= 0 and < windowMs');
  }
  if (minMs <= 0) {
    throw new Error('minMs must be positive');
  }

  const stride = windowMs - overlapMs;
  const raw: Array<{ start_ms: number; end_ms: number }> = [];

  for (let start = 0; start < durationMs; start += stride) {
    const end = Math.min(start + windowMs, durationMs);
    if (end <= start) break;
    raw.push({ start_ms: start, end_ms: end });
  }

  if (raw.length === 0) {
    raw.push({ start_ms: 0, end_ms: durationMs });
  }

  const last = raw[raw.length - 1]!;
  const lastDuration = last.end_ms - last.start_ms;
  if (raw.length > 1 && lastDuration < minMs) {
    const prev = raw[raw.length - 2]!;
    prev.end_ms = last.end_ms;
    raw.pop();
  }

  return raw.map((w, chunk_index) => ({
    chunk_index,
    start_ms: w.start_ms,
    end_ms: w.end_ms,
  }));
}
