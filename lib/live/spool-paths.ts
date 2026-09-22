import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';

/**
 * Session spool path helpers. Absolute paths never leave the worker;
 * APIs only see opaque refs.
 */

export function sessionSpoolDir(spoolRoot: string, sessionId: string): string {
  assertSafeSegment(sessionId, 'sessionId');
  return path.resolve(spoolRoot, 'sessions', sessionId);
}

export function assertPathInsideRoot(root: string, candidate: string): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(candidate);
  const rel = path.relative(resolvedRoot, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Path escapes spool root: ${candidate}`);
  }
  return resolved;
}

function assertSafeSegment(value: string, label: string): void {
  if (!value || value.includes('..') || value.includes('/') || value.includes('\\') || value.includes('\0')) {
    throw new Error(`Invalid ${label}`);
  }
}

export type MediaKind = 'clip' | 'thumb' | 'fragment' | 'tmp';

/** Opaque ref: livemedia_<kind>_<sessionHash12>_<token> */
export function mintOpaqueMediaRef(
  sessionId: string,
  kind: MediaKind,
): string {
  const sessionHash = createHash('sha256')
    .update(sessionId)
    .digest('hex')
    .slice(0, 12);
  const token = randomBytes(12).toString('hex');
  return `livemedia_${kind}_${sessionHash}_${token}`;
}

export function parseOpaqueMediaRef(ref: string): {
  kind: MediaKind;
  sessionHash: string;
  token: string;
} {
  const m = /^livemedia_(clip|thumb|fragment|tmp)_([a-f0-9]{12})_([a-f0-9]{24})$/.exec(
    ref,
  );
  if (!m) {
    throw new Error(`Invalid opaque media ref: ${ref}`);
  }
  return {
    kind: m[1] as MediaKind,
    sessionHash: m[2]!,
    token: m[3]!,
  };
}

export function mediaPathForRef(
  sessionDir: string,
  ref: string,
  ext: string,
): string {
  const parsed = parseOpaqueMediaRef(ref);
  const file = `${parsed.kind}_${parsed.token}${ext.startsWith('.') ? ext : `.${ext}`}`;
  return assertPathInsideRoot(sessionDir, path.join(sessionDir, 'media', file));
}

export function ensureSessionSpoolLayout(sessionDir: string): void {
  fs.mkdirSync(path.join(sessionDir, 'media'), { recursive: true });
  fs.mkdirSync(path.join(sessionDir, 'fragments'), { recursive: true });
  fs.mkdirSync(path.join(sessionDir, 'tmp'), { recursive: true });
  fs.mkdirSync(path.join(sessionDir, 'private'), { recursive: true, mode: 0o700 });
}

/** Per-epoch capture working directory (A-07: isolate playlist/segment names). */
export function epochFragmentDir(sessionDir: string, streamEpoch: number): string {
  if (!Number.isInteger(streamEpoch) || streamEpoch < 1) {
    throw new Error(`Invalid stream epoch: ${streamEpoch}`);
  }
  return path.join(sessionDir, 'fragments', `e${streamEpoch}`);
}

/** Ensure a fresh epoch fragment directory exists (empty playlist namespace). */
export function ensureEpochFragmentDir(
  sessionDir: string,
  streamEpoch: number,
): string {
  const dir = epochFragmentDir(sessionDir, streamEpoch);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Resolve and verify a path opened for serving stays under sessionDir (no symlink escape). */
export function resolveSpoolFileForServe(
  sessionDir: string,
  absolutePath: string,
): string {
  const realSession = fs.realpathSync(sessionDir);
  const realFile = fs.realpathSync(absolutePath);
  return assertPathInsideRoot(realSession, realFile);
}
