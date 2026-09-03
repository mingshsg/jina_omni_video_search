import { Client } from '@elastic/elasticsearch';
import { getConfig } from '../config';

let cached: Client | null = null;

/** Server-side Elasticsearch client singleton (do not import from client components). */
export function getEsClient(): Client {
  if (!cached) {
    const cfg = getConfig();
    cached = new Client({
      node: cfg.ELASTICSEARCH_URL,
      auth: { apiKey: cfg.ELASTICSEARCH_API_KEY },
    });
  }
  return cached;
}

/** Reset singleton — for scripts/tests only. */
export function resetEsClient(): void {
  cached = null;
}
