import { describe, expect, it } from 'vitest';
import { loadLiveConfig, resetLiveConfig } from './config';

function baseEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    ...overrides,
  } as NodeJS.ProcessEnv;
}

describe('loadLiveConfig', () => {
  it('applies forever retention and unlimited spool defaults', () => {
    resetLiveConfig();
    const cfg = loadLiveConfig(baseEnv());
    expect(cfg.LIVE_VECTOR_RETENTION).toBe('forever');
    expect(cfg.LIVE_EVENT_RETENTION).toBe('forever');
    expect(cfg.LIVE_CLIP_RETENTION).toBe('forever');
    expect(cfg.LIVE_PENDING_SPOOL_MAX_BYTES).toBeUndefined();
    expect(cfg.LIVE_RETAINED_MEDIA_MAX_BYTES).toBeUndefined();
    expect(cfg.LIVE_SPOOL_MIN_FREE_BYTES).toBe(50 * 1024 * 1024 * 1024);
    expect(cfg.LIVE_DSL_LIFECYCLE).toEqual({ enabled: true });
    expect(cfg.LIVE_ALLOWED_PORTS).toEqual([554, 8554]);
    expect(cfg.LIVE_ALLOWED_HOSTS).toContain('localhost');
    expect(cfg.LIVE_ALLOWED_HOSTS).toContain('127.0.0.1');
    expect(cfg.LIVE_WINDOW_STEP_MS).toBe(6000);
    expect(cfg.LIVE_FRAGMENTS_PER_WINDOW).toBe(4);
  });

  it('treats 0 spool caps as unlimited', () => {
    const cfg = loadLiveConfig(
      baseEnv({
        LIVE_PENDING_SPOOL_MAX_BYTES: '0',
        LIVE_RETAINED_MEDIA_MAX_BYTES: '0',
      }),
    );
    expect(cfg.LIVE_PENDING_SPOOL_MAX_BYTES).toBeUndefined();
    expect(cfg.LIVE_RETAINED_MEDIA_MAX_BYTES).toBeUndefined();
  });

  it('treats LIVE_SPOOL_MIN_FREE_BYTES=0 as disabled soft floor', () => {
    const cfg = loadLiveConfig(baseEnv({ LIVE_SPOOL_MIN_FREE_BYTES: '0' }));
    expect(cfg.LIVE_SPOOL_MIN_FREE_BYTES).toBeUndefined();
  });

  it('accepts custom soft free-space floor', () => {
    const cfg = loadLiveConfig(
      baseEnv({ LIVE_SPOOL_MIN_FREE_BYTES: '1048576' }),
    );
    expect(cfg.LIVE_SPOOL_MIN_FREE_BYTES).toBe(1_048_576);
  });

  it('accepts finite optional spool caps', () => {
    const cfg = loadLiveConfig(
      baseEnv({ LIVE_PENDING_SPOOL_MAX_BYTES: '1048576' }),
    );
    expect(cfg.LIVE_PENDING_SPOOL_MAX_BYTES).toBe(1_048_576);
  });

  it('rejects age-based retention tokens with the variable name', () => {
    expect(() =>
      loadLiveConfig(baseEnv({ LIVE_VECTOR_RETENTION: '7d' })),
    ).toThrow(/LIVE_VECTOR_RETENTION/);
    expect(() =>
      loadLiveConfig(baseEnv({ LIVE_EVENT_RETENTION: '8d' })),
    ).toThrow(/LIVE_EVENT_RETENTION/);
    expect(() =>
      loadLiveConfig(baseEnv({ LIVE_CLIP_RETENTION: '24h' })),
    ).toThrow(/LIVE_CLIP_RETENTION/);
  });

  it('rejects windowing that fails fragment divisibility', () => {
    expect(() =>
      loadLiveConfig(
        baseEnv({
          LIVE_FRAGMENT_MS: '2000',
          LIVE_WINDOW_MS: '7000',
          LIVE_OVERLAP_MS: '2000',
        }),
      ),
    ).toThrow(/LIVE_WINDOW_MS/);
  });

  it('rejects overlap that does not yield a fragment-aligned step', () => {
    expect(() =>
      loadLiveConfig(
        baseEnv({
          LIVE_FRAGMENT_MS: '2000',
          LIVE_WINDOW_MS: '8000',
          LIVE_OVERLAP_MS: '3000',
        }),
      ),
    ).toThrow(/LIVE_OVERLAP_MS/);
  });

  it('rejects queue smaller than processing concurrency', () => {
    expect(() =>
      loadLiveConfig(
        baseEnv({
          LIVE_QUEUE_MAX_WINDOWS: '1',
          LIVE_PROCESSING_CONCURRENCY: '2',
        }),
      ),
    ).toThrow(/LIVE_QUEUE_MAX_WINDOWS/);
  });

  it('rejects duplicate storage names', () => {
    expect(() =>
      loadLiveConfig(
        baseEnv({
          ES_INDEX_LIVE_SOURCES: 'same',
          ES_INDEX_LIVE_SESSIONS: 'same',
        }),
      ),
    ).toThrow(/ES_INDEX_LIVE_SOURCES|distinct/i);
  });

  it('rejects invalid ports with LIVE_ALLOWED_PORTS', () => {
    expect(() =>
      loadLiveConfig(baseEnv({ LIVE_ALLOWED_PORTS: '554,99999' })),
    ).toThrow(/LIVE_ALLOWED_PORTS/);
  });
});
