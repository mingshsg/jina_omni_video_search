import { createHash } from 'node:crypto';
import type { FfmpegExit, FragmentProbe } from '../source-adapter';

/** Shared media-signature discontinuity probe used by all live adapters. */
export function classifyLiveFragment(meta: FragmentProbe) {
  if (!meta.codec) {
    return { kind: 'discontinuity' as const, reason: 'missing_codec' };
  }
  const mediaSignature = createHash('sha256')
    .update(
      [
        meta.codec,
        String(meta.width ?? ''),
        String(meta.height ?? ''),
        meta.timeBase ?? '',
        String(meta.hasAudio ?? false),
      ].join('|'),
    )
    .digest('hex');
  return {
    kind: 'fragment' as const,
    durationMs: meta.durationMs ?? 0,
    mediaSignature,
  };
}

/** Shared FFmpeg exit classification (retryable network vs fatal). */
export function classifyLiveCaptureExit(
  exit: FfmpegExit,
): 'retryable' | 'fatal' | 'stopped' {
  if (exit.timedOut) return 'retryable';
  if (exit.stopped) return 'stopped';
  if (exit.signal === 'SIGTERM' || exit.signal === 'SIGINT') return 'stopped';
  const tail = exit.stderrTail.toLowerCase();
  if (
    tail.includes('connection refused') ||
    tail.includes('timed out') ||
    tail.includes('timeout') ||
    tail.includes('end of file') ||
    tail.includes('server returned 4') ||
    tail.includes('connection reset') ||
    tail.includes('broken pipe') ||
    exit.code === 1
  ) {
    return 'retryable';
  }
  if (exit.code === 0) return 'stopped';
  return 'fatal';
}
