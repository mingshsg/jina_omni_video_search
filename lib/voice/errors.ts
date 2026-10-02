export class VoiceError extends Error {
  constructor(readonly code: string, message: string, readonly status = 400) {
    super(message);
    this.name = 'VoiceError';
  }
}

export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new VoiceError('VOICE_TIMEOUT', 'Voice processing was cancelled or timed out.', 504);
}
