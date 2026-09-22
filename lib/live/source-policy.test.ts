import { describe, expect, it } from 'vitest';
import { loadLiveConfig } from './config';
import {
  buildAllowPolicy,
  hostMatchesAllowlist,
  validateLiveDestination,
  LiveSourcePolicyError,
} from './source-policy';

const cfg = loadLiveConfig({
  LIVE_ALLOWED_HOSTS: 'localhost,127.0.0.1',
  LIVE_ALLOWED_PORTS: '554,8554',
  LIVE_ALLOWED_PROTOCOLS: 'rtsp',
});

const policy = buildAllowPolicy(cfg);

describe('source policy allowlist', () => {
  it('allows MVP localhost MediaMTX port 8554', async () => {
    const dest = await validateLiveDestination(
      'rtsp://127.0.0.1:8554/fixture',
      policy,
      async () => ['127.0.0.1'],
    );
    expect(dest.bindAddress).toBe('127.0.0.1');
    expect(dest.bindUrl).toBe('rtsp://127.0.0.1:8554/fixture');
    expect(dest.allowedPort).toBe(8554);
  });

  it('rejects disallowed ports', async () => {
    await expect(
      validateLiveDestination('rtsp://127.0.0.1:1935/live', policy, async () => [
        '127.0.0.1',
      ]),
    ).rejects.toThrow(/LIVE_ALLOWED_PORTS|Port/i);
  });

  it('rejects hosts outside allowlist', async () => {
    await expect(
      validateLiveDestination('rtsp://evil.example:8554/live', policy, async () => [
        '8.8.8.8',
      ]),
    ).rejects.toThrow(LiveSourcePolicyError);
  });

  it('rejects DNS rebinding to metadata', async () => {
    await expect(
      validateLiveDestination('rtsp://localhost:8554/live', policy, async () => [
        '169.254.169.254',
      ]),
    ).rejects.toThrow(/LIVE_SOURCE_DNS_REBINDING|not permitted/i);
  });

  it('rejects DNS rebinding to multicast', async () => {
    await expect(
      validateLiveDestination('rtsp://localhost:8554/live', policy, async () => [
        '224.0.0.1',
      ]),
    ).rejects.toThrow(/not permitted/i);
  });

  it('rejects private IP resolution for public hostname allow entry', async () => {
    const open = buildAllowPolicy(
      loadLiveConfig({
        LIVE_ALLOWED_HOSTS: 'camera.example.com',
        LIVE_ALLOWED_PORTS: '554,8554',
      }),
    );
    await expect(
      validateLiveDestination(
        'rtsp://camera.example.com:554/live',
        open,
        async () => ['10.0.0.5'],
      ),
    ).rejects.toThrow(/not permitted/i);
  });

  it('allows host.docker.internal when allowlisted (Docker Desktop host gateway)', async () => {
    const docker = buildAllowPolicy(
      loadLiveConfig({
        LIVE_ALLOWED_HOSTS: 'localhost,127.0.0.1,host.docker.internal',
        LIVE_ALLOWED_PORTS: '554,8554,3456',
      }),
    );
    const dest = await validateLiveDestination(
      'rtsp://host.docker.internal:3456/webcam',
      docker,
      async () => ['192.168.65.254'],
    );
    expect(dest.bindAddress).toBe('192.168.65.254');
    expect(dest.bindUrl).toBe('rtsp://192.168.65.254:3456/webcam');
  });

  it('rejects host.docker.internal when not allowlisted', async () => {
    await expect(
      validateLiveDestination(
        'rtsp://host.docker.internal:8554/webcam',
        policy,
        async () => ['192.168.65.254'],
      ),
    ).rejects.toThrow(/LIVE_SOURCE_HOST_DENIED|not in LIVE_ALLOWED_HOSTS/i);
  });

  it('binds FFmpeg to the validated literal address', async () => {
    const dest = await validateLiveDestination(
      'rtsp://localhost:8554/fixture',
      policy,
      async () => ['127.0.0.1'],
    );
    expect(dest.bindUrl).toContain('127.0.0.1');
    expect(dest.bindUrl).not.toContain('localhost');
  });

  it('matches suffix and CIDR allow entries', () => {
    expect(hostMatchesAllowlist('a.cam.local', ['.cam.local'])).toBe(true);
    expect(hostMatchesAllowlist('cam.local', ['.cam.local'])).toBe(false);
    expect(hostMatchesAllowlist('10.1.2.3', ['10.0.0.0/8'])).toBe(true);
  });
});
