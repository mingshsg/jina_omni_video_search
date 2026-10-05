import { afterEach, describe, expect, it, vi } from 'vitest';
import { VoiceRecorder } from './recorder';
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('browser voice recorder lifecycle', () => {
  it('stops a stream whose permission arrives after Cancel', async () => {
    let grant!: (stream: MediaStream) => void;
    const stop = vi.fn();
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: () => new Promise<MediaStream>((resolve) => { grant = resolve; }) } });
    vi.stubGlobal('MediaRecorder', class {});
    const events = { state: vi.fn(), clip: vi.fn(), error: vi.fn() };
    const recorder = new VoiceRecorder(events);
    const pending = recorder.start('sound_sample'); recorder.dispose();
    grant({ getTracks: () => [{ stop }] } as unknown as MediaStream);
    await pending;
    expect(stop).toHaveBeenCalledTimes(1); expect(events.clip).not.toHaveBeenCalled();
  });
  it('captures an actual selected MIME, releases tracks and clears timers on stop', async () => {
    vi.useFakeTimers();
    const stop = vi.fn(), getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] });
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    class Recorder {
      static isTypeSupported(mime: string) { return mime === 'audio/mp4'; }
      state = 'inactive'; mimeType = 'audio/mp4';
      ondataavailable?: (event: { data: Blob }) => void; onstop?: () => void;
      start() { this.state = 'recording'; }
      stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['clip']) }); this.onstop?.(); }
    }
    vi.stubGlobal('MediaRecorder', Recorder);
    const events = { state: vi.fn(), clip: vi.fn(), error: vi.fn() };
    const recorder = new VoiceRecorder(events);
    await recorder.start('sound_sample'); await vi.advanceTimersByTimeAsync(14500);
    expect(getUserMedia.mock.calls[0][0].audio).toMatchObject({ noiseSuppression: false, echoCancellation: false });
    expect(events.clip.mock.calls[0][0].type).toBe('audio/mp4'); expect(stop).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0); recorder.dispose();
  });
  it('reports denied permission without retaining capture resources', async () => {
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn().mockRejectedValue(new Error('denied')) } });
    vi.stubGlobal('MediaRecorder', class {});
    const events = { state: vi.fn(), clip: vi.fn(), error: vi.fn() };
    await new VoiceRecorder(events).start('spoken_request');
    expect(events.error).toHaveBeenCalledWith('capture'); expect(events.clip).not.toHaveBeenCalled();
  });
});
