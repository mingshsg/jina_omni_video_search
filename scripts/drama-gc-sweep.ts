/**
 * Operator sweep for aged drama crash orphans (I7, todo/35 P3 backend).
 * Deletes disposable `frames`/`work`/`tmp` dirs under
 * MEDIA_ROOT/media/<videoId>/drama/<runId> that are older than the age
 * guard. The age gate is the active-run exclusion — actively-written runs
 * are fresh and skipped. Bounded: --max-dirs caps deletions, --max-runs
 * caps scanning. Run on a schedule or by hand; terminal enrichment runs
 * already clean their own video.
 *
 * Usage: yarn drama-gc-sweep [--media-root=...] [--max-dirs=100] [--max-runs=500]
 */
import { loadDotenv } from './load-dotenv';

loadDotenv();

import { getConfig } from '../lib/config';
import { sweepAgedDramaOrphans } from '../lib/drama/frame-gc';

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  for (const a of process.argv.slice(2)) {
    if (a.startsWith(prefix)) return a.slice(prefix.length);
  }
  return undefined;
}

async function main(): Promise<void> {
  const cfg = getConfig();
  const mediaRoot = arg('media-root') ?? cfg.MEDIA_ROOT;
  const maxDirs = Number(arg('max-dirs') ?? '100');
  const maxRuns = Number(arg('max-runs') ?? '500');
  if (!Number.isInteger(maxDirs) || maxDirs <= 0) {
    throw new Error('--max-dirs must be a positive integer');
  }
  if (!Number.isInteger(maxRuns) || maxRuns <= 0) {
    throw new Error('--max-runs must be a positive integer');
  }
  const result = sweepAgedDramaOrphans({
    mediaRoot,
    maxDirs,
    maxScanRuns: maxRuns,
  });
  console.log(JSON.stringify({ ok: true, mediaRoot, ...result }, null, 2));
}

main().catch((err) => {
  console.error(
    JSON.stringify({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }),
  );
  process.exit(1);
});
