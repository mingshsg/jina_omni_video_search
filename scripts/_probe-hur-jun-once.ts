/**
 * One-off Hur Jun merge probe. Prefer:
 *   yarn tsx scripts/smoke-suggest-agent.ts "H Hur Jun MBC youeuitae 1999"
 */
import { loadDotenv } from './load-dotenv';
import { converseSuggestAgent } from '../lib/metadata/agent-builder-suggest';
import { buildLocalSuggestions } from '../lib/metadata/suggest-local';
import { applyAgentPayloadToLocal } from '../lib/metadata/suggest-web';

async function main() {
  loadDotenv();
  const title =
    process.argv.slice(2).join(' ').trim() || 'H Hur Jun MBC youeuitae 1999';
  const local = buildLocalSuggestions({ title });
  const payload = await converseSuggestAgent({
    rawTitle: title,
    workTitle: local.title_clues.work_title || title,
    yearHint: local.suggestions.year?.value ?? null,
  });
  const merged = applyAgentPayloadToLocal({ local, payload, maxReads: 2 });
  console.log(
    JSON.stringify(
      {
        work_title: local.title_clues.work_title,
        agent_status: payload.status,
        provider: merged.provider,
        suggestions: Object.fromEntries(
          Object.entries(merged.suggestions).map(([key, draft]) => [
            key,
            { value: draft?.value, source: draft?.source },
          ]),
        ),
        actor_count: merged.web?.actor_candidates?.length ?? 0,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
