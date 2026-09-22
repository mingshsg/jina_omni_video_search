import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadLiveConfig } from './config';
import {
  createLiveSourceAdapter,
  isLiveProtocolEnabled,
} from './adapters/registry';
import { HlsSourceAdapter, HLS_PROTOCOL_WHITELIST } from './adapters/hls';
import { SrtSourceAdapter, SRT_PROTOCOL_WHITELIST } from './adapters/srt';
import { WhipSourceAdapter } from './adapters/whip';
import {
  extractHlsReferencedUris,
  revalidateHlsPlaylistGraph,
} from './hls-playlist';
import { redactSecretsInText } from './connection-ref';
import type { LiveSourceSnapshot } from './types';

describe('Phase 10 protocol allowlist defaults', () => {
  it('keeps RTSP-only defaults (fail closed for extensions)', () => {
    const cfg = loadLiveConfig({});
    expect(cfg.LIVE_ALLOWED_PROTOCOLS).toEqual(['rtsp']);
    expect(isLiveProtocolEnabled('hls', cfg)).toBe(false);
    expect(isLiveProtocolEnabled('srt', cfg)).toBe(false);
    expect(isLiveProtocolEnabled('whip', cfg)).toBe(false);
    expect(() => createLiveSourceAdapter('hls', cfg)).toThrow(/LIVE_ALLOWED_PROTOCOLS/i);
  });
});

describe('HlsSourceAdapter', () => {
  const cfg = loadLiveConfig({
    LIVE_ALLOWED_PROTOCOLS: 'hls',
    LIVE_ALLOWED_HOSTS: 'localhost,127.0.0.1',
    LIVE_ALLOWED_PORTS: '80,443,8888',
  });

  it('resolves http playlist with shell-free argv and no secrets in argv', async () => {
    const adapter = new HlsSourceAdapter(cfg, {
      resolveFn: async () => ['127.0.0.1'],
      fetchPlaylist: false,
    });
    const snapshot: LiveSourceSnapshot = {
      source_revision: 1,
      protocol: 'hls',
      connection_ref: 'LIVE_SOURCE_HLS_URL',
      endpoint_fingerprint: '',
      allowed_host: '127.0.0.1',
      allowed_port: 8888,
    };
    const desc = await adapter.resolve(snapshot, {
      url: 'http://127.0.0.1:8888/live/index.m3u8',
      username: 'reader',
      password: 'hls-secret',
    });
    const scriptPath = path.join(os.tmpdir(), `hls-${Date.now()}.ffconcat`);
    try {
      const input = adapter.buildFfmpegInput(desc, scriptPath);
      expect(input).toContain('-protocol_whitelist');
      expect(input[input.indexOf('-protocol_whitelist') + 1]).toBe(
        HLS_PROTOCOL_WHITELIST.join(','),
      );
      expect(input.join(' ')).not.toContain('hls-secret');
      expect(input.join(' ')).not.toContain('reader');
      const body = fs.readFileSync(scriptPath, 'utf8');
      expect(body).toContain('reader');
      expect(redactSecretsInText(body, ['hls-secret', 'reader'])).not.toContain(
        'hls-secret',
      );
    } finally {
      fs.rmSync(scriptPath, { force: true });
    }
  });

  it('fails closed when HLS capability is required but missing', async () => {
    const adapter = new HlsSourceAdapter(cfg, {
      resolveFn: async () => ['127.0.0.1'],
      fetchPlaylist: false,
      requireCapability: true,
      hlsCapable: false,
    });
    await expect(
      adapter.resolve(
        {
          source_revision: 1,
          protocol: 'hls',
          connection_ref: 'LIVE_SOURCE_HLS_URL',
          endpoint_fingerprint: '',
          allowed_host: '',
          allowed_port: 0,
        },
        { url: 'http://127.0.0.1:8888/live/index.m3u8' },
      ),
    ).rejects.toThrow(/LIVE_HLS_CAPABILITY_MISSING|capability/i);
  });

  it('sends Basic auth on playlist preflight and drops it on cross-origin redirect', async () => {
    const playlist = ['#EXTM3U', '#EXTINF:1.0,', 'seg0.ts', ''].join('\n');
    const authed: string[] = [];
    await revalidateHlsPlaylistGraph(
      'http://127.0.0.1:8888/a.m3u8',
      {
        protocols: new Set(['hls']),
        hosts: ['127.0.0.1', 'localhost'],
        ports: new Set([80, 443, 8888]),
      },
      {
        resolveFn: async () => ['127.0.0.1'],
        username: 'reader',
        password: 'hls-secret',
        fetchFn: async (url, init) => {
          authed.push(init?.headers?.Authorization ?? '');
          if (url.includes(':8888/a.m3u8')) {
            return {
              status: 302,
              headers: {
                get: (n: string) =>
                  n.toLowerCase() === 'location'
                    ? 'http://127.0.0.1:443/b.m3u8'
                    : null,
              },
              text: async () => '',
              url,
            };
          }
          return {
            status: 200,
            headers: { get: () => null },
            text: async () => playlist,
            url,
          };
        },
      },
    );
    expect(authed[0]).toMatch(/^Basic /);
    expect(authed[1]).toBe('');
  });

  it('revalidates redirect hops and referenced key/segment hosts', async () => {
    const playlist = [
      '#EXTM3U',
      '#EXT-X-KEY:METHOD=AES-128,URI="https://127.0.0.1:443/keys/1.key"',
      '#EXTINF:2.0,',
      'seg0.ts',
      '',
    ].join('\n');
    const hops: string[] = [];
    const result = await revalidateHlsPlaylistGraph(
      'http://127.0.0.1:8888/a.m3u8',
      {
        protocols: new Set(['hls']),
        hosts: ['127.0.0.1', 'localhost'],
        ports: new Set([80, 443, 8888]),
      },
      {
        resolveFn: async () => ['127.0.0.1'],
        fetchFn: async (url) => {
          hops.push(url);
          if (url.includes(':8888/a.m3u8')) {
            return {
              status: 302,
              headers: {
                get: (n: string) =>
                  n.toLowerCase() === 'location'
                    ? 'http://127.0.0.1:8888/b.m3u8'
                    : null,
              },
              text: async () => '',
              url,
            };
          }
          return {
            status: 200,
            headers: { get: () => null },
            text: async () => playlist,
            url,
          };
        },
      },
    );
    expect(result.hops.length).toBeGreaterThanOrEqual(2);
    expect(result.referencedHosts).toContain('127.0.0.1');
    expect(
      extractHlsReferencedUris(playlist, 'http://127.0.0.1:8888/b.m3u8'),
    ).toEqual(
      expect.arrayContaining([
        'https://127.0.0.1/keys/1.key',
        'http://127.0.0.1:8888/seg0.ts',
      ]),
    );
  });

  it('denies referenced hosts outside allowlist', async () => {
    const playlist = [
      '#EXTM3U',
      '#EXTINF:2.0,',
      'http://evil.example:8888/seg.ts',
      '',
    ].join('\n');
    await expect(
      revalidateHlsPlaylistGraph(
        'http://127.0.0.1:8888/live.m3u8',
        {
          protocols: new Set(['hls']),
          hosts: ['127.0.0.1'],
          ports: new Set([8888]),
        },
        {
          resolveFn: async () => ['127.0.0.1'],
          fetchFn: async () => ({
            status: 200,
            headers: { get: () => null },
            text: async () => playlist,
            url: 'http://127.0.0.1:8888/live.m3u8',
          }),
        },
      ),
    ).rejects.toThrow(/LIVE_SOURCE_HOST_DENIED|not in LIVE_ALLOWED_HOSTS/i);
  });
});

describe('SrtSourceAdapter', () => {
  const cfg = loadLiveConfig({
    LIVE_ALLOWED_PROTOCOLS: 'srt',
    LIVE_ALLOWED_HOSTS: 'localhost,127.0.0.1',
    LIVE_ALLOWED_PORTS: '8890',
    LIVE_SRT_PEER_ALLOWLIST: '127.0.0.1',
  });

  it('writes passphrase only into 0600 script and requires capability when asked', async () => {
    const adapter = new SrtSourceAdapter(cfg, {
      resolveFn: async () => ['127.0.0.1'],
      requireCapability: true,
      srtCapable: true,
      transport: 'caller',
    });
    const snapshot: LiveSourceSnapshot = {
      source_revision: 1,
      protocol: 'srt',
      transport: 'caller',
      connection_ref: 'LIVE_SOURCE_SRT_URL',
      endpoint_fingerprint: '',
      allowed_host: '127.0.0.1',
      allowed_port: 8890,
    };
    const desc = await adapter.resolve(snapshot, {
      url: 'srt://127.0.0.1:8890',
      passphrase: 'srt-pass12',
    });
    expect(desc.inputScriptOptions?.passphrase).toBe('srt-pass12');
    const scriptPath = path.join(os.tmpdir(), `srt-${Date.now()}.ffconcat`);
    try {
      const input = adapter.buildFfmpegInput(desc, scriptPath);
      expect(input.join(' ')).not.toContain('srt-pass12');
      expect(input[input.indexOf('-protocol_whitelist') + 1]).toBe(
        SRT_PROTOCOL_WHITELIST.join(','),
      );
      const body = fs.readFileSync(scriptPath, 'utf8');
      expect(body).toContain('passphrase srt-pass12');
      expect(body).toContain('mode caller');
    } finally {
      fs.rmSync(scriptPath, { force: true });
    }
  });

  it('rejects short or control-bearing passphrases and does not treat bind IP as peer', async () => {
    const adapter = new SrtSourceAdapter(cfg, {
      resolveFn: async () => ['127.0.0.1'],
      requireCapability: false,
      transport: 'caller',
    });
    await expect(
      adapter.resolve(
        {
          source_revision: 1,
          protocol: 'srt',
          transport: 'caller',
          connection_ref: 'LIVE_SOURCE_SRT_URL',
          endpoint_fingerprint: '',
          allowed_host: '',
          allowed_port: 0,
        },
        { url: 'srt://127.0.0.1:8890', passphrase: 'short' },
      ),
    ).rejects.toThrow(/LIVE_SRT_PASSPHRASE_INVALID|10–79/i);

    const peerCfg = loadLiveConfig({
      LIVE_ALLOWED_PROTOCOLS: 'srt',
      LIVE_ALLOWED_HOSTS: 'localhost,127.0.0.1',
      LIVE_ALLOWED_PORTS: '8890',
      // Peer allowlist is a gateway acknowledgment, not the bind address.
      LIVE_SRT_PEER_ALLOWLIST: '10.0.0.5',
    });
    const listener = new SrtSourceAdapter(peerCfg, {
      resolveFn: async () => ['127.0.0.1'],
      requireCapability: false,
      transport: 'listener',
    });
    const desc = await listener.resolve(
      {
        source_revision: 1,
        protocol: 'srt',
        transport: 'listener',
        connection_ref: 'LIVE_SOURCE_SRT_URL',
        endpoint_fingerprint: '',
        allowed_host: '',
        allowed_port: 0,
      },
      { url: 'srt://127.0.0.1:8890' },
    );
    expect(desc.transport).toBe('listener');
  });

  it('fails closed when capability missing or listener lacks peer allowlist', async () => {
    const noCap = new SrtSourceAdapter(cfg, {
      resolveFn: async () => ['127.0.0.1'],
      requireCapability: true,
      srtCapable: false,
    });
    await expect(
      noCap.resolve(
        {
          source_revision: 1,
          protocol: 'srt',
          transport: 'caller',
          connection_ref: 'LIVE_SOURCE_SRT_URL',
          endpoint_fingerprint: '',
          allowed_host: '',
          allowed_port: 0,
        },
        { url: 'srt://127.0.0.1:8890' },
      ),
    ).rejects.toThrow(/LIVE_SRT_CAPABILITY_MISSING|capability/i);

    const noPeerCfg = loadLiveConfig({
      LIVE_ALLOWED_PROTOCOLS: 'srt',
      LIVE_ALLOWED_HOSTS: 'localhost,127.0.0.1',
      LIVE_ALLOWED_PORTS: '8890',
      LIVE_SRT_PEER_ALLOWLIST: '',
    });
    const listener = new SrtSourceAdapter(noPeerCfg, {
      resolveFn: async () => ['127.0.0.1'],
      requireCapability: false,
      transport: 'listener',
    });
    await expect(
      listener.resolve(
        {
          source_revision: 1,
          protocol: 'srt',
          transport: 'listener',
          connection_ref: 'LIVE_SOURCE_SRT_URL',
          endpoint_fingerprint: '',
          allowed_host: '',
          allowed_port: 0,
        },
        { url: 'srt://127.0.0.1:8890' },
      ),
    ).rejects.toThrow(/LIVE_SRT_PEER_ADMISSION_REQUIRED|PEER_ALLOWLIST/i);
  });
});

describe('WhipSourceAdapter', () => {
  const cfg = loadLiveConfig({
    LIVE_ALLOWED_PROTOCOLS: 'whip',
    LIVE_ALLOWED_HOSTS: 'localhost,127.0.0.1',
    LIVE_ALLOWED_PORTS: '554,8554',
  });

  it('consumes MediaMTX internal RTSP subscribe URL only', async () => {
    const adapter = new WhipSourceAdapter(cfg, {
      resolveFn: async () => ['127.0.0.1'],
    });
    const desc = await adapter.resolve(
      {
        source_revision: 1,
        protocol: 'whip',
        transport: 'tcp',
        connection_ref: 'LIVE_SOURCE_WHIP_URL',
        endpoint_fingerprint: '',
        allowed_host: '',
        allowed_port: 0,
      },
      { url: 'rtsp://127.0.0.1:8554/whipcam' },
    );
    expect(desc.snapshot.protocol).toBe('whip');
    expect(desc.destination.parsed.scheme).toBe('rtsp');
    await expect(
      adapter.resolve(
        {
          source_revision: 1,
          protocol: 'whip',
          connection_ref: 'LIVE_SOURCE_WHIP_URL',
          endpoint_fingerprint: '',
          allowed_host: '',
          allowed_port: 0,
        },
        // Non-RTSP schemes are rejected (publish endpoints are not subscribe URLs)
        { url: 'http://127.0.0.1:8554/whip/whipcam' },
      ),
    ).rejects.toThrow(/rtsp:\/\/|LIVE_ALLOWED_PROTOCOLS|SCHEME/i);
  });

  it('fails closed when whip not allowlisted', () => {
    const rtspOnly = loadLiveConfig({ LIVE_ALLOWED_PROTOCOLS: 'rtsp' });
    expect(() => createLiveSourceAdapter('whip', rtspOnly)).toThrow(
      /LIVE_ALLOWED_PROTOCOLS/i,
    );
  });
});
