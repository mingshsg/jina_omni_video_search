/**
 * Read-only/cost-bearing Agent Builder smoke for grounded title lookup.
 * Usage: yarn tsx scripts/smoke-suggest-agent.ts "더 글로리"
 */
import { converseSuggestAgent } from '../lib/metadata/agent-builder-suggest';
import { loadDotenv } from './load-dotenv';

async function main() {
  loadDotenv();
  const title = process.argv.slice(2).join(' ').trim();
  if (!title) {
    throw new Error('Pass one film or drama title');
  }
  const result = await converseSuggestAgent({
    rawTitle: title,
    workTitle: title,
  });
  console.log(
    JSON.stringify(
      {
        title,
        status: result.status,
        candidate_count: result.candidates?.length ?? 0,
        candidates: (result.candidates ?? []).map((candidate) => ({
          title: candidate.title ?? null,
          url: candidate.url ?? null,
          year: candidate.year ?? null,
        })),
        fields: {
          year: result.fields?.year?.value ?? null,
          country: result.fields?.country?.value ?? null,
          primary_language: result.fields?.primary_language?.value ?? null,
          video_type: result.fields?.video_type?.value ?? null,
          description: result.fields?.description?.value ?? null,
          abstract: result.fields?.abstract?.value ?? null,
          tags: result.fields?.tags?.value ?? null,
        },
        description_source: result.fields?.description?.url ?? null,
        actors: (result.actors ?? []).map((actor) => ({
          names: actor.names ?? null,
          source: actor.url ?? null,
        })),
        notes: result.notes ?? null,
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
