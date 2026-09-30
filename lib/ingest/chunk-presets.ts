/**
 * Named chunking presets selectable per import.
 * Env CHUNK_* remains the process default when the request omits chunk_preset.
 */

export const CHUNK_PRESET_NAMES = [
  'standard',
  '60s',
  '30s',
  '20s_3s',
  '20s',
  'fine',
  '5s',
  '2s',
  'custom',
] as const;

export type ChunkPreset = (typeof CHUNK_PRESET_NAMES)[number];

/** Presets offered in the import UI / API (excludes free-form `custom`). */
export const IMPORT_CHUNK_PRESET_NAMES = [
  'standard',
  '60s',
  '30s',
  '20s',
  '20s_3s',
  'fine',
  '5s',
  '2s',
] as const;

export type ImportChunkPreset = (typeof IMPORT_CHUNK_PRESET_NAMES)[number];

export interface ChunkingConfig {
  preset: ChunkPreset;
  windowMs: number;
  overlapMs: number;
  minMs: number;
}

/** Canonical window / overlap / min for each named import preset. */
export const CHUNK_PRESET_DEFS: Record<
  ImportChunkPreset,
  Omit<ChunkingConfig, 'preset'>
> = {
  /** Legacy default — 64 s window, 4 s overlap. */
  standard: { windowMs: 64_000, overlapMs: 4_000, minMs: 4_000 },
  /** 60 s vs 64 s comparison; same 4 s overlap as standard. */
  '60s': { windowMs: 60_000, overlapMs: 4_000, minMs: 4_000 },
  /** Medium windows; 4 s overlap keeps stride=26 s. */
  '30s': { windowMs: 30_000, overlapMs: 4_000, minMs: 4_000 },
  /** 20 s window with a wider 3 s overlap (stride 17 s). Distinct id from the
   * legacy `20s` (20s/2s) so existing 20s variants are not orphaned — the
   * parameters are hashed into `variant_id` (todo/42 Q1). */
  '20s_3s': { windowMs: 20_000, overlapMs: 3_000, minMs: 2_000 },
  /** Legacy 20 s window / 2 s overlap; kept unchanged for existing variants. */
  '20s': { windowMs: 20_000, overlapMs: 2_000, minMs: 2_000 },
  /** Dense indexing — 10 s / 2 s. */
  fine: { windowMs: 10_000, overlapMs: 2_000, minMs: 2_000 },
  /** Short windows — 5 s / 2 s (stride 3 s). */
  '5s': { windowMs: 5_000, overlapMs: 2_000, minMs: 1_000 },
  /** Ultra-dense — 2 s window / 1 s overlap (stride 1 s). */
  '2s': { windowMs: 2_000, overlapMs: 1_000, minMs: 1_000 },
};

export function isImportChunkPreset(v: string): v is ImportChunkPreset {
  return (IMPORT_CHUNK_PRESET_NAMES as readonly string[]).includes(v);
}

export function chunkingForPreset(preset: ImportChunkPreset): ChunkingConfig {
  const def = CHUNK_PRESET_DEFS[preset];
  return { preset, ...def };
}

/**
 * Resolve chunking from an ingest request.
 * - `chunk_preset` alone → named table
 * - `window_ms` + `overlap_ms` → custom (optional `chunk_preset` label, default `custom`)
 * - neither → null (caller should fall back to env config)
 */
export function resolveChunkingFromRequest(input: {
  chunk_preset?: string;
  window_ms?: number;
  overlap_ms?: number;
  min_ms?: number;
}): ChunkingConfig | null {
  const hasWindow =
    typeof input.window_ms === 'number' && Number.isFinite(input.window_ms);
  const hasOverlap =
    typeof input.overlap_ms === 'number' && Number.isFinite(input.overlap_ms);

  if (hasWindow && hasOverlap) {
    const windowMs = Math.floor(input.window_ms!);
    const overlapMs = Math.floor(input.overlap_ms!);
    if (windowMs <= 0 || overlapMs < 0 || overlapMs >= windowMs) {
      throw new Error('INVALID_CHUNKING');
    }
    const minMs =
      typeof input.min_ms === 'number' && input.min_ms > 0
        ? Math.floor(input.min_ms)
        : Math.min(4_000, Math.max(1_000, Math.floor(windowMs / 5)));
    const presetLabel =
      input.chunk_preset && isImportChunkPreset(input.chunk_preset)
        ? input.chunk_preset
        : 'custom';
    return { preset: presetLabel, windowMs, overlapMs, minMs };
  }

  if (input.chunk_preset) {
    if (!isImportChunkPreset(input.chunk_preset)) {
      throw new Error('INVALID_CHUNK_PRESET');
    }
    return chunkingForPreset(input.chunk_preset);
  }

  return null;
}

/**
 * Client-side custom chunking draft (import UI "custom" option, todo/42).
 * Only window + overlap are exposed; `min_ms` stays server-defaulted.
 */
export interface CustomChunkingDraft {
  windowMs: number;
  overlapMs: number;
}

/**
 * Validate the two custom inputs taken from second-valued number fields.
 * Mirrors the server rule (`resolveChunkingFromRequest`): window > 0 and
 * 0 <= overlap < window, integers only. Returns the parsed draft, or null
 * when either field is not a whole number or the pair is invalid, so the UI
 * can block submit instead of relying on the server's `INVALID_CHUNKING`.
 */
export function resolveCustomChunkingDraft(
  windowSeconds: string | number,
  overlapSeconds: string | number,
): CustomChunkingDraft | null {
  const parse = (raw: string | number): number | null => {
    if (typeof raw === 'number') {
      return Number.isInteger(raw) ? raw : null;
    }
    const trimmed = raw.trim();
    if (!/^\d+$/.test(trimmed)) return null;
    return Number(trimmed);
  };
  const w = parse(windowSeconds);
  const o = parse(overlapSeconds);
  if (w === null || o === null) return null;
  if (w <= 0 || o < 0 || o >= w) return null;
  return { windowMs: w * 1000, overlapMs: o * 1000 };
}

/** Short human label, e.g. `60s · 60s/4s`. Safe for client + server. */
export function formatChunkPresetLabel(

  preset: string,
  windowMs?: number,
  overlapMs?: number,
): string {
  if (
    typeof windowMs === 'number' &&
    windowMs > 0 &&
    typeof overlapMs === 'number' &&
    overlapMs >= 0
  ) {
    const w = Math.round(windowMs / 1000);
    const o = Math.round(overlapMs / 1000);
    return `${preset} · ${w}s/${o}s`;
  }
  if (isImportChunkPreset(preset)) {
    const def = CHUNK_PRESET_DEFS[preset];
    return formatChunkPresetLabel(preset, def.windowMs, def.overlapMs);
  }
  return preset;
}
