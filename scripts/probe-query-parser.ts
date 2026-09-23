/**
 * Probe / create guidance for the EIS completion endpoint used by Phase 3.6.
 *
 * Does NOT create the endpoint (requires cluster privileges + model choice).
 * When QUERY_PARSER_PROVIDER=eis and QUERY_PARSER_INFERENCE_ID is set, calls
 * completion once and prints ok/elapsed — never prints the API key.
 *
 * Usage: yarn tsx scripts/probe-query-parser.ts
 */
import { loadConfig } from '../lib/config';
import { probeEisCompletionEndpoint } from '../lib/metadata/eis-completion';

async function main() {
  const cfg = loadConfig();
  if (cfg.QUERY_PARSER_PROVIDER !== 'eis') {
    console.log(
      JSON.stringify({
        ok: false,
        skipped: true,
        reason: 'QUERY_PARSER_PROVIDER is not eis',
        provider: cfg.QUERY_PARSER_PROVIDER,
      }),
    );
    return;
  }
  if (!cfg.QUERY_PARSER_INFERENCE_ID.trim()) {
    console.log(
      JSON.stringify({
        ok: false,
        error: 'QUERY_PARSER_INFERENCE_ID is required',
      }),
    );
    process.exitCode = 1;
    return;
  }

  const result = await probeEisCompletionEndpoint(cfg);
  console.log(
    JSON.stringify({
      ok: result.ok,
      elapsed_ms: result.elapsed_ms,
      inference_id: cfg.QUERY_PARSER_INFERENCE_ID,
      // No secrets. Model id is resolved server-side on the inference endpoint.
      error: result.error ?? null,
      hint: result.ok
        ? null
        : 'Create a completion endpoint backed by google-gemini-3.5-flash-lite via PUT _inference/completion/<id>, then set QUERY_PARSER_INFERENCE_ID.',
    }),
  );
  if (!result.ok) process.exitCode = 1;
}

main().catch((err) => {
  console.error(
    JSON.stringify({
      ok: false,
      error: err instanceof Error ? err.message.replace(/ApiKey\s+\S+/gi, 'ApiKey [redacted]') : 'probe_failed',
    }),
  );
  process.exitCode = 1;
});
