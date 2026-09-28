/**
 * Shared drama option resolution for ingest accept paths (plan/12 P0).
 */
import type { SourceMode } from './sources';
import {
  assertDramaDurationAllowed,
  assertDramaModeAllowed,
  initialDramaJobState,
  resolveDramaOptions,
  type DramaJobState,
  type DramaRequestOptions,
} from './drama-request';

type DramaJsonField = {
  enabled: boolean;
  languages?: string[];
  modules?: string[];
} | undefined;

/**
 * Validate mode + duration + shape; return initial job state or undefined.
 */
export function acceptDramaForIngest(input: {
  mode: SourceMode;
  durationMs: number;
  /** Already-resolved options (e.g. from FormData). */
  options?: DramaRequestOptions | undefined;
  /** Raw JSON `drama` field when not pre-resolved. */
  raw?: DramaJsonField;
}): DramaJobState | undefined {
  const options =
    input.options !== undefined
      ? input.options
      : resolveDramaOptions(input.raw);
  if (!options) return undefined;
  assertDramaModeAllowed(input.mode, options);
  assertDramaDurationAllowed(input.durationMs);
  return initialDramaJobState(options);
}
