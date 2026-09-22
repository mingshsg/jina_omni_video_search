import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { WorktreeIdentity } from '../lib/live/readiness-gates';

function git(cmd: string[], cwd = process.cwd()): string {
  try {
    return execFileSync('git', cmd, { cwd, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

/**
 * Record commit + dirty porcelain + content hash (A-05 / V-02).
 * Dirty hash includes untracked file bytes (completion A-03 / V-01).
 */
export function collectWorktreeIdentity(cwd = process.cwd()): WorktreeIdentity {
  const commit = git(['rev-parse', 'HEAD'], cwd);
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
  const status_short = git(['status', '--porcelain=v1'], cwd);
  const diff = git(['diff'], cwd);
  const cached = git(['diff', '--cached'], cwd);
  const dirty = status_short.length > 0;
  const hasher = createHash('sha256');
  hasher.update(status_short);
  hasher.update('\n---\n');
  hasher.update(diff);
  hasher.update('\n---\n');
  hasher.update(cached);
  hasher.update('\n---untracked---\n');
  const untracked = git(
    ['ls-files', '--others', '--exclude-standard', '-z'],
    cwd,
  );
  const files = untracked
    ? untracked.split('\0').filter(Boolean).sort()
    : [];
  for (const rel of files) {
    hasher.update(rel);
    hasher.update('\0');
    try {
      hasher.update(fs.readFileSync(path.join(cwd, rel)));
    } catch {
      hasher.update('unreadable');
    }
    hasher.update('\n');
  }
  const content_hash = hasher.digest('hex').slice(0, 16);
  return {
    commit,
    branch,
    dirty,
    status_short: status_short.slice(0, 4000),
    content_hash: dirty ? content_hash : `clean:${commit.slice(0, 12)}`,
  };
}
