import { loadConfig } from '../config';
import { variantConfigFromApp, deriveVariantId, proxySettingsForEs } from '../ingest/variant';
import { pcmToWav } from './prepare-audio';
export function voiceTestConfig() {
  return loadConfig({ NODE_ENV: 'test', ELASTICSEARCH_URL: 'https://example.invalid', ELASTICSEARCH_API_KEY: 'test-only',
    EMBED_INFERENCE_ID: 'test-omni', EIS_MAX_BINARY_BYTES: '1000000' });
}
export function testVariant(cfg = voiceTestConfig()) {
  const config = variantConfigFromApp(cfg);
  return { variant_id: deriveVariantId(config), status: 'ready', provider: config.provider, model: config.model,
    task: config.task, dims: config.dims, normalized_by: config.normalizedBy, schema_version: config.schemaVersion,
    chunk_preset: config.chunking.preset, chunk_window_ms: config.chunking.windowMs, chunk_overlap_ms: config.chunking.overlapMs,
    chunk_min_ms: config.chunking.minMs, proxy_settings: proxySettingsForEs(config.proxySettings) };
}
export function testWav(ms = 1200) {
  const pcm = Buffer.alloc(Math.floor(ms * 32));
  for (let i = 0; i < pcm.length / 2; i++) pcm.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 440 / 16000) * 1000), i * 2);
  return pcmToWav(pcm);
}
