import dns from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import type { IncomingMessage } from 'node:http';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { IngestError } from './errors';
import { isBlockedHostname, isBlockedIp } from './ip-guard';
import type { AppConfig } from '../config';
import {
  ensureDir,
  newMediaFilename,
  originalsDir,
  quarantinePartial,
} from './paths';
import { extensionOf, isAllowedVideoExtension } from './extensions';

export const MAX_REDIRECT_HOPS = 5;
export const URL_CONNECT_TIMEOUT_MS = 15_000;
export const URL_IDLE_TIMEOUT_MS = 60_000;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export interface UrlFetchOptions {
  maxBytes: number;
  connectTimeoutMs?: number;
  idleTimeoutMs?: number;
  maxRedirectHops?: number;
}

export interface UrlHeadHint {
  contentLength?: number;
  contentType?: string;
}

/** Parse and validate scheme; reject embedded credentials. */
export function parseImportUrl(raw: string): URL {
  const trimmed = raw.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new IngestError('INGEST_URL_INVALID');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new IngestError('INGEST_URL_INVALID_SCHEME');
  }
  if (parsed.username || parsed.password) {
    throw new IngestError('INGEST_URL_CREDENTIALS');
  }
  if (!parsed.hostname) {
    throw new IngestError('INGEST_URL_INVALID');
  }
  if (isBlockedHostname(parsed.hostname)) {
    throw new IngestError('INGEST_URL_SSRF_BLOCKED');
  }
  return parsed;
}

/** Resolve hostname and ensure every address is public (SSRF guard). */
export async function resolvePublicAddresses(
  hostname: string,
  lookup: (
    host: string,
    opts: { all: true; verbatim: true },
  ) => Promise<LookupAddress[]> = dns.lookup.bind(dns),
): Promise<string[]> {
  if (isBlockedHostname(hostname)) {
    throw new IngestError('INGEST_URL_SSRF_BLOCKED');
  }

  const bare = hostname.replace(/^\[/, '').replace(/\]$/, '');
  if (net.isIP(bare)) {
    if (isBlockedIp(bare)) {
      throw new IngestError('INGEST_URL_SSRF_BLOCKED');
    }
    return [bare];
  }

  let records: LookupAddress[];
  try {
    records = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new IngestError('INGEST_URL_SSRF_BLOCKED');
  }
  if (records.length === 0) {
    throw new IngestError('INGEST_URL_SSRF_BLOCKED');
  }
  for (const rec of records) {
    if (isBlockedIp(rec.address)) {
      throw new IngestError('INGEST_URL_SSRF_BLOCKED');
    }
  }
  return records.map((r) => r.address);
}

function resolveRedirect(current: URL, location: string): URL {
  try {
    const next = new URL(location, current);
    return parseImportUrl(next.toString());
  } catch (err) {
    if (err instanceof IngestError) throw err;
    throw new IngestError('INGEST_URL_DOWNLOAD_FAILED');
  }
}

function requestViaValidatedIp(
  url: URL,
  ip: string,
  method: 'GET' | 'HEAD',
  idleTimeoutMs: number,
): Promise<IncomingMessage> {
  const isHttps = url.protocol === 'https:';
  const port = url.port ? Number(url.port) : isHttps ? 443 : 80;
  const pathWithQuery = `${url.pathname}${url.search}`;

  return new Promise((resolve, reject) => {
    const mod = isHttps ? https : http;
    const req = mod.request(
      {
        host: ip,
        port,
        path: pathWithQuery,
        method,
        headers: {
          Host: url.host,
          'User-Agent': 'jina-video-embedding/0.1',
          Accept: '*/*',
        },
        ...(isHttps ? { servername: url.hostname, rejectUnauthorized: true } : {}),
        timeout: URL_CONNECT_TIMEOUT_MS,
      },
      (res) => {
        let idleTimer: NodeJS.Timeout | undefined;
        const resetIdle = () => {
          if (idleTimer) clearTimeout(idleTimer);
          idleTimer = setTimeout(() => {
            req.destroy();
            res.destroy();
            reject(new IngestError('INGEST_URL_TIMEOUT'));
          }, idleTimeoutMs);
        };
        res.on('data', resetIdle);
        resetIdle();
        resolve(res);
      },
    );

    req.on('timeout', () => {
      req.destroy();
      reject(new IngestError('INGEST_URL_TIMEOUT'));
    });
    req.on('error', () => reject(new IngestError('INGEST_URL_DOWNLOAD_FAILED')));
    req.end();
  });
}

/** HEAD is a hint only — failures are ignored by callers. */
export async function headUrlHint(
  rawUrl: string,
  options: Pick<UrlFetchOptions, 'maxBytes'>,
): Promise<UrlHeadHint> {
  try {
    const url = parseImportUrl(rawUrl);
    const ips = await resolvePublicAddresses(url.hostname);
    const res = await requestViaValidatedIp(
      url,
      ips[0]!,
      'HEAD',
      URL_IDLE_TIMEOUT_MS,
    );
    res.resume();
    const len = res.headers['content-length'];
    const hint: UrlHeadHint = {};
    if (len) {
      const n = Number(len);
      if (Number.isFinite(n) && n > options.maxBytes) {
        throw new IngestError('INGEST_URL_SIZE_EXCEEDED');
      }
      if (Number.isFinite(n)) hint.contentLength = n;
    }
    const ct = res.headers['content-type'];
    if (typeof ct === 'string') hint.contentType = ct.split(';')[0]?.trim();
    return hint;
  } catch (err) {
    if (err instanceof IngestError) throw err;
    return {};
  }
}

async function streamResponseToFile(
  res: IncomingMessage,
  destPath: string,
  maxBytes: number,
  cfg: AppConfig,
): Promise<number> {
  const contentLength = res.headers['content-length'];
  if (contentLength) {
    const n = Number(contentLength);
    if (Number.isFinite(n) && n > maxBytes) {
      res.resume();
      throw new IngestError('INGEST_URL_SIZE_EXCEEDED');
    }
  }

  ensureDir(path.dirname(destPath));
  const tmpPath = `${destPath}.part`;
  let bytes = 0;

  await new Promise<void>((resolve, reject) => {
    const out = fs.createWriteStream(tmpPath);
    res.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        res.destroy();
        out.destroy();
        quarantinePartial(cfg, tmpPath);
        reject(new IngestError('INGEST_URL_SIZE_EXCEEDED'));
      }
    });
    res.on('error', () => {
      quarantinePartial(cfg, tmpPath);
      reject(new IngestError('INGEST_URL_DOWNLOAD_FAILED'));
    });
    out.on('error', () => {
      quarantinePartial(cfg, tmpPath);
      reject(new IngestError('INGEST_URL_DOWNLOAD_FAILED'));
    });
    pipeline(res, out)
      .then(() => resolve())
      .catch(() => {
        quarantinePartial(cfg, tmpPath);
        reject(new IngestError('INGEST_URL_DOWNLOAD_FAILED'));
      });
  });

  fs.renameSync(tmpPath, destPath);
  return bytes;
}

/**
 * Download URL to disk with SSRF protection, redirect re-validation,
 * stream-time byte cap, and partial-file quarantine on failure.
 */
export async function downloadUrlToFile(
  rawUrl: string,
  cfg: AppConfig,
  options: UrlFetchOptions,
): Promise<{ destPath: string; bytes: number; finalUrl: string }> {
  const maxRedirectHops = options.maxRedirectHops ?? MAX_REDIRECT_HOPS;
  const idleTimeoutMs = options.idleTimeoutMs ?? URL_IDLE_TIMEOUT_MS;

  let current = parseImportUrl(rawUrl);
  let hops = 0;

  while (true) {
    const ips = await resolvePublicAddresses(current.hostname);
    const res = await requestViaValidatedIp(
      current,
      ips[0]!,
      'GET',
      idleTimeoutMs,
    );

    if (REDIRECT_STATUSES.has(res.statusCode ?? 0)) {
      res.resume();
      hops += 1;
      if (hops > maxRedirectHops) {
        throw new IngestError('INGEST_URL_REDIRECT_LIMIT');
      }
      const location = res.headers.location;
      if (!location) {
        throw new IngestError('INGEST_URL_DOWNLOAD_FAILED');
      }
      current = resolveRedirect(current, location);
      continue;
    }

    if ((res.statusCode ?? 0) < 200 || (res.statusCode ?? 0) >= 300) {
      res.resume();
      throw new IngestError('INGEST_URL_DOWNLOAD_FAILED');
    }

    const ext = extensionFromUrlOrHeaders(current, res);
    if (!isAllowedVideoExtension(`file${ext}`)) {
      res.resume();
      throw new IngestError('INGEST_URL_DOWNLOAD_FAILED');
    }

    ensureDir(originalsDir(cfg));
    const destPath = path.join(originalsDir(cfg), newMediaFilename(ext));
    const bytes = await streamResponseToFile(
      res,
      destPath,
      options.maxBytes,
      cfg,
    );
    return { destPath, bytes, finalUrl: current.toString() };
  }
}

function extensionFromUrlOrHeaders(url: URL, res: IncomingMessage): string {
  const fromPath = extensionOf(url.pathname);
  if (fromPath && isAllowedVideoExtension(`x${fromPath}`)) return fromPath;

  const cd = res.headers['content-disposition'];
  if (typeof cd === 'string') {
    const match = /filename\*?=(?:UTF-8''|")?([^";]+)/i.exec(cd);
    if (match?.[1]) {
      const ext = extensionOf(decodeURIComponent(match[1]));
      if (ext) return ext;
    }
  }

  const ct = res.headers['content-type'];
  if (typeof ct === 'string') {
    const mime = ct.split(';')[0]?.trim().toLowerCase();
    const mimeMap: Record<string, string> = {
      'video/mp4': '.mp4',
      'video/webm': '.webm',
      'video/quicktime': '.mov',
      'video/x-matroska': '.mkv',
      'video/x-msvideo': '.avi',
    };
    if (mime && mimeMap[mime]) return mimeMap[mime]!;
  }

  return '.mp4';
}
