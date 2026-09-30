/**
 * Pure, client-safe filename helpers (no `node:fs`/`node:path`).
 *
 * Kept separate from `paths.ts` because the import UI (a client component)
 * needs `titleFromFilename` for its display-name preview, and `paths.ts`
 * pulls in the filesystem.
 */

/**
 * POSIX `NAME_MAX` for a single path component on the target filesystems
 * (ext4/overlayfs in the container, APFS on macOS). Measured as 255 on the
 * dev host and the deploy base image.
 */
export const MEDIA_FILENAME_NAME_MAX_BYTES = 255;

/**
 * Bytes appended after the stem in the longest path component, including
 * failed-upload quarantine: `-` (1) + token (12) + longest extension (5) +
 * `.part` (5) + `.` (1) + timestamp (14 reserved) + `.partial` (8) = 46.
 */
export const MEDIA_FILENAME_SUFFIX_RESERVE_BYTES = 46;

/** Extra safety margin on top of the suffix reserve. */
export const MEDIA_FILENAME_SAFETY_MARGIN_BYTES = 8;

/**
 * Cap for the human-readable stem **in UTF-8 bytes** (not code points):
 * 255 − 46 suffix − 8 margin = 201 bytes. The previous code-point cap of 80
 * allowed 80 Han characters = 240 bytes, and `-<token>.mp4.part` pushed the
 * component to 262 bytes — over `NAME_MAX`. Budgeting by bytes keeps the
 * complete quarantine name (including timestamp and `.partial`) ≤ 247.
 */
export const MEDIA_FILENAME_STEM_MAX_BYTES =
  MEDIA_FILENAME_NAME_MAX_BYTES -
  MEDIA_FILENAME_SUFFIX_RESERVE_BYTES -
  MEDIA_FILENAME_SAFETY_MARGIN_BYTES;

/** UTF-8 length of a single code point, without `Buffer`/`TextEncoder`. */
function codePointUtf8Bytes(codePoint: number): number {
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
}

/**
 * Truncate `value` to at most `maxBytes` UTF-8 bytes without splitting a
 * character: iteration is by code point, so a multi-byte character is either
 * wholly kept or wholly dropped (never a broken half).
 */
export function truncateUtf8ToBytes(value: string, maxBytes: number): string {
  if (maxBytes <= 0) return '';
  let bytes = 0;
  let out = '';
  for (const char of value) {
    const size = codePointUtf8Bytes(char.codePointAt(0) ?? 0);
    if (bytes + size > maxBytes) break;
    bytes += size;
    out += char;
  }
  return out;
}

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
  // Slice by UTF-8 bytes, never by code point: a code-point cap of 80 let
  // 80 Han characters (240 bytes) through, and the `-<token>.mp4` suffix then
  // overran the 255-byte component limit. The byte cap leaves room for that
  // suffix, extension, upload `.part`, and quarantine timestamp/`.partial`.
  return truncateUtf8ToBytes(cleaned, MEDIA_FILENAME_STEM_MAX_BYTES);
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
