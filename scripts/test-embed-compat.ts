/**
 * Phase 4 acceptance — exercise configured embedding provider(s) on minimal
 * text / video / audio fixtures and report per-modality cosine similarities.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../lib/config';
import {
  assertVariantEmbeddingStack,
  cosineSimilarity,
  createEmbeddingProvider,
  createEisEmbeddingProvider,
  createJinaEmbeddingProvider,
  createLocalEmbeddingProvider,
  isJinaConfigured,
  isLocalConfigured,
  VariantIsolationError,
  type EmbeddingProvider,
  type ProviderIdentity,
} from '../lib/embed/provider';
import { loadDotenv } from './load-dotenv';

loadDotenv();

interface ModalityReport {
  ok: boolean;
  dims: number | null;
  latencyMs: number | null;
  tokens: Record<string, number>;
  passageQuerySimilarity: number | null;
  error?: string;
}

interface ProviderReport {
  provider: string;
  configured: boolean;
  skippedReason?: string;
  text: ModalityReport;
  video: ModalityReport;
  audio: ModalityReport;
  isolationPolicyOk: boolean | null;
}

const FIXTURE_TEXT =
  'Phase 4 compatibility probe: a cat resting on a sunny windowsill.';

function tmpDir(): string {
  const dir = path.join(process.cwd(), 'data', 'uploads', 'embed-compat-tmp');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function hasFfmpeg(): boolean {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: ['ignore', 'ignore', 'pipe'] });
    return true;
  } catch {
    return false;
  }
}

function tinyVideo(outPath: string): Buffer {
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'testsrc=duration=2:size=320x240:rate=10',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      outPath,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  return fs.readFileSync(outPath);
}

function tinyAudio(outPath: string): Buffer {
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=f=440:duration=1',
      '-c:a',
      'pcm_s16le',
      '-ar',
      '16000',
      '-ac',
      '1',
      outPath,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  return fs.readFileSync(outPath);
}

async function exerciseModality(
  provider: EmbeddingProvider,
  modality: 'text' | 'video' | 'audio',
  fixtures: { video?: Buffer; audio?: Buffer },
): Promise<ModalityReport> {
  try {
    let passage;
    let query;
    if (modality === 'text') {
      [passage, query] = await Promise.all([
        provider.embedText(FIXTURE_TEXT, 'passage'),
        provider.embedText(FIXTURE_TEXT, 'query'),
      ]);
    } else if (modality === 'video') {
      if (!fixtures.video) {
        return {
          ok: false,
          dims: null,
          latencyMs: null,
          tokens: {},
          passageQuerySimilarity: null,
          error: 'video fixture unavailable (ffmpeg missing)',
        };
      }
      passage = await provider.embedVideo(fixtures.video, 'passage');
      query = passage;
    } else {
      if (!fixtures.audio) {
        return {
          ok: false,
          dims: null,
          latencyMs: null,
          tokens: {},
          passageQuerySimilarity: null,
          error: 'audio fixture unavailable (ffmpeg missing)',
        };
      }
      passage = await provider.embedAudio(fixtures.audio, 'passage');
      query = passage;
    }

    const sim =
      modality === 'text'
        ? cosineSimilarity(passage.embedding, query.embedding)
        : null;

    return {
      ok: true,
      dims: passage.embedding.length,
      latencyMs: Math.round(passage.latencyMs),
      tokens: passage.tokens as Record<string, number>,
      passageQuerySimilarity:
        sim !== null ? Math.round(sim * 10_000) / 10_000 : null,
    };
  } catch (err) {
    return {
      ok: false,
      dims: null,
      latencyMs: null,
      tokens: {},
      passageQuerySimilarity: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function providerFactory(
  name: 'eis' | 'jina' | 'local',
  cfg: ReturnType<typeof loadConfig>,
): EmbeddingProvider | null {
  const merged = { ...process.env, EMBED_PROVIDER: name };
  const providerCfg = loadConfig(merged);
  switch (name) {
    case 'eis':
      return createEisEmbeddingProvider(providerCfg);
    case 'jina':
      return createJinaEmbeddingProvider(providerCfg);
    case 'local':
      return createLocalEmbeddingProvider(providerCfg);
  }
}

function canRunProvider(name: 'eis' | 'jina' | 'local', cfg: ReturnType<typeof loadConfig>): string | null {
  if (name === 'eis') {
    if (!cfg.ELASTICSEARCH_URL || !cfg.ELASTICSEARCH_API_KEY) {
      return 'missing Elasticsearch credentials';
    }
    if (!cfg.EMBED_INFERENCE_ID) return 'EMBED_INFERENCE_ID not set';
    return null;
  }
  if (name === 'jina') {
    return isJinaConfigured(cfg) ? null : 'JINA_API_KEY not configured';
  }
  return isLocalConfigured(cfg) ? null : 'LOCAL_EMBED_URL not configured';
}

async function runProvider(
  name: 'eis' | 'jina' | 'local',
  cfg: ReturnType<typeof loadConfig>,
  fixtures: { video?: Buffer; audio?: Buffer },
): Promise<ProviderReport> {
  const skip = canRunProvider(name, cfg);
  if (skip) {
    return {
      provider: name,
      configured: false,
      skippedReason: skip,
      text: emptyModality(),
      video: emptyModality(),
      audio: emptyModality(),
      isolationPolicyOk: null,
    };
  }

  const provider = providerFactory(name, cfg)!;
  const [text, video, audio] = await Promise.all([
    exerciseModality(provider, 'text', fixtures),
    exerciseModality(provider, 'video', fixtures),
    exerciseModality(provider, 'audio', fixtures),
  ]);

  let isolationPolicyOk: boolean | null = null;
  try {
    assertVariantEmbeddingStack(
      {
        provider: 'jina',
        model: provider.model,
        task: provider.task,
        dims: provider.dims,
      },
      provider,
    );
    isolationPolicyOk = false;
  } catch (err) {
    isolationPolicyOk = err instanceof VariantIsolationError;
  }

  return {
    provider: name,
    configured: true,
    text,
    video,
    audio,
    isolationPolicyOk,
  };
}

function emptyModality(): ModalityReport {
  return {
    ok: false,
    dims: null,
    latencyMs: null,
    tokens: {},
    passageQuerySimilarity: null,
  };
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const active = cfg.EMBED_PROVIDER;
  const dir = tmpDir();
  const fixtures: { video?: Buffer; audio?: Buffer } = {};

  if (hasFfmpeg()) {
    fixtures.video = tinyVideo(path.join(dir, 'compat-video.mp4'));
    fixtures.audio = tinyAudio(path.join(dir, 'compat-audio.wav'));
  } else {
    console.warn('[embed-compat] ffmpeg not found — video/audio fixtures skipped');
  }

  const providers: Array<'eis' | 'jina' | 'local'> = ['eis', 'jina', 'local'];
  const reports: ProviderReport[] = [];
  for (const name of providers) {
    reports.push(await runProvider(name, cfg, fixtures));
  }

  const activeProvider = createEmbeddingProvider(cfg);
  const activeIdentity: ProviderIdentity = {
    provider: activeProvider.provider,
    model: activeProvider.model,
    task: activeProvider.task,
    dims: activeProvider.dims,
    normalizedBy: activeProvider.normalizedBy,
  };

  assertVariantEmbeddingStack(
    {
      provider: activeIdentity.provider,
      model: activeIdentity.model,
      task: activeIdentity.task,
      dims: activeIdentity.dims,
      normalizedBy: activeIdentity.normalizedBy,
    },
    activeIdentity,
  );

  const out = {
    ranAt: new Date().toISOString(),
    activeProvider: active,
    activeIdentity,
    reports,
  };

  const reportPath = path.join(process.cwd(), 'data', 'uploads', 'embed-compat-report.json');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(out, null, 2));

  console.log('=== Phase 4 embed compatibility ===\n');
  for (const r of reports) {
    if (!r.configured) {
      console.log(`${r.provider}: SKIPPED (${r.skippedReason})`);
      continue;
    }
    console.log(`${r.provider}:`);
    for (const mod of ['text', 'video', 'audio'] as const) {
      const m = r[mod];
      if (m.ok) {
        const tok = Object.keys(m.tokens).length
          ? ` tokens=${JSON.stringify(m.tokens)}`
          : '';
        const sim =
          m.passageQuerySimilarity != null
            ? ` passage↔query cos=${m.passageQuerySimilarity}`
            : '';
        console.log(
          `  ${mod}: OK dims=${m.dims} ${m.latencyMs}ms${sim}${tok}`,
        );
      } else {
        console.log(`  ${mod}: FAIL — ${m.error}`);
      }
    }
    console.log(
      `  isolation policy rejects cross-provider: ${r.isolationPolicyOk ? 'yes' : 'no'}`,
    );
    console.log('');
  }

  console.log(`Report: ${reportPath}`);

  const activeReport = reports.find((r) => r.provider === active);
  if (!activeReport?.configured) {
    console.error(`Active provider ${active} is not runnable`);
    process.exit(1);
  }
  if (!activeReport.text.ok) {
    console.error(`Active provider ${active} text path failed`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[embed-compat] FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
});
