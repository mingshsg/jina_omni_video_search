/**
 * Pure, client-safe filename helpers (no `node:fs`/`node:path`).
 *
 * Kept separate from `paths.ts` because the import UI (a client component)
 * needs `titleFromFilename` for its display-name preview, and `paths.ts`
 * pulls in the filesystem.
 */

/** Cap for the human-readable stem; keeps the whole name well under 255 bytes. */
export const MEDIA_FILENAME_STEM_MAX = 80;

/**
 * Derive a display title from a filename or path: last path segment with the
 * extension removed, original casing preserved. Shared by every single-file
 * ingest path (upload / local / url / batch) so a UUID-named body never
 * becomes the title. Returns `''` only for pathological input (e.g. a name
 * that is just an extension); callers fall back to their own default.
 */
export function titleFromFilename(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? name;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

/**
 * Make a filesystem-safe, still-recognizable stem from an original filename:
 * basename only, extension stripped, NFKC-normalized, characters outside
 * letters/digits/`.`/`_`/`-` collapsed to `-`, and no `..` sequence. Never
 * contains a path separator, so it cannot escape the caller's directory.
 * Returns `''` when nothing usable survives — the caller then falls back to a
 * UUID-only name.
 */
export function sanitizeFilenameStem(raw: string): string {
  const base = raw.split(/[/\\]/).pop() ?? raw;
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const cleaned = stem
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    // `..`, `.-`, `_.` … collapse to a single `-`, so `..` cannot survive.
    .replace(/[-._]{2,}/g, '-')
    .replace(/^[-._]+|[-._]+$/g, '');
  // Slice by code point so a multi-byte character is never cut in half.
  return [...cleaned].slice(0, MEDIA_FILENAME_STEM_MAX).join('');
}

/**
 * Resolve the display title for a single-file import.
 *
 * An explicitly supplied title always wins; otherwise the original filename
 * (minus extension) is used so a UUID-named body never becomes the title.
 * Returns `undefined` when neither yields anything, which lets
 * `createIngestJob` apply its own final fallback.
 */
export function resolveIngestTitle(
  explicitTitle: string | undefined | null,
  filename: string,
): string | undefined {
  const explicit = typeof explicitTitle === 'string' ? explicitTitle.trim() : '';
  if (explicit) return explicit;
  return titleFromFilename(filename) || undefined;
}
