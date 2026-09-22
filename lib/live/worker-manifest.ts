/**
 * Worker capability manifest (Phase 1/2).
 * Prefer `probeWorkerCapabilities()` at worker startup to fill FFmpeg fields.
 */
export interface LiveWorkerCapabilityManifest {
  schema_version: 1;
  node_version: string;
  ffmpeg_version?: string;
  ffmpeg_buildconf?: string;
  protocols?: string[];
  demuxers?: string[];
  encoders?: string[];
  image_digest?: string;
  /** sha256 of probed capability surface when available */
  capabilities_hash?: string;
  recorded_at?: string;
}

/** Placeholder until worker image probe runs at startup. */
export function emptyWorkerManifest(
  nodeVersion: string = process.version,
): LiveWorkerCapabilityManifest {
  return {
    schema_version: 1,
    node_version: nodeVersion,
  };
}
