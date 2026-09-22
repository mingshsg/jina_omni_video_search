import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  isValidConnectionRefName,
  redactSecretsInText,
  resolveConnectionSecret,
  LiveConnectionRefError,
} from './connection-ref';
import {
  assertWebEnvHasNoLiveSourceSecrets,
  listLiveSourceSecretKeys,
} from './env-surfaces';
import { RtspSourceAdapter, RTSP_PROTOCOL_WHITELIST } from './adapters/rtsp';
import { loadLiveConfig } from './config';
import type { LiveSourceSnapshot } from './types';

describe('connection_ref', () => {
  it('accepts valid ref names only', () => {
    expect(isValidConnectionRefName('LIVE_SOURCE_DEMO_URL')).toBe(true);
    expect(isValidConnectionRefName('LIVE_SOURCE_LOBBY_CAMERA_CONNECTION')).toBe(
      true,
    );
    expect(isValidConnectionRefName('LIVE_SOURCE_demo_URL')).toBe(false);
    expect(isValidConnectionRefName('DEMO_URL')).toBe(false);
  });

  it('resolves structured JSON secrets and rejects userinfo URLs', () => {
    const secret = resolveConnectionSecret('LIVE_SOURCE_DEMO_URL', {
      LIVE_SOURCE_DEMO_URL: JSON.stringify({
        url: 'rtsp://127.0.0.1:8554/fixture',
        username: 'reader',
        password: 's3cret',
      }),
    });
    expect(secret.username).toBe('reader');
    expect(() =>
      resolveConnectionSecret('LIVE_SOURCE_BAD_URL', {
        LIVE_SOURCE_BAD_URL: JSON.stringify({
          url: 'rtsp://u:p@127.0.0.1:8554/x',
        }),
      }),
    ).toThrow(LiveConnectionRefError);
  });

  it('never leaves raw secrets in redacted text', () => {
    const out = redactSecretsInText(
      'ffmpeg -i rtsp://reader:s3cret@127.0.0.1/x password=s3cret',
      ['s3cret', 'reader'],
    );
    expect(out).not.toContain('s3cret');
    expect(out).toContain('***');
  });
});

describe('web/worker env surfaces', () => {
  it('web startup rejects LIVE_SOURCE_* secrets', () => {
    expect(() =>
      assertWebEnvHasNoLiveSourceSecrets({
        LIVE_SOURCE_DEMO_URL: '{"url":"rtsp://127.0.0.1:8554/x"}',
      }),
    ).toThrow(/must not receive live source secrets/i);
    expect(listLiveSourceSecretKeys({ FOO: '1' })).toEqual([]);
  });
});

describe('RtspSourceAdapter', () => {
  const cfg = loadLiveConfig({
    LIVE_ALLOWED_HOSTS: 'localhost,127.0.0.1',
    LIVE_ALLOWED_PORTS: '554,8554',
  });

  it('builds shell-free argv with protocol whitelist and no userinfo in argv', async () => {
    const adapter = new RtspSourceAdapter(cfg, {
      resolveFn: async () => ['127.0.0.1'],
    });
    const snapshot: LiveSourceSnapshot = {
      source_revision: 1,
      protocol: 'rtsp',
      transport: 'tcp',
      connection_ref: 'LIVE_SOURCE_DEMO_URL',
      endpoint_fingerprint: '',
      allowed_host: '127.0.0.1',
      allowed_port: 8554,
    };
    const desc = await adapter.resolve(snapshot, {
      url: 'rtsp://127.0.0.1:8554/fixture',
      username: 'u',
      password: 'p',
    });
    const scriptPath = path.join(os.tmpdir(), `rtsp-auth-${Date.now()}.ffconcat`);
    try {
      const input = adapter.buildFfmpegInput(desc, scriptPath);
      const global = adapter.buildFfmpegGlobalArgs(desc);
      expect(global).not.toContain('-rtsp_transport');
      expect(input).toContain('-protocol_whitelist');
      expect(input[input.indexOf('-protocol_whitelist') + 1]).toContain('concat');
      expect(input).toContain('-f');
      expect(input).toContain('concat');
      expect(RTSP_PROTOCOL_WHITELIST).toContain('concat');
      const iIdx = input.indexOf('-i');
      const inputArg = input[iIdx + 1]!;
      expect(inputArg).toBe(scriptPath);
      expect(input.join(' ')).not.toMatch(/\/\/u:/);
      expect(input.join(' ')).not.toContain('p@');
      const script = fs.readFileSync(scriptPath, 'utf8');
      expect(script).toContain('rtsp://u:p@127.0.0.1');
      expect(script).toContain('option rtsp_transport tcp');
      expect((fs.statSync(scriptPath).mode & 0o777)).toBe(0o600);
      // Never log-safe: endpoint_redacted must not contain credentials.
      expect(desc.endpoint_redacted).not.toContain('u:');
      expect(desc.endpoint_redacted).not.toContain('@');
      expect(desc.bindInputUrl).not.toContain('@');
      expect(desc.bindInputUrl).toContain('127.0.0.1');
    } finally {
      try {
        fs.unlinkSync(scriptPath);
      } catch {
        // ignore
      }
    }
  });

  it('rejects passphrase and fingerprint changes on reconnect', async () => {
    const adapter = new RtspSourceAdapter(cfg, {
      resolveFn: async () => ['127.0.0.1'],
    });
    await expect(
      adapter.resolve(
        {
          source_revision: 1,
          protocol: 'rtsp',
          transport: 'tcp',
          connection_ref: 'LIVE_SOURCE_DEMO_URL',
          endpoint_fingerprint: 'deadbeef',
          allowed_host: '127.0.0.1',
          allowed_port: 8554,
        },
        { url: 'rtsp://127.0.0.1:8554/fixture' },
      ),
    ).rejects.toThrow(/fingerprint|LIVE_SOURCE_CHANGED/i);

    await expect(
      adapter.resolve(
        {
          source_revision: 1,
          protocol: 'rtsp',
          transport: 'tcp',
          connection_ref: 'LIVE_SOURCE_DEMO_URL',
          endpoint_fingerprint: '',
          allowed_host: '127.0.0.1',
          allowed_port: 8554,
        },
        { url: 'rtsp://127.0.0.1:8554/fixture', passphrase: 'x' },
      ),
    ).rejects.toThrow(/passphrase/i);
  });

  it('classifies exits', () => {
    const adapter = new RtspSourceAdapter(cfg);
    expect(
      adapter.classifyExit({
        code: null,
        signal: 'SIGTERM',
        timedOut: false,
        stopped: true,
        stderrTail: '',
      }),
    ).toBe('stopped');
    expect(
      adapter.classifyExit({
        code: 1,
        signal: null,
        timedOut: false,
        stopped: false,
        stderrTail: 'Connection refused',
      }),
    ).toBe('retryable');
  });
});
