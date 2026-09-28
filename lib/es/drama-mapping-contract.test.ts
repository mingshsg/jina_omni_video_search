import { describe, expect, it } from 'vitest';
import { videoAssetsMetaMappingProperties } from './asset-meta-mapping';
import { videoAssetsJobMappingProperties } from './indices';
import type { DramaMetaPayload } from '../drama/persist-meta';

type MappingNode = {
  type?: string;
  properties?: Record<string, MappingNode>;
};

/**
 * I1: every field persistDramaMeta writes must exist in the strict
 * `meta.drama` mapping (create body and upgrade diff share this source).
 * A payload exercising all optional fields is walked against the mapping;
 * any missing leaf fails loudly instead of failing as a live ES rejection.
 */
function fullPayload(): DramaMetaPayload {
  return {
    run_id: 'run1',
    enrichment_status: 'partial',
    modules: ['structure', 'subtitles', 'directors_script', 'key_actors', 'key_scenes'],
    languages: ['zh', 'en'],
    modules_done: ['structure', 'subtitles'],
    structure: [
      {
        kind: 'body',
        start_ms: 0,
        end_ms: 60_000,
        confidence: 0.5,
        source: 'heuristic',
      },
    ],
    synopsis_zh: 'zh',
    synopsis_en: 'en',
    synopsis_status: 'provisional',
    directors_script_zh_path: 'scripts/zh.md',
    directors_script_en_path: 'scripts/en.md',
    directors_script_raw_path: 'scripts/raw.md',
    subtitle_paths: ['subtitles/zh.srt'],
    key_actors: [
      {
        role_zh: '甄嬛',
        role_en: 'Zhen Huan',
        person_id: 'p1',
        thumb_path: 'faces/c.jpg',
        verified: false,
        t_ms: 61_000,
      },
    ],
    key_scenes: [
      {
        start_ms: 60_000,
        end_ms: 90_000,
        summary_zh: 's',
        summary_en: 's',
        thumb_path: 'scenes/s.jpg',
      },
    ],
    error: { code: 'DRAMA_ENRICHMENT_ERROR', message: 'boom' },
  };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function checkValue(path: string, value: unknown, node: MappingNode | undefined): string[] {
  const missing: string[] = [];
  if (value === undefined) return missing;
  if (node === undefined) {
    missing.push(path);
    return missing;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      missing.push(...checkValue(`${path}[]`, item, node));
    }
    return missing;
  }
  if (isPlainObject(value)) {
    const props = node.properties;
    if (props === undefined) {
      missing.push(`${path} (object without mapped properties)`);
      return missing;
    }
    for (const [k, v] of Object.entries(value)) {
      missing.push(...checkValue(`${path}.${k}`, v, props[k]));
    }
    return missing;
  }
  return missing;
}

describe('drama mapping/payload contract (I1)', () => {
  it('maps every persisted meta.drama field', () => {
    const meta = videoAssetsMetaMappingProperties() as unknown as {
      meta: MappingNode;
    };
    const drama = meta.meta.properties?.drama;
    expect(drama, 'meta.drama mapping exists').toBeDefined();
    const missing = checkValue('meta.drama', fullPayload(), drama);
    expect(missing).toEqual([]);
  });

  it('covers the previously missing fields explicitly', () => {
    const meta = videoAssetsMetaMappingProperties() as unknown as {
      meta: MappingNode;
    };
    const props = meta.meta.properties?.drama?.properties ?? {};
    expect(props.modules_done).toBeDefined();
    expect(
      (props.error as MappingNode | undefined)?.properties?.code,
    ).toBeDefined();
    expect(
      (props.error as MappingNode | undefined)?.properties?.message,
    ).toBeDefined();
    expect(
      (props.key_actors as MappingNode | undefined)?.properties?.role_en,
    ).toBeDefined();
  });

  it('maps the durable job.drama request record (I4)', () => {
    const jobProps = videoAssetsJobMappingProperties() as Record<
      string,
      MappingNode
    >;
    const dramaProps = jobProps.drama?.properties ?? {};
    for (const field of [
      'status',
      'languages',
      'modules',
      'modules_done',
      'run_id',
      'error_code',
      'error_message',
    ]) {
      expect(dramaProps[field], `job.drama.${field} mapped`).toBeDefined();
    }
  });
});
