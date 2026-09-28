/**
 * EIS chat_completion streaming client for drama directors (Node).
 * Mirrors vendor/episode_processing eis_chat over /_stream.
 */
import { getConfig } from '../config';
import { getDramaEnv } from './env';

export type EisChatContentPart =
  | { type: 'text'; text: string }
  | {
      type: 'image_url';
      image_url: { url: string };
    };

export type EisChatMessage = {
  role: 'user' | 'system' | 'assistant';
  content: string | EisChatContentPart[];
};

export class DramaEisChatError extends Error {
  readonly code: 'config' | 'http' | 'empty' | 'timeout';

  constructor(code: DramaEisChatError['code'], message: string) {
    super(message);
    this.name = 'DramaEisChatError';
    this.code = code;
  }
}

function resolveChatInferenceId(explicit?: string): string {
  const env = getDramaEnv();
  const id =
    explicit?.trim() ||
    env.DRAMA_EIS_CHAT_INFERENCE_ID.trim() ||
    process.env.SUGGEST_AGENT_CONNECTOR_ID?.trim() ||
    '';
  return id;
}

/**
 * Stream chat completion from Elasticsearch EIS.
 * Does not log message bodies (may contain media / dialogue).
 */
export async function callDramaEisChat(opts: {
  messages: EisChatMessage[];
  inferenceId?: string;
  timeoutMs?: number;
}): Promise<{ text: string; usage: Record<string, number> }> {
  const cfg = getConfig();
  const dramaEnv = getDramaEnv();
  const inferenceId = resolveChatInferenceId(opts.inferenceId);
  if (!inferenceId) {
    throw new DramaEisChatError(
      'config',
      'DRAMA_EIS_CHAT_INFERENCE_ID is empty (set an EIS chat_completion inference id)',
    );
  }
  const timeoutMs =
    opts.timeoutMs ?? dramaEnv.DRAMA_DIRECTORS_TIMEOUT_MS;
  const url = `${cfg.ELASTICSEARCH_URL.replace(/\/$/, '')}/_inference/chat_completion/${encodeURIComponent(inferenceId)}/_stream`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `ApiKey ${cfg.ELASTICSEARCH_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ messages: opts.messages }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof Error && err.name === 'AbortError') {
      throw new DramaEisChatError('timeout', 'EIS chat_completion timed out');
    }
    throw new DramaEisChatError(
      'http',
      `EIS chat transport failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  clearTimeout(timer);

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new DramaEisChatError(
      'http',
      `EIS chat HTTP ${res.status}: ${body.slice(0, 400)}`,
    );
  }

  const chunks: string[] = [];
  let usage: Record<string, number> = {};
  const reader = res.body?.getReader();
  if (!reader) {
    clearTimeout(timer);
    throw new DramaEisChatError('empty', 'EIS chat returned no body');
  }
  // R11: the header timer alone cannot catch a mid-stream stall — a
  // pending reader.read() does not reject on abort. Race every read
  // against the remaining deadline instead, and cancel the reader on
  // timeout so no dangling read holds the enrichment open.
  const deadline = Date.now() + timeoutMs;
  const timeoutError = () =>
    new DramaEisChatError(
      'timeout',
      'EIS chat_completion timed out while streaming',
    );
  const decoder = new TextDecoder('utf-8');
  let buf = '';
  try {
    for (;;) {
        const msLeft = deadline - Date.now();
        if (msLeft <= 0) {
          try {
            await reader.cancel();
          } catch {
            /* ignore */
          }
          throw timeoutError();
        }
        let timerFired = false;
        const timeoutP = new Promise<never>((_, reject) => {
          const t = setTimeout(() => {
            timerFired = true;
            reject(timeoutError());
          }, msLeft);
          // Avoid keeping the process alive on a dangling timer.
          if (typeof (t as unknown as { unref?: unknown }).unref === 'function') {
            (t as unknown as { unref: () => void }).unref();
          }
        });
        let read: ReadableStreamReadResult<Uint8Array>;
        try {
          read = await Promise.race([reader.read(), timeoutP]);
        } catch (err) {
          if (timerFired || err instanceof DramaEisChatError) {
            try {
              await reader.cancel();
            } catch {
              /* ignore */
            }
            throw err instanceof DramaEisChatError ? err : timeoutError();
          }
          throw err;
        }
        const { done, value } = read;
        if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') continue;
        try {
          const obj = JSON.parse(data) as {
            usage?: Record<string, number>;
            choices?: Array<{ delta?: { content?: string } }>;
          };
          if (obj.usage && typeof obj.usage === 'object') {
            usage = obj.usage as Record<string, number>;
          }
          for (const ch of obj.choices ?? []) {
            const c = ch.delta?.content;
            if (typeof c === 'string') chunks.push(c);
          }
        } catch {
          /* ignore partial JSON */
        }
      }
    }
  } finally {
    clearTimeout(timer);
  }

  const text = chunks.join('').trim();
  if (!text) {
    throw new DramaEisChatError('empty', 'EIS chat returned empty content');
  }
  return { text, usage };
}

export function imageDataUrlFromJpeg(bytes: Buffer): EisChatContentPart {
  return {
    type: 'image_url',
    image_url: {
      url: `data:image/jpeg;base64,${bytes.toString('base64')}`,
    },
  };
}
