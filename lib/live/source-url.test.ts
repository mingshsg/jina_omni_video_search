import { describe, expect, it } from 'vitest';
import {
  parseLiveSourceUrl,
  rewriteUrlHost,
  LiveSourceUrlError,
} from './source-url';

describe('parseLiveSourceUrl', () => {
  it('parses RTSP without credentials', () => {
    const p = parseLiveSourceUrl('rtsp://127.0.0.1:8554/fixture');
    expect(p.scheme).toBe('rtsp');
    expect(p.hostname).toBe('127.0.0.1');
    expect(p.port).toBe(8554);
    expect(p.search).toBe('');
    expect(p.redactedOriginPath).toBe('rtsp://127.0.0.1:8554/fixture');
  });

  it('rejects userinfo', () => {
    expect(() =>
      parseLiveSourceUrl('rtsp://user:pass@127.0.0.1:8554/live'),
    ).toThrow(LiveSourceUrlError);
    expect(() =>
      parseLiveSourceUrl('rtsp://user:pass@127.0.0.1:8554/live'),
    ).toThrow(/userinfo/i);
  });

  it('rejects nested protocol smuggling', () => {
    expect(() =>
      parseLiveSourceUrl('rtsp://127.0.0.1:8554/file:/etc/passwd'),
    ).toThrow(/Nested protocol/i);
  });

  it('rejects control characters', () => {
    expect(() =>
      parseLiveSourceUrl('rtsp://127.0.0.1:8554/live\nHost:evil'),
    ).toThrow(/control/i);
  });

  it('rejects unsupported schemes', () => {
    expect(() => parseLiveSourceUrl('gopher://127.0.0.1/')).toThrow(
      /Unsupported scheme/i,
    );
  });

  it('parses HLS http(s) playlists and SRT URLs', () => {
    const hls = parseLiveSourceUrl('http://127.0.0.1:8888/live/index.m3u8');
    expect(hls.scheme).toBe('hls');
    expect(hls.port).toBe(8888);
    const srt = parseLiveSourceUrl('srt://127.0.0.1:8890');
    expect(srt.scheme).toBe('srt');
    expect(srt.port).toBe(8890);
    expect(() => parseLiveSourceUrl('hls://127.0.0.1/x')).toThrow(/http\(s\)/i);
  });

  it('preserves query on private rewrite while omitting it from provenance', () => {
    const p = parseLiveSourceUrl(
      'https://127.0.0.1:443/live/index.m3u8?token=abc%2B1&exp=9',
    );
    expect(p.search).toBe('?token=abc%2B1&exp=9');
    expect(p.redactedOriginPath).toBe('https://127.0.0.1/live/index.m3u8');
    expect(rewriteUrlHost(p, '127.0.0.1')).toBe(
      'https://127.0.0.1:443/live/index.m3u8?token=abc%2B1&exp=9',
    );
  });
});
