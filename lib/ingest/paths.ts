import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../config';
import { sanitizeFilenameStem } from './media-name';

export function originalsDir(cfg: AppConfig): string {
  return path.join(cfg.MEDIA_ROOT, 'originals');
}

export function uploadsDir(cfg: AppConfig): string {
  return path.join(cfg.MEDIA_ROOT, 'uploads');
}

export function quarantineDir(cfg: AppConfig): string {
  return path.join(cfg.MEDIA_ROOT, 'quarantine');
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

/** Random hex suffix (12 chars ≈ 48 bits) that keeps same-stem files unique. */
function shortUniqueToken(): string {
  return randomUUID().replace(/-/g, '').slice(0, 12);
}

/**
 * Generate the on-disk media filename.
 *
 * - With an `originalName`, the name is `<sanitized-stem>-<short-uuid><ext>`
 *   so an operator can still recognize the file in `data/`; the random suffix
 *   preserves uniqueness.
 * - Without one (or when the stem sanitizes to nothing), it stays the legacy
 *   `<uuid><ext>` so existing callers keep identical behavior.
 *
 * The extension is assumed already whitelist-checked by the caller.
 */
export function newMediaFilename(ext: string, originalName?: string): string {
  const safeExt = ext.startsWith('.') ? ext : `.${ext}`;
  const stem = originalName ? sanitizeFilenameStem(originalName) : '';
  return stem
    ? `${stem}-${shortUniqueToken()}${safeExt}`
    : `${randomUUID()}${safeExt}`;
}

/** Move a partial download to quarantine instead of leaving it in place. */
export function quarantinePartial(
  cfg: AppConfig,
  partialPath: string,
): void {
  try {
    if (!fs.existsSync(partialPath)) return;
    const dir = quarantineDir(cfg);
    ensureDir(dir);
    const dest = path.join(dir, `${path.basename(partialPath)}.${Date.now()}.partial`);
    fs.renameSync(partialPath, dest);
  } catch {
    // Preserve the staged file if quarantine cannot be written. Never delete
    // user media; an operator can recover it from the original staging path.
  }
}
