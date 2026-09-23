import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { callEisCompletion, EisCompletionError } = vi.hoisted(() => {
  class EisCompletionError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.name = 'EisCompletionError';
      this.code = code;
    }
  }
  return {
    EisCompletionError,
    callEisCompletion: vi.fn(),
  };
});

vi.mock('./eis-completion', () => ({
  EisCompletionError,
  callEisCompletion,
  probeEisCompletionEndpoint: vi.fn(),
}));

import { loadPeopleCatalog } from './people';
import { parseQueryDictionary } from './query-parse';
import { PARSE_EVAL_CASES, overTriggerRate } from './parse-eval';
import { resetQueryParseCacheForTests } from './parse-cache';
import { resolveQueryParse, shouldSkipEis } from './resolve-query-parse';
import {
  extractJsonObject,
  validateEisParsePayload,
} from './validate-eis-parse';

const eisCfg = {
  QUERY_PARSER_PROVIDER: 'eis',
  QUERY_PARSER_INFERENCE_ID: 'test-completion',
  QUERY_PARSER_TIMEOUT_MS: 800,
  QUERY_PARSER_MAX_TOKENS: 256,
  QUERY_PARSER_FACET_MODE: 'boost',
  QUERY_PARSER_CACHE_TTL_MS: 60_000,
  QUERY_PARSER_CACHE_MAX: 32,
  QUERY_PARSER_CONCURRENCY: 2,
} as never;

describe('shouldSkipEis', () => {
  beforeAll(() => {
    loadPeopleCatalog(true);
  });

  it('skips exact full-string alias matches', () => {
    const dict = parseQueryDictionary('Audrey Hepburn');
    expect(shouldSkipEis('Audrey Hepburn', dict)).toEqual({
      skip: true,
      reason: 'exact_alias',
    });
  });

  it('skips pure scene queries with no catalog hits', () => {
    const dict = parseQueryDictionary('person running through rain');
    expect(shouldSkipEis('person running through rain', dict).skip).toBe(true);
  });

  it('does not skip CJK generalization phrases with no catalog hit', () => {
    const dict = parseQueryDictionary('南朝鲜的片子');
    expect(shouldSkipEis('南朝鲜的片子', dict).skip).toBe(false);
  });

  it('does not skip name-plus-scene (needs disambiguation path)', () => {
    const dict = parseQueryDictionary('Audrey Hepburn interview');
    expect(shouldSkipEis('Audrey Hepburn interview', dict).skip).toBe(false);
  });
});

describe('validateEisParsePayload', () => {
  beforeAll(() => {
    loadPeopleCatalog(true);
  });

  it('accepts catalog values and rejects inventions', () => {
    const raw = extractJsonObject(
      JSON.stringify({
        vector_query: 'running',
        free_text: 'Audrey Hepburn',
        actor_ids: ['person:audrey-hepburn', 'person:nobody'],
        country: ['US', 'XX'],
        video_type: ['trailer', 'soap'],
        year_from: 1960,
        year_to: 1965,
      }),
    );
    const v = validateEisParsePayload(raw);
    expect(v.extracted.actor_ids).toEqual(['person:audrey-hepburn']);
    expect(v.extracted.country).toEqual(['US']);
    expect(v.extracted.video_type).toEqual(['trailer']);
    expect(v.rejected.some((r) => r.value === 'person:nobody')).toBe(true);
    expect(v.rejected.some((r) => r.value === 'XX')).toBe(true);
    expect(v.rejected.some((r) => r.value === 'soap')).toBe(true);
  });

  it('marks explicit null fields as cleared', () => {
    const raw = extractJsonObject(
      JSON.stringify({
        vector_query: 'interview',
        free_text: 'Audrey Hepburn',
        actor_ids: ['person:audrey-hepburn'],
        video_type: null,
        country: null,
        year_from: null,
        year_to: null,
      }),
    );
    const v = validateEisParsePayload(raw);
    expect(v.cleared.has('video_type')).toBe(true);
    expect(v.cleared.has('country')).toBe(true);
    expect(v.extracted.video_type).toBeUndefined();
  });

  it('rejects catalog actors outside the candidate set', () => {
    const raw = {
      actor_ids: ['person:audrey-hepburn', 'person:song-kang-ho'],
    };
    const v = validateEisParsePayload(raw, {
      allowedActorIds: new Set(['person:audrey-hepburn']),
    });
    expect(v.extracted.actor_ids).toEqual(['person:audrey-hepburn']);
    expect(
      v.rejected.some(
        (r) =>
          r.value === 'person:song-kang-ho' &&
          r.reason === 'not in candidate set',
      ),
    ).toBe(true);
  });

  it('extracts JSON from markdown fences', () => {
    const raw = extractJsonObject(
      '```json\n{"vector_query":"a","free_text":null}\n```',
    );
    expect(raw).toEqual({ vector_query: 'a', free_text: null });
  });
});

describe('dictionary over-trigger on labeled set', () => {
  beforeAll(() => {
    loadPeopleCatalog(true);
  });

  it('keeps over-trigger rate under 25% on the pinned eval set', () => {
    const rows = PARSE_EVAL_CASES.map((c) => {
      const parsed = parseQueryDictionary(c.query);
      return { expected: c.expected, extracted: parsed.extracted };
    });
    const { rate, over, total } = overTriggerRate(rows);
    expect(total).toBe(PARSE_EVAL_CASES.length);
    expect(rate).toBeLessThan(0.25);
    expect(over).toBeLessThanOrEqual(Math.floor(total * 0.25));
  });
});

describe('resolveQueryParse with mocked EIS', () => {
  beforeAll(() => {
    loadPeopleCatalog(true);
  });

  beforeEach(() => {
    resetQueryParseCacheForTests();
    callEisCompletion.mockReset();
  });

  it('falls back to dictionary when EIS times out', async () => {
    callEisCompletion.mockRejectedValue(
      new EisCompletionError('timeout', 'timed out'),
    );
    const result = await resolveQueryParse({
      query: 'Audrey Hepburn interview',
      cfg: eisCfg,
    });
    expect(result.parser).toBe('dictionary');
    expect(result.eis_skip_reason).toBe('timeout');
    expect(result.extracted.actor_ids).toEqual(['person:audrey-hepburn']);
  });

  it('uses EIS JSON when valid', async () => {
    callEisCompletion.mockResolvedValue(
      JSON.stringify({
        vector_query: 'interview',
        free_text: 'Audrey Hepburn',
        actor_ids: ['person:audrey-hepburn'],
        video_type: ['interview'],
        country: null,
        year_from: null,
        year_to: null,
      }),
    );
    const result = await resolveQueryParse({
      query: 'Audrey Hepburn interview',
      cfg: eisCfg,
    });
    expect(result.parser).toBe('eis');
    expect(result.vector_query.toLowerCase()).toContain('interview');
    expect(result.extracted.actor_ids).toEqual(['person:audrey-hepburn']);
    expect(result.extracted.video_type).toEqual(['interview']);
    expect(callEisCompletion).toHaveBeenCalled();
  });

  it('lets EIS null clear a dictionary video_type guess', async () => {
    callEisCompletion.mockResolvedValue(
      JSON.stringify({
        vector_query: 'interview',
        free_text: 'Audrey Hepburn',
        actor_ids: ['person:audrey-hepburn'],
        video_type: null,
        country: null,
        year_from: null,
        year_to: null,
      }),
    );
    const dict = parseQueryDictionary('Audrey Hepburn interview');
    expect(dict.extracted.video_type).toEqual(['interview']);

    const result = await resolveQueryParse({
      query: 'Audrey Hepburn interview',
      cfg: eisCfg,
    });
    expect(result.parser).toBe('eis');
    expect(result.extracted.video_type).toBeUndefined();
    expect(result.vector_query.toLowerCase()).toContain('interview');
  });

  it('skips EIS for exact aliases without calling completion', async () => {
    const result = await resolveQueryParse({
      query: 'Audrey Hepburn',
      cfg: eisCfg,
    });
    expect(result.parser).toBe('dictionary');
    expect(result.eis_skipped).toBe(true);
    expect(callEisCompletion).not.toHaveBeenCalled();
  });
});
