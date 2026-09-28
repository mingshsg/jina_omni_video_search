/**
 * Parse / validate optional ingest-time `drama` enrichment options (plan/12).
 * Drama runs after embed `ready`; URL mode rejects drama in v1 (Library later).
 */
import { z } from 'zod';
import { getDramaEnv } from '../drama/env';
import { IngestError } from './errors';
import {
  DRAMA_LANGUAGES,
  DRAMA_MODULES,
  type DramaJobState,
  type DramaLanguage,
  type DramaModule,
  type DramaRequestOptions,
  isDramaLanguage,
  isDramaModule,
} from './drama-options';

export type { DramaRequestOptions, DramaJobState };

const dramaBodySchema = z
  .object({
    enabled: z.boolean(),
    languages: z.array(z.string()).optional(),
    modules: z.array(z.string()).optional(),
  })
  .optional();

/** Shared Zod field for JSON ingest bodies. */
export const ingestDramaField = {
  drama: dramaBodySchema,
};

function uniquePreserveOrder<T extends string>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

function parseLanguageList(raw: unknown): DramaLanguage[] {
  if (!Array.isArray(raw)) {
    throw new IngestError('INGEST_DRAMA_INVALID');
  }
  const out: DramaLanguage[] = [];
  for (const item of raw) {
    if (typeof item !== 'string' || !isDramaLanguage(item.trim())) {
      throw new IngestError('INGEST_DRAMA_INVALID');
    }
    out.push(item.trim() as DramaLanguage);
  }
  return uniquePreserveOrder(out);
}

function parseModuleList(raw: unknown): DramaModule[] {
  if (!Array.isArray(raw)) {
    throw new IngestError('INGEST_DRAMA_INVALID');
  }
  const out: DramaModule[] = [];
  for (const item of raw) {
    if (typeof item !== 'string' || !isDramaModule(item.trim())) {
      throw new IngestError('INGEST_DRAMA_INVALID');
    }
    out.push(item.trim() as DramaModule);
  }
  return uniquePreserveOrder(out);
}

/**
 * Resolve drama options from a parsed JSON body field.
 * Returns undefined when omitted or `enabled: false`.
 */
export function resolveDramaOptions(
  raw: z.infer<typeof dramaBodySchema>,
): DramaRequestOptions | undefined {
  if (raw == null || raw.enabled !== true) return undefined;
  const languages = parseLanguageList(raw.languages ?? []);
  const modules = parseModuleList(raw.modules ?? []);
  if (modules.length === 0) {
    throw new IngestError('INGEST_DRAMA_EMPTY');
  }
  if (modules.includes('subtitles') && languages.length === 0) {
    throw new IngestError('INGEST_DRAMA_INVALID');
  }
  if (modules.includes('key_actors') && !modules.includes('directors_script')) {
    // generateKeyActors reads cast roles from this run's directors script
    // (runner passes only directorsPaths?.raw); without that module the
    // selection always fails at runtime, so reject it at accept time.
    throw new IngestError('INGEST_DRAMA_NEEDS_DIRECTORS');
  }
  return { enabled: true, languages, modules };
}

/** URL ingest cannot enable drama in v1 (OQ-4). */
export function assertDramaModeAllowed(
  mode: string,
  drama: DramaRequestOptions | undefined,
): void {
  if (!drama) return;
  if (mode === 'url') {
    throw new IngestError('INGEST_DRAMA_URL_NOT_SUPPORTED');
  }
}

/** Duration gate (OQ-5); call when drama is enabled and probe is known. */
export function assertDramaDurationAllowed(durationMs: number): void {
  const max = getDramaEnv().DRAMA_MAX_DURATION_MS;
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new IngestError('INGEST_PROBE_ZERO_DURATION');
  }
  if (durationMs > max) {
    throw new IngestError('INGEST_DRAMA_TOO_LONG');
  }
}

function parseCsvOrJsonList(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (!Array.isArray(parsed)) {
        throw new IngestError('INGEST_DRAMA_INVALID');
      }
      return parsed.map((x) => String(x));
    } catch (err) {
      if (err instanceof IngestError) throw err;
      throw new IngestError('INGEST_DRAMA_INVALID');
    }
  }
  return trimmed
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Read drama options from multipart FormData (upload / batch). */
export function parseDramaFromFormData(
  form: FormData,
): DramaRequestOptions | undefined {
  const enabledRaw = form.get('drama_enabled');
  const enabled =
    typeof enabledRaw === 'string' &&
    ['true', '1', 'yes'].includes(enabledRaw.trim().toLowerCase());
  if (!enabled) return undefined;

  const langRaw = form.get('drama_languages');
  const modRaw = form.get('drama_modules');
  const languages =
    typeof langRaw === 'string' ? parseCsvOrJsonList(langRaw) : [];
  const modules =
    typeof modRaw === 'string' ? parseCsvOrJsonList(modRaw) : [];

  return resolveDramaOptions({
    enabled: true,
    languages,
    modules,
  });
}

/** Initial in-memory drama job state after accept. */
export function initialDramaJobState(
  opts: DramaRequestOptions,
): DramaJobState {
  return {
    status: 'pending',
    languages: opts.languages,
    modules: opts.modules,
    modules_done: [],
  };
}

/** For docs / UI catalogs. */
export const DRAMA_OPTION_CATALOG = {
  languages: DRAMA_LANGUAGES,
  modules: DRAMA_MODULES,
} as const;
