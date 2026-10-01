/**
 * Persist meta.drama on the asset without bumping editorial revision.
 * Does not replace other meta fields (partial script update).
 */
import { getConfig } from '../config';
import { getEsClient } from '../es/client';
import type { StructureInterval } from './structure';
import type { DramaDirectorCoverage, DramaLanguage, DramaModule, DramaSubtitleSource } from '../ingest/drama-options';

export interface DramaMetaPayload {
  run_id: string;
  enrichment_status: 'pending' | 'running' | 'succeeded' | 'failed' | 'partial';
  modules: DramaModule[];
  languages: DramaLanguage[];
  /** Persist the selected policy so restart/retry cannot change providers. */
  subtitle_source?: DramaSubtitleSource;
  source_language?: 'en' | 'zh';
  director_coverage?: DramaDirectorCoverage;
  structure?: StructureInterval[];
  synopsis_zh?: string;
  synopsis_en?: string;
  /**
   * Evidence gate (F2): `audited` only when an independent auditor
   * returned `supported` against timed evidence. Anything else —
   * skipped, failed, unparseable, insufficient, contradicted (the last
   * two never reach here; they veto) — persists as `provisional`.
   * Consumers (search/editor, P4) must treat `provisional` as
   * review-needed, never as accepted verified metadata.
   */
  synopsis_status?: 'audited' | 'provisional';
  directors_script_zh_path?: string;
  directors_script_en_path?: string;
  directors_script_raw_path?: string;
  subtitle_paths?: string[];
  key_actors?: Array<{
    role_zh: string;
    role_en?: string;
    person_id?: string;
    thumb_path?: string;
    verified: boolean;
    t_ms?: number;
  }>;
  key_scenes?: Array<{
    start_ms: number;
    end_ms: number;
    summary_zh?: string;
    summary_en?: string;
    thumb_path?: string;
  }>;
  modules_done?: DramaModule[];
  error?: { code: string; message: string };
}

const PAINLESS = `
  if (ctx._source.meta == null) {
    ctx._source.meta = new HashMap();
  }
  ctx._source.meta.drama = params.drama;
  ctx._source.updated_at = params.now;
`;

export async function persistDramaMeta(
  videoId: string,
  drama: DramaMetaPayload,
): Promise<void> {
  const client = getEsClient();
  const cfg = getConfig();
  await client.update({
    index: cfg.ES_INDEX_ASSETS,
    id: videoId,
    refresh: 'wait_for',
    retry_on_conflict: 3,
    script: {
      source: PAINLESS,
      lang: 'painless',
      params: {
        drama,
        now: new Date().toISOString(),
      },
    },
  });
}
