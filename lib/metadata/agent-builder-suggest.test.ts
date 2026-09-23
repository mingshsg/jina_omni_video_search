import { describe, expect, it } from 'vitest';
import {
  AgentBuilderError,
  extractAgentJson,
  extractConverseMessage,
  parseAgentSuggestPayload,
  sanitizeAgentSuggestRaw,
  stripNullKeys,
} from './agent-builder-suggest';

describe('parseAgentSuggestPayload', () => {
  it('accepts one bounded ok payload', () => {
    const parsed = parseAgentSuggestPayload({
      status: 'ok',
      candidates: [
        {
          title: 'The Glory',
          url: 'https://en.wikipedia.org/wiki/The_Glory_(TV_series)',
          year: 2022,
          reason: 'Exact English and Hangul title match.',
        },
      ],
      fields: {
        year: {
          value: 2022,
          url: 'https://en.wikipedia.org/wiki/The_Glory_(TV_series)',
          evidence: 'The page lists the release year.',
        },
      },
      actors: [],
      notes: 'Unique match.',
    });
    expect(parsed.status).toBe('ok');
  });

  it('accepts richer work-level fields and tags', () => {
    const parsed = parseAgentSuggestPayload({
      status: 'ok',
      fields: {
        year: {
          value: 2025,
          url: 'https://en.wikipedia.org/wiki/Tastefully_Yours',
          evidence: 'First aired in 2025.',
        },
        country: {
          value: 'KR',
          url: 'https://en.wikipedia.org/wiki/Tastefully_Yours',
          evidence: 'South Korean television series.',
        },
        primary_language: {
          value: 'ko',
          url: 'https://en.wikipedia.org/wiki/Tastefully_Yours',
          evidence: 'Original language Korean.',
        },
        video_type: {
          value: 'other',
          url: 'https://en.wikipedia.org/wiki/Tastefully_Yours',
          evidence: 'raw_title contains BTS clip cue.',
        },
        description: {
          value: 'A South Korean romantic comedy television series.',
          url: 'https://en.wikipedia.org/wiki/Tastefully_Yours',
          evidence: 'Lead synopsis.',
        },
        abstract: {
          value: 'Tastefully Yours (2025) — South Korean TV series.',
          url: 'https://en.wikipedia.org/wiki/Tastefully_Yours',
          evidence: 'Work identity.',
        },
        tags: {
          value: ['romance', 'comedy'],
          url: 'https://en.wikipedia.org/wiki/Tastefully_Yours',
          evidence: 'Genre list.',
        },
      },
      actors: [],
      notes: 'Unique match.',
    });
    expect(parsed.fields?.country?.value).toBe('KR');
    expect(parsed.fields?.tags?.value).toEqual(['romance', 'comedy']);
  });

  it('rejects proposals attached to an ambiguous response', () => {
    expect(() =>
      parseAgentSuggestPayload({
        status: 'ambiguous',
        fields: {
          year: {
            value: 2022,
            url: 'https://en.wikipedia.org/wiki/Example',
          },
        },
        actors: [],
      }),
    ).toThrow(AgentBuilderError);
  });

  it('truncates over-budget candidates to three', () => {
    const parsed = parseAgentSuggestPayload({
      status: 'ok',
      candidates: Array.from({ length: 4 }, (_, index) => ({
        title: `Candidate ${index}`,
        url: `https://en.wikipedia.org/wiki/Candidate_${index}`,
      })),
    });
    expect(parsed.candidates).toHaveLength(3);
  });

  it('strips null language keys and still accepts realistic live actor payloads', () => {
    const parsed = parseAgentSuggestPayload({
      status: 'ok',
      fields: {
        year: {
          value: 1961,
          url: "https://en.wikipedia.org/wiki/Breakfast_at_Tiffany's_(film)",
          evidence: '1961 American romantic comedy film.',
        },
      },
      actors: [
        {
          names: {
            en: 'Audrey Hepburn',
            zh: null,
            ko: null,
            ja: null,
          },
          character: null,
          url: "https://en.wikipedia.org/wiki/Breakfast_at_Tiffany's_(film)",
          evidence: 'Lead actress.',
        },
      ],
    });
    expect(parsed.actors?.[0]?.names).toEqual({ en: 'Audrey Hepburn' });
    expect(parsed.actors?.[0]?.character).toBeUndefined();
  });

  it('drops null field stubs and coerces year/tag strings', () => {
    const parsed = parseAgentSuggestPayload({
      status: 'ok',
      fields: {
        year: {
          value: '1961',
          url: 'https://en.wikipedia.org/wiki/Example',
          evidence: 'Year string.',
        },
        country: null,
        tags: {
          value: 'romance, comedy',
          url: 'https://en.wikipedia.org/wiki/Example',
          evidence: 'Genre line.',
        },
        description: {
          value: null,
          url: null,
          evidence: '',
        },
      },
      surprise: true,
    });
    expect(parsed.fields?.year?.value).toBe(1961);
    expect(parsed.fields?.tags?.value).toEqual(['romance', 'comedy']);
    expect(parsed.fields?.country).toBeUndefined();
    expect(parsed.fields?.description).toBeUndefined();
  });

  it('parses a rich omit-null Hur Jun-style payload', () => {
    const parsed = parseAgentSuggestPayload({
      status: 'ok',
      candidates: [
        {
          title: 'Hur Jun (TV series)',
          url: 'https://en.wikipedia.org/wiki/Hur_Jun_(TV_series)',
          year: 1999,
          reason: 'Exact match for the 1999 MBC series.',
        },
      ],
      fields: {
        year: {
          value: 1999,
          url: 'https://en.wikipedia.org/wiki/Hur_Jun_(TV_series)',
          evidence: 'First aired in 1999.',
        },
        country: {
          value: 'KR',
          url: 'https://en.wikipedia.org/wiki/Hur_Jun_(TV_series)',
          evidence: 'South Korean series.',
        },
        primary_language: {
          value: 'ko',
          url: 'https://en.wikipedia.org/wiki/Hur_Jun_(TV_series)',
          evidence: 'Original language Korean.',
        },
        video_type: {
          value: 'tv_episode',
          url: 'https://en.wikipedia.org/wiki/Hur_Jun_(TV_series)',
          evidence: 'Television series.',
        },
        description: {
          value:
            'A South Korean historical television series about Joseon-era doctor Heo Jun.',
          url: 'https://en.wikipedia.org/wiki/Hur_Jun_(TV_series)',
          evidence: 'Work synopsis; not file content.',
        },
        abstract: {
          value: 'Hur Jun (1999) — South Korean historical TV series.',
          url: 'https://en.wikipedia.org/wiki/Hur_Jun_(TV_series)',
          evidence: 'Work identity.',
        },
        tags: {
          value: ['historical', 'medical', 'drama'],
          url: 'https://en.wikipedia.org/wiki/Hur_Jun_(TV_series)',
          evidence: 'Genres.',
        },
      },
      actors: [
        {
          names: { en: 'Jun Kwang-ryul', ko: '전광렬' },
          url: 'https://en.wikipedia.org/wiki/Hur_Jun_(TV_series)',
          evidence: 'Principal cast.',
        },
      ],
      notes: 'Unique match.',
    });
    expect(parsed.fields?.description?.value).toMatch(/Heo Jun/);
    expect(parsed.fields?.country?.value).toBe('KR');
    expect(parsed.fields?.tags?.value).toEqual([
      'historical',
      'medical',
      'drama',
    ]);
    expect(parsed.actors?.[0]?.names).toEqual({
      en: 'Jun Kwang-ryul',
      ko: '전광렬',
    });
  });
});

describe('extractAgentJson', () => {
  it('parses plain JSON', () => {
    expect(extractAgentJson('{"status":"empty"}')).toEqual({ status: 'empty' });
  });

  it('parses fenced JSON with prose', () => {
    const message = `Here is the result:\n\`\`\`json\n{"status":"ok","notes":"done"}\n\`\`\`\nThanks.`;
    expect(extractAgentJson(message)).toEqual({ status: 'ok', notes: 'done' });
  });

  it('prefers the last fenced block when tool chatter precedes the answer', () => {
    const message = `
Tool thought about candidates.
\`\`\`json
{"partial": true}
\`\`\`
Final answer:
\`\`\`json
{"status":"ok","fields":{"year":{"value":2022,"url":"https://en.wikipedia.org/wiki/X","evidence":"y"}}}
\`\`\`
`;
    const parsed = extractAgentJson(message) as { status: string };
    expect(parsed.status).toBe('ok');
  });

  it('extracts JSON object embedded in wrapper text', () => {
    const message =
      'Result wrapper: {"tool":"done"} then answer {"status":"ambiguous","notes":"two works"} end';
    expect(extractAgentJson(message)).toEqual({
      status: 'ambiguous',
      notes: 'two works',
    });
  });
});

describe('extractConverseMessage', () => {
  it('reads response.message from a live-shaped converse body', () => {
    const message = extractConverseMessage({
      conversation_id: 'x',
      steps: [],
      response: { message: '{"status":"empty"}' },
    });
    expect(message).toBe('{"status":"empty"}');
  });

  it('falls back to step content when response.message is missing', () => {
    const message = extractConverseMessage({
      steps: [
        {
          type: 'tool_call',
          results: [{ data: { content: 'noise' } }],
        },
        {
          type: 'assistant',
          message: '{"status":"ok","notes":"from step"}',
        },
      ],
      response: {},
    });
    expect(message).toContain('"status":"ok"');
  });
});

describe('sanitize / stripNullKeys', () => {
  it('removes null keys deeply', () => {
    expect(
      stripNullKeys({
        a: 1,
        b: null,
        c: { d: null, e: 'x' },
      }),
    ).toEqual({ a: 1, c: { e: 'x' } });
  });

  it('keeps only known top-level keys', () => {
    const cleaned = sanitizeAgentSuggestRaw({
      status: 'empty',
      notes: 'none',
      model_confidence: 0.9,
    });
    expect(cleaned).toEqual({ status: 'empty', notes: 'none' });
  });
});
