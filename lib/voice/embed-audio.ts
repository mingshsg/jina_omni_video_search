import type { AppConfig } from '../config';
import { getEsClient } from '../es/client';
import { getEmbedConcurrencyGate } from '../embed/concurrency';
import { extractEmbeddingVector, extractTokenUsage } from '../embed/extract';
import { l2Normalize } from '../embed/normalize';
import { embedBudgetBytes } from '../video/budget';
import { VoiceError, throwIfAborted } from './errors';
import { readBoundedBody } from './request';

export function checkedAudioVector(value: unknown, dims: number, normalize: boolean): number[] {
  if (!Array.isArray(value) || value.length !== dims || value.some((n) => typeof n !== 'number' || !Number.isFinite(n)))
    throw new VoiceError('VOICE_PROVIDER_FAILED', 'Embedding provider returned an invalid vector.', 502);
  const norm = Math.sqrt(value.reduce((sum, n: number) => sum + n * n, 0));
  if (!Number.isFinite(norm) || norm === 0 || (!normalize && Math.abs(norm - 1) > 0.02))
    throw new VoiceError('VOICE_PROVIDER_FAILED', 'Embedding provider returned an invalid vector norm.', 502);
  return normalize ? l2Normalize(value) : value;
}

/** Query-only transport: same provider body as embedAudio, with real abort and bounded response.
 * No automatic retry: prevents duplicate costs after explicit voice submission.
 */
export async function embedQueryAudio(wav: Buffer, cfg: AppConfig, signal: AbortSignal) {
  throwIfAborted(signal);
  const dataUrl = `data:audio/wav;base64,${wav.toString('base64')}`;
  const body = cfg.EMBED_PROVIDER === 'eis'
    ? { input: [{ content: [{ type: 'audio', format: 'base64', value: dataUrl }] }] }
    : { model: cfg.EMBED_MODEL, task: cfg.EMBED_TASK_QUERY, ...(cfg.EMBED_PROVIDER === 'jina' ? { normalized: true, embedding_type: 'float' } : {}), input: [{ audio: dataUrl }] };
  const budget = embedBudgetBytes(cfg);
  const bytes = cfg.EMBED_BUDGET_BYTE_LAYER === 'decoded_media' ? wav.length
    : cfg.EMBED_BUDGET_BYTE_LAYER === 'base64_string' ? Buffer.byteLength(dataUrl) : Buffer.byteLength(JSON.stringify(body));
  if (bytes > budget) throw new VoiceError('VOICE_TOO_LARGE', 'Recording exceeds the verified provider budget.', 413);
  return getEmbedConcurrencyGate(cfg).run(async () => {
    throwIfAborted(signal);
    let data: unknown;
    try {
      if (cfg.EMBED_PROVIDER === 'eis') {
        data = await getEsClient().transport.request({ method: 'POST', path: `/_inference/embedding/${encodeURIComponent(cfg.EMBED_INFERENCE_ID)}`, body },
          { signal, maxRetries: 0, requestTimeout: 25000, maxResponseSize: 128 * 1024 });
      } else {
        const url = cfg.EMBED_PROVIDER === 'jina' ? 'https://api.jina.ai/v1/embeddings' : `${cfg.LOCAL_EMBED_URL.replace(/\/+$/, '')}/v1/embeddings`;
        const res = await fetch(url, { method: 'POST', redirect: 'error', signal,
          headers: { 'Content-Type': 'application/json', ...(cfg.EMBED_PROVIDER === 'jina' ? { Authorization: `Bearer ${cfg.JINA_API_KEY}` } : {}) }, body: JSON.stringify(body) });
        if (!res.ok) { await res.body?.cancel(); throw new VoiceError('VOICE_PROVIDER_FAILED', 'Embedding provider could not process this recording.', 502); }
        const bytes = await readBoundedBody(res.body, 128 * 1024, signal);
        data = JSON.parse(bytes.toString());
      }
      if (!data || typeof data !== 'object') throw new Error('Invalid provider response');
      return { vector: checkedAudioVector(extractEmbeddingVector(data), cfg.EMBED_DIMS, cfg.EMBED_PROVIDER === 'local'), usage: extractTokenUsage(data) };
    } catch (err) {
      throwIfAborted(signal);
      if (err instanceof VoiceError) throw err;
      throw new VoiceError('VOICE_PROVIDER_FAILED', 'Embedding provider could not process this recording.', 502);
    }
  }, signal);
}
