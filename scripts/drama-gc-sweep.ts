/**
 * Operator sweep for aged drama crash orphans (I7, todo/35 P3 backend).
 * Deletes disposable `frames`/`work`/`tmp` dirs under
 * MEDIA_ROOT/media/<videoId>/drama/<runId> that are older than the age
 * guard. The age gate is the active-run exclusion — actively-written runs
 * are fresh and skipped. Bounded: --max-dirs caps deletions, --max-runs
 * caps scanning. Run on a schedule or by hand; terminal enrichment runs
 * already clean their own video.
 *
 * `--trimmed-runs=report` additionally lists whole run directories that the
 * asset no longer references (dropped from the retained run history, todo/50
 * F8); `--trimmed-runs=delete` removes them. Requires Elasticsearch.
 * `--max-trimmed-runs` caps candidates per invocation; `--max-runs` also
 * caps how many videos that pass looks up.
 *
 * Usage: yarn drama-gc-sweep [--media-root=...] [--max-dirs=100] [--max-runs=500]
 *        [--trimmed-runs=report|delete] [--max-trimmed-runs=50]
 */
import { loadDotenv } from './load-dotenv';

loadDotenv();

import { getConfig } from '../lib/config';
import { getDramaEnv } from '../lib/drama/env';
import { sweepAgedDramaOrphans } from '../lib/drama/frame-gc';
import { sweepTrimmedDramaRuns } from '../lib/drama/trimmed-run-gc';
import { getAsset } from '../lib/es/index-assets';

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
  const trimmedMode = arg('trimmed-runs');
  const maxTrimmedRuns = Number(arg('max-trimmed-runs') ?? '50');
  if (!Number.isInteger(maxDirs) || maxDirs <= 0) {
    throw new Error('--max-dirs must be a positive integer');
  }
  if (!Number.isInteger(maxRuns) || maxRuns <= 0) {
    throw new Error('--max-runs must be a positive integer');
  }
  if (trimmedMode !== undefined && trimmedMode !== 'report' && trimmedMode !== 'delete') {
    throw new Error('--trimmed-runs must be report or delete');
  }
  if (!Number.isInteger(maxTrimmedRuns) || maxTrimmedRuns <= 0) {
    throw new Error('--max-trimmed-runs must be a positive integer');
  }
  const result = sweepAgedDramaOrphans({
    mediaRoot,
    maxDirs,
    maxScanRuns: maxRuns,
  });
  const trimmedRuns = trimmedMode
    ? await sweepTrimmedDramaRuns({
        mediaRoot,
        getAsset,
        minAgeMs: getDramaEnv().DRAMA_GC_MIN_AGE_MS,
        apply: trimmedMode === 'delete',
        maxRuns: maxTrimmedRuns,
        maxScanVideos: maxRuns,
      })
    : undefined;
  console.log(
    JSON.stringify(
      { ok: true, mediaRoot, ...result, ...(trimmedRuns ? { trimmedRuns } : {}) },
      null,
      2,
    ),
  );
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
