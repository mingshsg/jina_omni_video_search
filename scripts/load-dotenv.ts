import fs from 'node:fs';
import path from 'node:path';

/** Load a dotenv file into `process.env` without overwriting existing vars. */
export function loadDotenv(filePath = path.join(process.cwd(), '.env')): void {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, 'utf8');
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

/**
 * Load shared `.env` then optional worker overlay `.env.worker`.
 * Later files do not overwrite keys already set (including by the shell).
 */
export function loadWorkerDotenv(cwd = process.cwd()): void {
  loadDotenv(path.join(cwd, '.env'));
  loadDotenv(path.join(cwd, '.env.worker'));
}

export function envFlag(name: string): boolean {
  const v = (process.env[name] ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}
