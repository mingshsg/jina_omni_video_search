import { VOICE_MAX_MS, VOICE_UPLOAD_MAX, type VoiceMode } from './types';

export type RecorderState = 'idle' | 'requesting_permission' | 'recording' | 'preview';
export class VoiceRecorder {
  private generation = 0;
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(private readonly events: {
    state: (state: RecorderState, elapsedMs: number) => void;
    clip: (clip: Blob) => void;
    error: (reason: 'capture' | 'too_large') => void;
  }) {}

  async start(mode: VoiceMode): Promise<void> {
    this.dispose();
    const current = this.generation;
    this.events.state('requesting_permission', 0);
    try {
      if (!globalThis.navigator?.mediaDevices?.getUserMedia || !globalThis.MediaRecorder) throw new Error('Capture unavailable');
      const stream = await navigator.mediaDevices.getUserMedia({ video: false,
        audio: mode === 'sound_sample' ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false } : true });
      if (current !== this.generation) { stream.getTracks().forEach((track) => track.stop()); return; }
      this.stream = stream;
      const mime = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find((type) => MediaRecorder.isTypeSupported(type));
      if (!mime) throw new Error('Unsupported recorder');
      const recorder = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 128000 });
      this.recorder = recorder;
      const chunks: Blob[] = [];
      let bytes = 0, tooLarge = false;
      recorder.ondataavailable = (event) => {
        if (current !== this.generation) return;
        bytes += event.data.size;
        if (bytes > VOICE_UPLOAD_MAX) { tooLarge = true; this.stop(); }
        else if (!tooLarge) chunks.push(event.data);
      };
      recorder.onstop = () => {
        if (current !== this.generation) return;
        this.release();
        if (tooLarge || !bytes) { this.events.error(tooLarge ? 'too_large' : 'capture'); this.events.state('idle', 0); return; }
        this.events.clip(new Blob(chunks, { type: recorder.mimeType }));
        this.events.state('preview', 0);
      };
      recorder.onerror = () => {
        if (current !== this.generation) return;
        this.dispose(); this.events.error('capture'); this.events.state('idle', 0);
      };
      recorder.start(200);
      const started = Date.now();
      this.events.state('recording', 0);
      this.timer = setInterval(() => {
        const elapsed = Date.now() - started;
        this.events.state('recording', elapsed);
        // Leave room for final recorder packets while keeping server's 15s bound strict.
        if (elapsed >= VOICE_MAX_MS - 500) this.stop();
      }, 100);
    } catch {
      if (current !== this.generation) return;
      this.dispose(); this.events.error('capture'); this.events.state('idle', 0);
    }
  }
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }
  private release(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null; this.recorder = null;
  }
  dispose(): void {
    this.generation++;
    this.stop(); this.release();
  }
}
