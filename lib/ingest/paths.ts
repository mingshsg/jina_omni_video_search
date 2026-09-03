import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../config';

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

export function newMediaFilename(ext: string): string {
  const safeExt = ext.startsWith('.') ? ext : `.${ext}`;
  return `${randomUUID()}${safeExt}`;
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
    try {
      fs.unlinkSync(partialPath);
    } catch {
      /* best effort */
    }
  }
}
