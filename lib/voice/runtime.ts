import { VoiceError } from './errors';
import { VOICE_DEADLINE_MS } from './types';

/** Single-process demo limit; no unbounded waiting queue. */
export class VoiceGate {
  private active = 0;
  constructor(private readonly limit = 2) {}
  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) throw new VoiceError('VOICE_BUSY', 'Voice processing is busy. Please retry.', 429);
    this.active++;
    try { return await work(); } finally { this.active--; }
  }
}
export const voiceGate = new VoiceGate();
export function voiceDeadline(parent: AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, VOICE_DEADLINE_MS);
  parent.addEventListener('abort', abort, { once: true });
  if (parent.aborted) abort();
  return { signal: controller.signal, dispose: () => { clearTimeout(timer); parent.removeEventListener('abort', abort); } };
}
