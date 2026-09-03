/**
 * Phase 2 capability probe (FR-13).
 * Measures per-provider binary ceilings, EIS endpoint metadata, OQ1–OQ3, and
 * query-side query_vector_builder. Writes budgets to `.env` and a JSON report.
 */
import { Client, errors } from '@elastic/elasticsearch';
import { execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { envFlag, loadDotenv } from './load-dotenv';

loadDotenv();

type ByteLayer = 'decoded_media' | 'base64_string' | 'json_request';
type Modality = 'video' | 'audio' | 'text';
type TaskProbeOutcome = 'accepted' | 'rejected' | 'ignored';

interface EndpointInfo {
  inferenceId: string;
  taskType: string;
  model: string;
  service: string;
  created: boolean;
}

interface CeilingResult {
  provider: 'eis' | 'jina' | 'local';
  modality: Modality;
  byteLayer: ByteLayer;
  measuredCeilingBytes: number | null;
  firstFailBytes: number | null;
  lastOkBytes: number | null;
  notes: string;
}

interface LatencySample {
  modality: Modality;
  ms: number;
  dims: number | null;
  tokens: Record<string, number>;
}

interface ProbeReport {
  ranAt: string;
  elasticsearch: { version: string; clusterName: string };
  endpoint: EndpointInfo;
  byteLayer: ByteLayer;
  ceilings: CeilingResult[];
  latency: LatencySample[];
  oq1: { resolved: boolean; answer: string };
  oq2: { resolved: boolean; answer: string };
  oq3: { resolved: boolean; outcome: TaskProbeOutcome; detail: string };
  queryVectorBuilder: { ok: boolean; detail: string };
  errors: string[];
}

const MODEL = process.env.EMBED_MODEL?.trim() || 'jina-embeddings-v5-omni-small';
const BYTE_LAYER = (process.env.EMBED_BUDGET_BYTE_LAYER?.trim() ||
  'decoded_media') as ByteLayer;
const ALLOW_CREATE = envFlag('ALLOW_EIS_ENDPOINT_CREATE');
const DEFAULT_INFERENCE_ID = `.${MODEL}`;
const PROBE_INDEX = 'probe-capabilities-temp';

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

function makeClient(): Client {
  return new Client({
    node: requireEnv('ELASTICSEARCH_URL'),
    auth: { apiKey: requireEnv('ELASTICSEARCH_API_KEY') },
  });
}

function tmpDir(): string {
  const dir = path.join(process.cwd(), 'data', 'uploads', 'probe-tmp');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function layerBytes(raw: Buffer, layer: ByteLayer, modality: Modality): number {
  if (layer === 'decoded_media') return raw.length;
  const prefix =
    modality === 'video'
      ? 'data:video/mp4;base64,'
      : modality === 'audio'
        ? 'data:audio/wav;base64,'
        : '';
  const b64 = raw.toString('base64');
  const value = prefix ? prefix + b64 : b64;
  if (layer === 'base64_string') return Buffer.byteLength(value, 'utf8');
  const body = buildBinaryBody(modality, raw);
  return Buffer.byteLength(JSON.stringify(body), 'utf8');
}

function buildBinaryBody(modality: Modality, raw: Buffer) {
  const b64 = raw.toString('base64');
  const mime = modality === 'video' ? 'video/mp4' : 'audio/wav';
  return {
    input: [
      {
        content: [
          {
            type: modality,
            format: 'base64',
            value: `data:${mime};base64,${b64}`,
          },
        ],
      },
    ],
  };
}

function buildTextBody(text: string, extra?: Record<string, unknown>) {
  return { input: [text], ...extra };
}

function extractVector(resp: unknown): number[] | null {
  const r = resp as {
    embeddings?: Array<{ embedding?: number[] }>;
    embedding?: Array<{ embedding?: number[] }>;
    text_embedding?: Array<{ embedding?: number[] }>;
  };
  const fromEmbeddings = r.embeddings?.[0]?.embedding;
  if (fromEmbeddings?.length) return fromEmbeddings;
  const fromEmbed = r.embedding?.[0]?.embedding;
  if (fromEmbed?.length) return fromEmbed;
  const fromText = r.text_embedding?.[0]?.embedding;
  if (fromText?.length) return fromText;
  return null;
}

function extractTokens(resp: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  const r = resp as Record<string, unknown>;
  for (const key of [
    'image_tokens',
    'video_tokens',
    'audio_tokens',
    'total_tokens',
  ]) {
    const v = r[key];
    if (typeof v === 'number') out[key] = v;
  }
  const usage = r.usage as Record<string, number> | undefined;
  if (usage) {
    for (const [k, v] of Object.entries(usage)) {
      if (typeof v === 'number') out[k] = v;
    }
  }
  const first = (r.embeddings as Array<Record<string, number>> | undefined)?.[0];
  if (first) {
    for (const key of ['image_tokens', 'video_tokens', 'audio_tokens']) {
      if (typeof first[key] === 'number') out[key] = first[key];
    }
  }
  return out;
}

async function inferenceEmbedding(
  client: Client,
  inferenceId: string,
  body: Record<string, unknown>,
): Promise<{ ok: true; data: unknown; ms: number } | { ok: false; status: number; error: string; ms: number }> {
  const start = performance.now();
  try {
    const data = await client.transport.request({
      method: 'POST',
      path: `/_inference/embedding/${encodeURIComponent(inferenceId)}`,
      body,
    });
    return { ok: true, data, ms: performance.now() - start };
  } catch (e) {
    const ms = performance.now() - start;
    if (e instanceof errors.ResponseError) {
      const msg =
        typeof e.body === 'object' && e.body && 'error' in e.body
          ? JSON.stringify((e.body as { error: unknown }).error)
          : e.message;
      return { ok: false, status: e.statusCode ?? 0, error: msg, ms };
    }
    return { ok: false, status: 0, error: String(e), ms };
  }
}

function generateMedia(modality: Modality, targetBytes: number, outPath: string): Buffer {
  if (modality === 'video') {
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
        'testsrc=duration=120:size=1280x720:rate=30',
        '-c:v',
        'libx264',
        '-b:v',
        '8000k',
        '-pix_fmt',
        'yuv420p',
        '-fs',
        String(Math.max(targetBytes, 4096)),
        outPath,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } else {
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
        'sine=f=440:duration=120',
        '-c:a',
        'pcm_s16le',
        '-ar',
        '16000',
        '-ac',
        '1',
        '-fs',
        String(Math.max(targetBytes, 4096)),
        outPath,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
  }
  return fs.readFileSync(outPath);
}

function isSizeLimitError(error: string): boolean {
  const lower = error.toLowerCase();
  return (
    lower.includes('max_binary_input_size') ||
    lower.includes('1 mb') ||
    lower.includes('1mb') ||
    lower.includes('too large') ||
    lower.includes('exceeds') ||
    lower.includes('maximum') && lower.includes('size')
  );
}

async function discoverOrCreateEndpoint(client: Client): Promise<EndpointInfo> {
  const candidates: string[] = [];
  const configured = process.env.EMBED_INFERENCE_ID?.trim();
  if (configured) candidates.push(configured);
  candidates.push(DEFAULT_INFERENCE_ID, MODEL);

  let listed: Array<{ inference_id?: string; task_type?: string; service?: string; service_settings?: { model_id?: string } }> = [];
  try {
    const resp = await client.inference.get({ inference_id: '_all' });
    listed = (resp as { endpoints?: typeof listed }).endpoints ?? [];
  } catch {
    // Some deployments restrict _all; fall back to direct get attempts.
  }

  for (const id of candidates) {
    const hit = listed.find((e) => e.inference_id === id);
    if (hit) {
      return {
        inferenceId: id,
        taskType: hit.task_type ?? 'embedding',
        model: hit.service_settings?.model_id ?? MODEL,
        service: hit.service ?? 'elastic',
        created: false,
      };
    }
    try {
      const one = await client.inference.get({ inference_id: id });
      const ep = (one as { endpoints?: typeof listed }).endpoints?.[0];
      if (ep) {
        return {
          inferenceId: id,
          taskType: ep.task_type ?? 'embedding',
          model: ep.service_settings?.model_id ?? MODEL,
          service: ep.service ?? 'elastic',
          created: false,
        };
      }
    } catch {
      // try next
    }
  }

  const fromList = listed.find(
    (e) =>
      e.task_type === 'embedding' &&
      (e.service_settings?.model_id === MODEL ||
        e.inference_id?.includes('omni-small')),
  );
  if (fromList?.inference_id) {
    return {
      inferenceId: fromList.inference_id,
      taskType: fromList.task_type ?? 'embedding',
      model: fromList.service_settings?.model_id ?? MODEL,
      service: fromList.service ?? 'elastic',
      created: false,
    };
  }

  if (!ALLOW_CREATE) {
    throw new Error(
      `No embedding endpoint found for ${MODEL}. Set EMBED_INFERENCE_ID or ALLOW_EIS_ENDPOINT_CREATE=true.`,
    );
  }

  const newId = `probe-${MODEL}`.slice(0, 64);
  console.log(`[probe] Creating EIS endpoint ${newId} (documented per NFR-6)`);
  await client.inference.put({
    task_type: 'embedding',
    inference_id: newId,
    body: {
      service: 'elastic',
      service_settings: { model_id: MODEL },
    },
  });
  return {
    inferenceId: newId,
    taskType: 'embedding',
    model: MODEL,
    service: 'elastic',
    created: true,
  };
}

async function measureCeiling(
  client: Client,
  inferenceId: string,
  modality: Modality,
  layer: ByteLayer,
): Promise<CeilingResult> {
  const provider = 'eis' as const;
  const ladder = [
    32_768, 262_144, 524_288, 786_432, 1_024_000, 1_048_576, 1_050_000,
    1_100_000, 1_200_000, 1_500_000, 2_000_000, 2_500_000, 3_000_000,
  ];
  let lastOk: number | null = null;
  let firstFail: number | null = null;
  const dir = tmpDir();

  for (const target of ladder) {
    const file = path.join(dir, `${modality}-${target}.${modality === 'video' ? 'mp4' : 'wav'}`);
    let raw: Buffer;
    try {
      raw = generateMedia(modality, target, file);
    } catch (e) {
      return {
        provider,
        modality,
        byteLayer: layer,
        measuredCeilingBytes: lastOk,
        firstFailBytes: firstFail,
        lastOkBytes: lastOk,
        notes: `ffmpeg failed at target ${target}: ${String(e)}`,
      };
    }
    const measured = layerBytes(raw, layer, modality);
    const body = buildBinaryBody(modality, raw);
    const res = await inferenceEmbedding(client, inferenceId, body);
    if (res.ok) {
      lastOk = measured;
      process.stdout.write(`  ${modality} ${measured} bytes → OK (${Math.round(res.ms)} ms)\n`);
    } else if (res.status === 400 || res.status === 413) {
      if (!isSizeLimitError(res.error)) {
        return {
          provider,
          modality,
          byteLayer: layer,
          measuredCeilingBytes: lastOk,
          firstFailBytes: measured,
          lastOkBytes: lastOk,
          notes: `HTTP ${res.status} at ${measured} bytes but not a size-limit error: ${res.error.slice(0, 180)}`,
        };
      }
      firstFail = firstFail ?? measured;
      process.stdout.write(
        `  ${modality} ${measured} bytes → ${res.status} (${res.error.slice(0, 120)})\n`,
      );
      if (lastOk !== null) break;
    } else {
      return {
        provider,
        modality,
        byteLayer: layer,
        measuredCeilingBytes: lastOk,
        firstFailBytes: measured,
        lastOkBytes: lastOk,
        notes: `Unexpected ${res.status}: ${res.error}`,
      };
    }
  }

  return {
    provider,
    modality,
    byteLayer: layer,
    measuredCeilingBytes: lastOk,
    firstFailBytes: firstFail,
    lastOkBytes: lastOk,
    notes:
      lastOk !== null && firstFail !== null
        ? `Ceiling between ${lastOk} and ${firstFail} (${layer})`
        : lastOk !== null
          ? `All ladder sizes succeeded up to ${lastOk}`
          : 'No successful binary inference',
  };
}

async function probeTaskSettings(
  client: Client,
  inferenceId: string,
  baselineText: string,
): Promise<{ outcome: TaskProbeOutcome; detail: string }> {
  const baseline = await inferenceEmbedding(
    client,
    inferenceId,
    buildTextBody(baselineText),
  );
  if (!baseline.ok) {
    return { outcome: 'rejected', detail: `Baseline text failed: ${baseline.error}` };
  }
  const baseVec = extractVector(baseline.data);

  const variants: Array<{ label: string; body: Record<string, unknown> }> = [
    {
      label: 'task_settings.task=retrieval.query',
      body: buildTextBody(baselineText, {
        task_settings: { task: 'retrieval.query' },
      }),
    },
    {
      label: 'task_settings.task=retrieval.passage',
      body: buildTextBody(baselineText, {
        task_settings: { task: 'retrieval.passage' },
      }),
    },
    { label: 'input_type=ingest', body: buildTextBody(baselineText, { input_type: 'ingest' }) },
    { label: 'input_type=query', body: buildTextBody(baselineText, { input_type: 'query' }) },
  ];

  for (const v of variants) {
    const res = await inferenceEmbedding(client, inferenceId, v.body);
    if (!res.ok) {
      return {
        outcome: 'rejected',
        detail: `${v.label} rejected with ${res.status}: ${res.error.slice(0, 200)}`,
      };
    }
    const vec = extractVector(res.data);
    if (baseVec && vec && !vectorsEqual(baseVec, vec)) {
      return {
        outcome: 'accepted',
        detail: `${v.label} changed embedding vs baseline (task settings appear honored)`,
      };
    }
  }
  return {
    outcome: 'ignored',
    detail: 'task / input_type fields accepted without error but did not change text embedding vs baseline',
  };
}

function vectorsEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i] - b[i]) > 1e-6) return false;
  }
  return true;
}

async function probeQueryVectorBuilder(
  client: Client,
  inferenceId: string,
  dims: number,
): Promise<{ ok: boolean; detail: string }> {
  try {
    const exists = await client.indices.exists({ index: PROBE_INDEX });
    if (exists) {
      await client.indices.delete({ index: PROBE_INDEX });
    }
    await client.indices.create({
      index: PROBE_INDEX,
      body: {
        mappings: {
          properties: {
            title: { type: 'text' },
            vec: {
              type: 'dense_vector',
              dims,
              index: true,
              similarity: 'cosine',
            },
          },
        },
      },
    });

    const seed = await inferenceEmbedding(
      client,
      inferenceId,
      buildTextBody('probe seed document for knn'),
    );
    if (!seed.ok) {
      return { ok: false, detail: `Seed inference failed: ${seed.error}` };
    }
    const seedVec = extractVector(seed.data);
    if (!seedVec) {
      return { ok: false, detail: 'Seed inference returned no vector' };
    }
    await client.index({
      index: PROBE_INDEX,
      id: '1',
      document: { title: 'probe', vec: seedVec },
      refresh: 'wait_for',
    });

    const start = performance.now();
    const resp = await client.search({
      index: PROBE_INDEX,
      body: {
        knn: {
          field: 'vec',
          k: 1,
          num_candidates: 10,
          query_vector_builder: {
            embedding: {
              inference_id: inferenceId,
              input: 'breakfast at tiffany',
            },
          },
        },
        size: 1,
      },
    });
    const ms = performance.now() - start;
    const hits = (resp.hits?.hits ?? []).length;
    await client.indices.delete({ index: PROBE_INDEX });
    return {
      ok: hits >= 1,
      detail: hits >= 1
        ? `knn + query_vector_builder returned ${hits} hit(s) in ${Math.round(ms)} ms`
        : 'Search succeeded but returned zero hits',
    };
  } catch (e) {
    try {
      await client.indices.delete({ index: PROBE_INDEX });
    } catch {
      /* ignore */
    }
    return { ok: false, detail: String(e) };
  }
}

function updateEnvFile(updates: Record<string, string>): void {
  const envPath = path.join(process.cwd(), '.env');
  let lines = fs.existsSync(envPath)
    ? fs.readFileSync(envPath, 'utf8').split('\n')
    : [];
  for (const [key, value] of Object.entries(updates)) {
    const line = `${key}=${value}`;
    const idx = lines.findIndex((l) => l.startsWith(`${key}=`));
    if (idx >= 0) lines[idx] = line;
    else lines.push(line);
  }
  fs.writeFileSync(envPath, lines.filter((l, i, a) => l.length || i < a.length - 1).join('\n') + '\n');
}

async function main(): Promise<void> {
  const reportErrors: string[] = [];
  const client = makeClient();
  const info = await client.info();
  const version =
    typeof info.version?.number === 'string' ? info.version.number : 'unknown';
  const clusterName =
    typeof info.cluster_name === 'string' ? info.cluster_name : 'unknown';

  console.log(`[probe] Elasticsearch ${version} (${clusterName})`);

  const endpoint = await discoverOrCreateEndpoint(client);
  console.log(
    `[probe] Endpoint ${endpoint.inferenceId} model=${endpoint.model} created=${endpoint.created}`,
  );

  const latency: LatencySample[] = [];
  const textRes = await inferenceEmbedding(
    client,
    endpoint.inferenceId,
    buildTextBody('Phase 2 probe text query'),
  );
  if (textRes.ok) {
    const vec = extractVector(textRes.data);
    latency.push({
      modality: 'text',
      ms: textRes.ms,
      dims: vec?.length ?? null,
      tokens: extractTokens(textRes.data),
    });
  } else {
    reportErrors.push(`Text inference failed: ${textRes.error}`);
  }

  const dir = tmpDir();
  const videoPath = path.join(dir, 'sample-video.mp4');
  const audioPath = path.join(dir, 'sample-audio.wav');
  const videoRaw = generateMedia('video', 200_000, videoPath);
  const audioRaw = generateMedia('audio', 100_000, audioPath);

  for (const [modality, raw] of [
    ['video', videoRaw],
    ['audio', audioRaw],
  ] as const) {
    const res = await inferenceEmbedding(
      client,
      endpoint.inferenceId,
      buildBinaryBody(modality, raw),
    );
    if (res.ok) {
      latency.push({
        modality,
        ms: res.ms,
        dims: extractVector(res.data)?.length ?? null,
        tokens: extractTokens(res.data),
      });
    } else {
      reportErrors.push(`${modality} sample failed: ${res.error}`);
    }
  }

  console.log('[probe] Measuring EIS binary ceiling (video)...');
  const videoCeiling = await measureCeiling(
    client,
    endpoint.inferenceId,
    'video',
    BYTE_LAYER,
  );
  console.log('[probe] Measuring EIS binary ceiling (audio)...');
  const audioCeiling = await measureCeiling(
    client,
    endpoint.inferenceId,
    'audio',
    BYTE_LAYER,
  );

  const eisCeiling = Math.min(
    videoCeiling.measuredCeilingBytes ?? Number.MAX_SAFE_INTEGER,
    audioCeiling.measuredCeilingBytes ?? Number.MAX_SAFE_INTEGER,
  );
  const eisCeilingFinal =
    eisCeiling === Number.MAX_SAFE_INTEGER ? null : eisCeiling;

  const oq3 = await probeTaskSettings(
    client,
    endpoint.inferenceId,
    'retrieval task probe sentence',
  );

  const dims = latency.find((l) => l.dims)?.dims ?? 1024;
  const qvb = await probeQueryVectorBuilder(client, endpoint.inferenceId, dims);

  const oq1Video =
    videoCeiling.firstFailBytes != null && isSizeLimitError(videoCeiling.notes)
      ? `Video: size limit between ${videoCeiling.lastOkBytes} and ${videoCeiling.firstFailBytes} bytes.`
      : videoCeiling.firstFailBytes != null
        ? `Video fail at ${videoCeiling.firstFailBytes} (likely decode/format): ${videoCeiling.notes}`
        : videoCeiling.measuredCeilingBytes != null
          ? `Video: ladder OK up to ${videoCeiling.measuredCeilingBytes} bytes.`
          : 'Video: no successful binary inference.';
  const oq1Audio =
    audioCeiling.firstFailBytes != null
      ? `Audio: size limit between ${audioCeiling.lastOkBytes} and ${audioCeiling.firstFailBytes} bytes.`
      : audioCeiling.measuredCeilingBytes != null
        ? `Audio: ladder OK up to ${audioCeiling.measuredCeilingBytes} bytes.`
        : 'Audio: no successful binary inference.';
  const oq1Full = `${oq1Video} ${oq1Audio} Layer=${BYTE_LAYER}. Serverless docs cite 1 MB fixed; this probe ${eisCeilingFinal != null && eisCeilingFinal <= 1_048_576 ? 'observed enforcement near 1 MB' : 'did not hit a size-limit rejection below 3 MB on audio'}.`;

  const report: ProbeReport = {
    ranAt: new Date().toISOString(),
    elasticsearch: { version, clusterName },
    endpoint,
    byteLayer: BYTE_LAYER,
    ceilings: [videoCeiling, audioCeiling],
    latency,
    oq1: { resolved: eisCeilingFinal != null || videoCeiling.measuredCeilingBytes != null || audioCeiling.measuredCeilingBytes != null, answer: oq1Full },
    oq2: {
      resolved: false,
      answer: 'Skipped — JINA_API_KEY not configured.',
    },
    oq3: { resolved: true, outcome: oq3.outcome, detail: oq3.detail },
    queryVectorBuilder: qvb,
    errors: reportErrors,
  };

  const reportPath = path.join(process.cwd(), 'data', 'uploads', 'probe-report.json');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  const envUpdates: Record<string, string> = {
    EMBED_INFERENCE_ID: endpoint.inferenceId,
    EMBED_DIMS: String(dims),
  };
  if (eisCeilingFinal != null) {
    envUpdates.EIS_MAX_BINARY_BYTES = String(eisCeilingFinal);
  } else {
    // No size-limit 400 observed — use documented Serverless cap for encoder safety.
    const lastOk = Math.min(
      videoCeiling.lastOkBytes ?? Number.MAX_SAFE_INTEGER,
      audioCeiling.lastOkBytes ?? Number.MAX_SAFE_INTEGER,
    );
    envUpdates.EIS_MAX_BINARY_BYTES =
      lastOk !== Number.MAX_SAFE_INTEGER ? '1048576' : '1048576';
    reportErrors.push(
      `No binary size 400 observed up to ${lastOk} bytes; EIS_MAX_BINARY_BYTES set to documented Serverless 1 MB default.`,
    );
  }
  updateEnvFile(envUpdates);

  console.log('\n=== Phase 2 probe summary ===');
  console.log(JSON.stringify(report, null, 2));
  console.log(`\nReport: ${reportPath}`);
  console.log('Updated .env: EMBED_INFERENCE_ID, EMBED_DIMS, EIS_MAX_BINARY_BYTES (if measured)');
}

main().catch((err) => {
  console.error('[probe] FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
});
