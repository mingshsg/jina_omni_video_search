/**
 * Bounded Jina Search + Reader REST client for edit-time Suggest.
 * Mirrors the official MCP tools `search_web` / `read_url`
 * (https://github.com/jina-ai/MCP) without requiring an IDE MCP in the
 * running Next.js process.
 */
import type { AppConfig } from '../config';
import { getConfig } from '../config';

export class JinaWebError extends Error {
  readonly code: 'timeout' | 'unauthorized' | 'http' | 'malformed' | 'disabled';

  constructor(code: JinaWebError['code'], message: string) {
    super(message);
    this.name = 'JinaWebError';
    this.code = code;
  }
}

export interface JinaSearchHit {
  title: string;
  url: string;
  description: string;
}

export interface JinaReadResult {
  title: string;
  url: string;
  content: string;
}

function apiKey(cfg: AppConfig): string {
  return cfg.JINA_API_KEY.trim();
}

function assertKey(cfg: AppConfig): string {
  const key = apiKey(cfg);
  if (!key) {
    throw new JinaWebError('disabled', 'JINA_API_KEY is not configured');
  }
  return key;
}

async function fetchJson(
  url: string,
  init: RequestInit & { timeoutMs: number; signal?: AbortSignal },
): Promise<unknown> {
  const { timeoutMs, signal, ...rest } = init;
  const ac = new AbortController();
  const cancel = () => ac.abort();
  if (signal?.aborted) ac.abort();
  else signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...rest, signal: ac.signal });
    if (res.status === 401 || res.status === 403) {
      throw new JinaWebError('unauthorized', `Jina HTTP ${res.status}`);
    }
    if (!res.ok) {
      throw new JinaWebError('http', `Jina HTTP ${res.status}`);
    }
    return (await res.json()) as unknown;
  } catch (err) {
    if (err instanceof JinaWebError) throw err;
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new JinaWebError('timeout', 'Jina request timed out');
    }
    if (err instanceof Error && err.name === 'AbortError') {
      throw new JinaWebError('timeout', 'Jina request timed out');
    }
    throw new JinaWebError(
      'http',
      err instanceof Error ? err.message : 'Jina request failed',
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}

/** `search_web` equivalent — POST https://svip.jina.ai/ */
export async function jinaSearchWeb(params: {
  query: string;
  num?: number;
  cfg?: AppConfig;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<JinaSearchHit[]> {
  const cfg = params.cfg ?? getConfig();
  const key = assertKey(cfg);
  const timeoutMs = params.timeoutMs ?? cfg.SUGGEST_WEB_TIMEOUT_MS;
  const body = {
    q: params.query,
    num: Math.min(10, Math.max(1, params.num ?? 5)),
  };
  const raw = await fetchJson('https://svip.jina.ai/', {
    method: 'POST',
    timeoutMs,
    signal: params.signal,
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const obj = raw as { results?: unknown; data?: unknown };
  const list = Array.isArray(obj.results)
    ? obj.results
    : Array.isArray(obj.data)
      ? obj.data
      : null;
  if (!list) {
    throw new JinaWebError('malformed', 'Jina search response missing results');
  }

  const hits: JinaSearchHit[] = [];
  for (const row of list) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const title = String(r.title ?? r.name ?? '').trim();
    const url = String(r.url ?? r.link ?? '').trim();
    const description = String(
      r.description ?? r.snippet ?? r.content ?? '',
    ).trim();
    if (!url) continue;
    hits.push({ title, url, description });
  }
  return hits;
}

/** `read_url` equivalent — POST https://r.jina.ai/ */
export async function jinaReadUrl(params: {
  url: string;
  question?: string;
  cfg?: AppConfig;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<JinaReadResult> {
  const cfg = params.cfg ?? getConfig();
  const key = assertKey(cfg);
  const timeoutMs = params.timeoutMs ?? cfg.SUGGEST_WEB_TIMEOUT_MS;
  const body: Record<string, unknown> = { url: params.url };
  if (params.question?.trim()) {
    body.question = params.question.trim();
  }

  const raw = await fetchJson('https://r.jina.ai/', {
    method: 'POST',
    timeoutMs,
    signal: params.signal,
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Retain-Images': 'none',
    },
    body: JSON.stringify(body),
  });

  const obj = raw as { data?: Record<string, unknown> };
  const data = obj.data ?? (raw as Record<string, unknown>);
  const title = String(data.title ?? '').trim();
  const url = String(data.url ?? params.url).trim();
  const content = String(
    data.content ??
      data.snippets ??
      (Array.isArray(data.snippet) ? data.snippet.join('\n') : '') ??
      '',
  ).trim();
  if (!content) {
    throw new JinaWebError('malformed', 'Jina read returned empty content');
  }
  return { title, url, content };
}

export function isJinaWebConfigured(cfg?: AppConfig): boolean {
  const c = cfg ?? getConfig();
  return (
    c.SUGGEST_WEB_PROVIDER === 'jina' && c.JINA_API_KEY.trim().length > 0
  );
}
