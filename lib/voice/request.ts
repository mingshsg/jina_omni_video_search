import { z } from 'zod';
import { parseSearchFilters, type NormalizedSearchFilters } from '../metadata/search-filters';
import { VoiceError, throwIfAborted } from './errors';
import { VOICE_BODY_MAX, VOICE_UPLOAD_MAX, type VoiceLanguage } from './types';
import type { SearchModality } from '../es/search-core';

export type VoiceRequest = { audio: Buffer } & (
  | { mode: 'sound_sample'; variantId: string; target: SearchModality; size: number; videoId: string | null; filters: NormalizedSearchFilters | null }
  | { mode: 'spoken_request'; language: VoiceLanguage }
);
const sampleSchema = z.object({
  variant_id: z.string().trim().min(1).max(64),
  target: z.enum(['audio', 'visual', 'both']).default('audio'),
  size: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(100)).optional(),
  video_id: z.string().trim().min(1).max(128).optional(),
});

/** Enforce streaming byte limit before the platform multipart parser allocates. */
export async function readBoundedBody(body: ReadableStream<Uint8Array> | null, limit: number, signal: AbortSignal): Promise<Buffer> {
  if (!body) throw new VoiceError('VOICE_EMPTY', 'A recording is required.');
  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let length = 0;
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    throwIfAborted(signal);
    for (;;) {
      const item = await reader.read();
      throwIfAborted(signal);
      if (item.done) break;
      length += item.value.byteLength;
      if (length > limit) {
        await reader.cancel().catch(() => undefined);
        throw new VoiceError('VOICE_TOO_LARGE', 'Voice upload is too large.', 413);
      }
      chunks.push(Buffer.from(item.value));
    }
    return Buffer.concat(chunks, length);
  } finally { signal.removeEventListener('abort', abort); reader.releaseLock(); }
}

export async function parseVoiceRequest(request: Request, signal: AbortSignal): Promise<VoiceRequest> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!/^multipart\/form-data\s*;/i.test(contentType)) throw new VoiceError('VOICE_INVALID_REQUEST', 'Use multipart/form-data.');
  const length = Number(request.headers.get('content-length'));
  if (length > VOICE_BODY_MAX) throw new VoiceError('VOICE_TOO_LARGE', 'Voice upload is too large.', 413);
  const bytes = await readBoundedBody(request.body, VOICE_BODY_MAX, signal);
  let form: FormData;
  try { form = await new Response(new Uint8Array(bytes), { headers: { 'content-type': contentType } }).formData(); }
  catch { throw new VoiceError('VOICE_INVALID_REQUEST', 'Malformed multipart upload.'); }
  const allowed = ['file', 'mode', 'variant_id', 'target', 'size', 'video_id', 'filters', 'language'];
  for (const key of new Set(form.keys())) {
    if (!allowed.includes(key) || form.getAll(key).length !== 1 || (key !== 'file' && typeof form.get(key) !== 'string'))
      throw new VoiceError('VOICE_INVALID_REQUEST', 'Unknown, duplicated or invalid field.');
  }
  const file = form.get('file');
  if (!(file instanceof Blob) || !file.size) throw new VoiceError('VOICE_EMPTY', 'A nonempty recording is required.');
  if (file.size > VOICE_UPLOAD_MAX) throw new VoiceError('VOICE_TOO_LARGE', 'Recording exceeds 5 MiB.', 413);
  const mode = form.has('mode') ? form.get('mode') : 'sound_sample';
  const audio = Buffer.from(await file.arrayBuffer());
  throwIfAborted(signal);
  if (mode === 'spoken_request') {
    if (['variant_id', 'target', 'size', 'video_id', 'filters'].some((k) => form.has(k)))
      throw new VoiceError('VOICE_INVALID_REQUEST', 'Search controls are not accepted for transcription.');
    const language = z.enum(['auto', 'en', 'zh', 'ko', 'th']).safeParse(form.get('language') ?? 'auto');
    if (!language.success) throw new VoiceError('VOICE_INVALID_REQUEST', 'Invalid speech language.');
    return { audio, mode, language: language.data };
  }
  if (mode !== 'sound_sample' || form.has('language')) throw new VoiceError('VOICE_INVALID_REQUEST', 'Invalid voice mode or fields.');
  const fields = Object.fromEntries(['variant_id', 'target', 'size', 'video_id'].filter((k) => form.has(k)).map((k) => [k, form.get(k)]));
  const parsed = sampleSchema.safeParse(fields);
  if (!parsed.success) throw new VoiceError('VOICE_INVALID_REQUEST', 'Select a variant and valid search controls.');
  let rawFilters: unknown;
  try { rawFilters = form.has('filters') ? JSON.parse(String(form.get('filters'))) : null; }
  catch { throw new VoiceError('VOICE_INVALID_REQUEST', 'Filters must be valid JSON.'); }
  return { audio, mode, variantId: parsed.data.variant_id, target: parsed.data.target,
    size: parsed.data.size ?? 20, videoId: parsed.data.video_id ?? null, filters: parseSearchFilters(rawFilters) };
}
