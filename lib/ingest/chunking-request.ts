import { z } from 'zod';
import { getConfig } from '../config';
import { IngestError } from './errors';
import {
  IMPORT_CHUNK_PRESET_NAMES,
  resolveChunkingFromRequest,
  type ChunkingConfig,
} from './chunk-presets';
import { chunkingFromConfig } from './variant';

/** Shared optional chunking fields for JSON ingest body. */
export const ingestChunkingFields = {
  chunk_preset: z.enum(IMPORT_CHUNK_PRESET_NAMES).optional(),
  window_ms: z.number().int().positive().optional(),
  overlap_ms: z.number().int().nonnegative().optional(),
  min_ms: z.number().int().positive().optional(),
};

export type IngestChunkingFields = {
  chunk_preset?: (typeof IMPORT_CHUNK_PRESET_NAMES)[number];
  window_ms?: number;
  overlap_ms?: number;
  min_ms?: number;
};

/**
 * Resolve per-job chunking from request fields, falling back to env config.
 * Throws IngestError('INGEST_INVALID_CHUNKING') on bad combinations.
 */
export function resolveJobChunking(
  fields: IngestChunkingFields | undefined,
): ChunkingConfig {
  const cfg = getConfig();
  try {
    const fromReq = resolveChunkingFromRequest(fields ?? {});
    return fromReq ?? chunkingFromConfig(cfg);
  } catch {
    throw new IngestError('INGEST_INVALID_CHUNKING');
  }
}

/** Parse chunking from multipart form fields. */
export function parseChunkingFromFormData(
  form: FormData,
): IngestChunkingFields {
  const presetRaw = form.get('chunk_preset');
  const windowRaw = form.get('window_ms');
  const overlapRaw = form.get('overlap_ms');
  const minRaw = form.get('min_ms');

  const out: IngestChunkingFields = {};

  if (typeof presetRaw === 'string' && presetRaw.trim()) {
    const p = presetRaw.trim();
    if (!(IMPORT_CHUNK_PRESET_NAMES as readonly string[]).includes(p)) {
      throw new IngestError('INGEST_INVALID_CHUNKING');
    }
    out.chunk_preset = p as IngestChunkingFields['chunk_preset'];
  }

  const parseOptInt = (raw: FormDataEntryValue | null): number | undefined => {
    if (typeof raw !== 'string' || !raw.trim()) return undefined;
    const n = Number(raw.trim());
    if (!Number.isInteger(n) || n < 0) {
      throw new IngestError('INGEST_INVALID_CHUNKING');
    }
    return n;
  };

  const windowMs = parseOptInt(windowRaw);
  const overlapMs = parseOptInt(overlapRaw);
  const minMs = parseOptInt(minRaw);
  if (windowMs !== undefined) out.window_ms = windowMs;
  if (overlapMs !== undefined) out.overlap_ms = overlapMs;
  if (minMs !== undefined) out.min_ms = minMs;

  // window and overlap must appear together if either is set
  if (
    (out.window_ms !== undefined) !== (out.overlap_ms !== undefined)
  ) {
    throw new IngestError('INGEST_INVALID_CHUNKING');
  }

  return out;
}
