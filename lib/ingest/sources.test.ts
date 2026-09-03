import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { LookupAddress } from 'node:dns';
import { afterEach, describe, expect, it } from 'vitest';
import { parseImportUrl, resolvePublicAddresses } from './url-fetch';
import { IngestError } from './errors';
import { validateLocalPath } from './sources';
import type { AppConfig } from '../config';

describe('parseImportUrl', () => {
  it('accepts http/https', () => {
    expect(parseImportUrl('https://example.com/a.mp4').hostname).toBe('example.com');
  });

  it('rejects non-http schemes', () => {
    expect(() => parseImportUrl('file:///etc/passwd')).toThrow(IngestError);
    try {
      parseImportUrl('file:///x');
    } catch (e) {
      expect((e as IngestError).code).toBe('INGEST_URL_INVALID_SCHEME');
    }
  });

  it('rejects embedded credentials', () => {
    expect(() => parseImportUrl('http://user:pass@example.com/x.mp4')).toThrow(
      IngestError,
    );
  });

  it('rejects localhost', () => {
    expect(() => parseImportUrl('http://127.0.0.1/x.mp4')).toThrow(IngestError);
    try {
      parseImportUrl('http://127.0.0.1/x.mp4');
    } catch (e) {
      expect((e as IngestError).code).toBe('INGEST_URL_SSRF_BLOCKED');
    }
  });
});

describe('resolvePublicAddresses', () => {
  it('rejects private literal IPs without DNS', async () => {
    await expect(resolvePublicAddresses('192.168.0.1')).rejects.toMatchObject({
      code: 'INGEST_URL_SSRF_BLOCKED',
    });
  });

  it('returns public literal IP', async () => {
    const ips = await resolvePublicAddresses('8.8.8.8');
    expect(ips).toEqual(['8.8.8.8']);
  });

  it('rejects when DNS resolves to private address', async () => {
    const mockLookup = async (
      _host: string,
      _opts: { all: true; verbatim: true },
    ): Promise<LookupAddress[]> => [{ address: '10.0.0.5', family: 4 }];
    await expect(
      resolvePublicAddresses('evil.example', mockLookup),
    ).rejects.toMatchObject({
      code: 'INGEST_URL_SSRF_BLOCKED',
    });
  });
});

describe('validateLocalPath', () => {
  let tmpRoot = '';
  let outsideFile = '';

  afterEach(async () => {
    if (tmpRoot) {
      await fsp.rm(tmpRoot, { recursive: true, force: true });
      tmpRoot = '';
    }
  });

  async function setup() {
    tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'jve-import-'));
    const allowed = path.join(tmpRoot, 'allowed');
    await fsp.mkdir(allowed);
    const inside = path.join(allowed, 'clip.mp4');
    await fsp.writeFile(inside, 'fake');
    outsideFile = path.join(tmpRoot, 'outside.mp4');
    await fsp.writeFile(outsideFile, 'fake');
    return { inside, allowed };
  }

  function cfg(root: string): AppConfig {
    return {
      LOCAL_IMPORT_ROOT: root,
      MAX_SOURCE_BYTES: 1024 * 1024,
      MEDIA_ROOT: path.join(tmpRoot, 'data'),
    } as AppConfig;
  }

  it('rejects when LOCAL_IMPORT_ROOT is not configured', async () => {
    await expect(
      validateLocalPath('/tmp/x.mp4', { LOCAL_IMPORT_ROOT: undefined } as AppConfig),
    ).rejects.toMatchObject({ code: 'INGEST_LOCAL_NOT_CONFIGURED' });
  });

  it('rejects relative paths', async () => {
    const { allowed } = await setup();
    await expect(validateLocalPath('clip.mp4', cfg(allowed))).rejects.toMatchObject({
      code: 'INGEST_LOCAL_NOT_ABSOLUTE',
    });
  });

  it('rejects path traversal outside root', async () => {
    const { allowed } = await setup();
    await expect(
      validateLocalPath(outsideFile, cfg(allowed)),
    ).rejects.toMatchObject({ code: 'INGEST_LOCAL_TRAVERSAL' });
  });

  it('accepts file inside realpath root', async () => {
    const { inside, allowed } = await setup();
    const resolved = await validateLocalPath(inside, cfg(allowed));
    expect(resolved).toBe(await fsp.realpath(inside));
  });

  it('rejects oversize files', async () => {
    const { allowed } = await setup();
    const big = path.join(allowed, 'big.mp4');
    await fsp.writeFile(big, Buffer.alloc(2048));
    await expect(
      validateLocalPath(big, {
        ...cfg(allowed),
        MAX_SOURCE_BYTES: 1024,
      }),
    ).rejects.toMatchObject({ code: 'INGEST_LOCAL_SIZE_EXCEEDED' });
  });
});
