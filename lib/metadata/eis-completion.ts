/**
 * EIS completion transport for query parsing (Phase 3.6).
 * Uses client.inference.completion — not chat_completion, not ES|QL COMPLETION.
 */
import type { AppConfig } from '../config';
import { getConfig } from '../config';
import { getParserConcurrencyGate } from '../embed/concurrency';
import { getEsClient } from '../es/client';

export class EisCompletionError extends Error {
  readonly code: 'timeout' | 'transport' | 'empty' | 'malformed';

  constructor(code: EisCompletionError['code'], message: string) {
    super(message);
    this.name = 'EisCompletionError';
    this.code = code;
  }
}

/**
 * Call EIS completion once. Does not log the prompt or result body
 * (may contain user query text).
 */
export async function callEisCompletion(params: {
  prompt: string;
  cfg?: AppConfig;
  /** Override timeout string, e.g. "800ms". */
  timeout?: string;
  taskSettings?: Record<string, unknown>;
}): Promise<string> {
  const cfg = params.cfg ?? getConfig();
  const inferenceId = cfg.QUERY_PARSER_INFERENCE_ID.trim();
  if (!inferenceId) {
    throw new EisCompletionError('transport', 'QUERY_PARSER_INFERENCE_ID is empty');
  }

  const timeoutMs = cfg.QUERY_PARSER_TIMEOUT_MS;
  const timeout = params.timeout ?? `${timeoutMs}ms`;
  const gate = getParserConcurrencyGate(cfg);
  const client = getEsClient();

  try {
    const res = await gate.run(() =>
      client.inference.completion({
        inference_id: inferenceId,
        input: params.prompt,
        timeout,
        ...(params.taskSettings
          ? { task_settings: params.taskSettings }
          : {
              task_settings: {
                // Soft hint — provider may ignore; validation is the correctness gate.
                max_tokens: cfg.QUERY_PARSER_MAX_TOKENS,
              },
            }),
      }),
    );

    const raw = res.completion?.[0]?.result;
    if (typeof raw !== 'string' || !raw.trim()) {
      throw new EisCompletionError('empty', 'EIS completion returned empty result');
    }
    return raw.trim();
  } catch (err) {
    if (err instanceof EisCompletionError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    const lower = message.toLowerCase();
    if (
      lower.includes('timeout') ||
      lower.includes('timed out') ||
      lower.includes('deadline')
    ) {
      throw new EisCompletionError('timeout', 'EIS completion timed out');
    }
    throw new EisCompletionError('transport', 'EIS completion failed');
  }
}

/** Probe whether the configured completion endpoint responds (startup / ops). */
export async function probeEisCompletionEndpoint(
  cfg?: AppConfig,
): Promise<{ ok: boolean; elapsed_ms: number; error?: string }> {
  const config = cfg ?? getConfig();
  const t0 = performance.now();
  try {
    await callEisCompletion({
      cfg: config,
      prompt: 'Reply with exactly: {"ok":true}',
      timeout: `${Math.min(config.QUERY_PARSER_TIMEOUT_MS, 2000)}ms`,
    });
    return { ok: true, elapsed_ms: Math.round(performance.now() - t0) };
  } catch (err) {
    return {
      ok: false,
      elapsed_ms: Math.round(performance.now() - t0),
      error: err instanceof EisCompletionError ? err.code : 'transport',
    };
  }
}
