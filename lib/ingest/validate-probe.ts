import { probeVideo, type VideoProbeResult } from '../video/probe';
import { IngestError } from './errors';

/**
 * Shared post-validation: ffprobe must find a video stream and non-zero duration.
 */
export async function validateMediaProbe(
  filePath: string,
): Promise<VideoProbeResult> {
  let probe: VideoProbeResult;
  try {
    probe = await probeVideo(filePath);
  } catch {
    throw new IngestError('INGEST_PROBE_FAILED');
  }
  if (probe.duration_ms <= 0) {
    throw new IngestError('INGEST_PROBE_ZERO_DURATION');
  }
  return probe;
}
