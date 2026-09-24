import { describe, expect, it } from 'vitest';
import {
  extractConsensusYear,
  applyAgentPayloadToLocal,
  isAllowlistedUrl,
  normalizeAgentActorCandidates,
  pickReadableCandidates,
} from './suggest-web';
import { buildLocalSuggestions } from './suggest-local';

describe('suggest-web allowlist', () => {
  it('accepts Wikidata hosts', () => {
    expect(isAllowlistedUrl('https://www.wikidata.org/wiki/Q123')).toBe(true);
  });

  it('accepts Wikipedia / IMDb / TMDB hosts', () => {
    expect(isAllowlistedUrl('https://en.wikipedia.org/wiki/Film')).toBe(true);
    expect(isAllowlistedUrl('https://www.imdb.com/title/tt0052218/')).toBe(
      true,
    );
    expect(isAllowlistedUrl('https://www.themoviedb.org/movie/1')).toBe(true);
  });

  it('rejects arbitrary hosts', () => {
    expect(isAllowlistedUrl('https://evil.example/wiki/Film')).toBe(false);
    expect(isAllowlistedUrl('http://en.wikipedia.org/wiki/Film')).toBe(false);
    expect(isAllowlistedUrl('not-a-url')).toBe(false);
  });
});

describe('applyAgentPayloadToLocal', () => {
  it('replaces the local title clue with a sourced work description', () => {
    const local = buildLocalSuggestions({ title: '琅琊榜' });
    const result = applyAgentPayloadToLocal({
      local,
      maxReads: 2,
      retrievedAt: '2026-09-23T00:00:00.000Z',
      payload: {
        status: 'ok',
        fields: {
          description: {
            value: 'A Chinese historical drama about political strategy and justice.',
            url: 'https://en.wikipedia.org/wiki/Nirvana_in_Fire',
            evidence: 'The work page identifies the series and premise.',
          },
        },
      },
    });
    expect(result.suggestions.description).toMatchObject({
      source: 'external_web',
      source_url: 'https://en.wikipedia.org/wiki/Nirvana_in_Fire',
      retrieved_at: '2026-09-23T00:00:00.000Z',
    });
    expect(result.suggestions.description?.value).not.toMatch(/^Title clue:/);
  });

  it('drops local Title clue prose when agent is ok but omits description', () => {
    const local = buildLocalSuggestions({ title: 'H Hur Jun MBC youeuitae 1999' });
    expect(local.suggestions.description?.source).toBe('local_title');
    const result = applyAgentPayloadToLocal({
      local,
      maxReads: 2,
      payload: {
        status: 'ok',
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
        },
      },
    });
    expect(result.suggestions.year?.source).toBe('external_web');
    expect(result.suggestions.country?.value).toBe('KR');
    expect(result.suggestions.description).toBeUndefined();
    expect(result.suggestions.abstract).toBeUndefined();
  });

  it('prefers agent synopsis over local Title clue for the same field', () => {
    const local = buildLocalSuggestions({
      title: 'H Hur Jun MBC youeuitae 1999',
    });
    const result = applyAgentPayloadToLocal({
      local,
      maxReads: 2,
      payload: {
        status: 'ok',
        fields: {
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
      },
    });
    expect(result.suggestions.description?.source).toBe('external_web');
    expect(result.suggestions.description?.value).toMatch(/Heo Jun|historical/i);
    expect(result.suggestions.abstract?.source).toBe('external_web');
    expect(result.suggestions.tags).toMatchObject({
      source: 'external_web',
      value: ['historical', 'medical', 'drama'],
    });
  });

  it('applies cited country, language, type, tags, and abstract', () => {
    const local = buildLocalSuggestions({ title: 'B_YourTaste_TastefullyYours_BTS' });
    const result = applyAgentPayloadToLocal({
      local,
      maxReads: 2,
      retrievedAt: '2026-09-23T00:00:00.000Z',
      payload: {
        status: 'ok',
        fields: {
          country: {
            value: 'KR',
            url: 'https://en.wikipedia.org/wiki/Tastefully_Yours',
            evidence: 'South Korean series.',
          },
          primary_language: {
            value: 'ko',
            url: 'https://en.wikipedia.org/wiki/Tastefully_Yours',
            evidence: 'Original language Korean.',
          },
          video_type: {
            value: 'other',
            url: 'https://en.wikipedia.org/wiki/Tastefully_Yours',
            evidence: 'BTS clip in raw_title.',
          },
          abstract: {
            value: 'Tastefully Yours (2025) Korean TV series.',
            url: 'https://en.wikipedia.org/wiki/Tastefully_Yours',
            evidence: 'Work abstract.',
          },
          tags: {
            value: ['romance', 'comedy'],
            url: 'https://en.wikipedia.org/wiki/Tastefully_Yours',
            evidence: 'Genres.',
          },
        },
      },
    });
    expect(result.suggestions.country).toMatchObject({
      value: 'KR',
      source: 'external_web',
    });
    expect(result.suggestions.primary_language?.value).toBe('ko');
    expect(result.suggestions.video_type?.value).toBe('other');
    expect(result.suggestions.abstract?.source).toBe('external_web');
    expect(result.suggestions.tags?.value).toEqual(['romance', 'comedy']);
  });

  it('does not apply proposals for a non-ok status and strips Title clue prose', () => {
    const local = buildLocalSuggestions({ title: 'Same Title' });
    const result = applyAgentPayloadToLocal({
      local,
      maxReads: 2,
      payload: {
        status: 'ambiguous',
        fields: {},
        actors: [],
      },
    });
    expect(result.suggestions.description).toBeUndefined();
    expect(result.suggestions.abstract).toBeUndefined();
    expect(result.web?.actor_candidates).toEqual([]);
  });

  // Regression (todo/30 S2): an explicitly ambiguous agent answer used to
  // still ship a populated web.candidates list, which the client then
  // auto-applied as a confident work_title. `web.candidates` (and `reads`,
  // derived from it) must be empty whenever status !== 'ok', exactly like
  // actor_candidates already is above.
  it('drops web candidates for a non-ok status even when the payload includes them', () => {
    const local = buildLocalSuggestions({ title: 'Some Title' });
    const result = applyAgentPayloadToLocal({
      local,
      maxReads: 2,
      payload: {
        status: 'ambiguous',
        fields: {},
        actors: [],
        candidates: [
          {
            title: 'Oldboy (2003 film) - Wikipedia',
            url: 'https://en.wikipedia.org/wiki/Oldboy_(2003_film)',
            reason: 'Could not disambiguate from three same-named films',
          },
        ],
      },
    });
    expect(result.web?.candidates).toEqual([]);
    expect(result.web?.reads).toEqual([]);
  });

  it('passes the tool-call trace through to web.tool_trace when provided', () => {
    const local = buildLocalSuggestions({ title: '琅琊榜' });
    const trace = [
      { tool_id: 'jina.search_web', query: '琅琊榜 site:wikipedia.org' },
      {
        tool_id: 'jina.read_url',
        question: 'What year did this release?',
        url: 'https://en.wikipedia.org/wiki/Nirvana_in_Fire',
      },
    ];
    const result = applyAgentPayloadToLocal({
      local,
      maxReads: 2,
      toolTrace: trace,
      payload: { status: 'ok', fields: {}, actors: [] },
    });
    expect(result.web?.tool_trace).toEqual(trace);
  });

  it('leaves web.tool_trace undefined when no trace was captured', () => {
    const local = buildLocalSuggestions({ title: '琅琊榜' });
    const result = applyAgentPayloadToLocal({
      local,
      maxReads: 2,
      payload: { status: 'ok', fields: {}, actors: [] },
    });
    expect(result.web?.tool_trace).toBeUndefined();
  });

  // Bug fix (todo/30 S6, 方案 A): a field with no URL, or a URL that isn't on
  // the domain allowlist, used to be silently dropped entirely — the zod
  // schema always treated `url` as optional, so this was a schema/code
  // contradiction, not an intentional trust gate. An agent-asserted fact
  // must still reach the operator, just at a visibly lower confidence and
  // with `evidence` marked `[agent, uncited]` instead of `[agent]`.
  it('still applies a field with no url at all, at a lower confidence', () => {
    const local = buildLocalSuggestions({ title: 'Some Unmatched Title' });
    const result = applyAgentPayloadToLocal({
      local,
      maxReads: 2,
      payload: {
        status: 'ok',
        fields: {
          year: {
            value: 2003,
            evidence: 'The model recalled this without citing a page.',
          },
        },
      },
    });
    expect(result.suggestions.year).toMatchObject({
      value: 2003,
      source: 'external_web',
      confidence: 0.55,
    });
    expect(result.suggestions.year?.evidence).toMatch(/^\[agent, uncited\]/);
    expect(result.suggestions.year?.source_url).toBeUndefined();
  });

  it('still applies a field whose url is not on the domain allowlist', () => {
    const local = buildLocalSuggestions({ title: 'Some Unmatched Title' });
    const result = applyAgentPayloadToLocal({
      local,
      maxReads: 2,
      payload: {
        status: 'ok',
        fields: {
          country: {
            value: 'KR',
            url: 'https://random-fan-blog.example/post',
            evidence: 'A fan blog said so.',
          },
        },
      },
    });
    expect(result.suggestions.country).toMatchObject({
      value: 'KR',
      source: 'external_web',
      confidence: 0.5,
      source_url: 'https://random-fan-blog.example/post',
    });
    expect(result.suggestions.country?.evidence).toMatch(/^\[agent, uncited\]/);
  });

  it('applies a cited field at full confidence with a plain [agent] evidence prefix', () => {
    const local = buildLocalSuggestions({ title: 'Some Unmatched Title' });
    const result = applyAgentPayloadToLocal({
      local,
      maxReads: 2,
      payload: {
        status: 'ok',
        fields: {
          country: {
            value: 'KR',
            url: 'https://en.wikipedia.org/wiki/Some_Show',
            evidence: 'Infobox country field.',
          },
        },
      },
    });
    expect(result.suggestions.country?.confidence).toBe(0.65);
    expect(result.suggestions.country?.evidence).toBe(
      '[agent] Infobox country field.',
    );
  });

  it('omits an http-only source_url even for a discounted uncited fact', () => {
    const local = buildLocalSuggestions({ title: 'Some Unmatched Title' });
    const result = applyAgentPayloadToLocal({
      local,
      maxReads: 2,
      payload: {
        status: 'ok',
        fields: {
          country: {
            value: 'KR',
            url: 'http://random-fan-blog.example/post',
            evidence: 'A fan blog said so.',
          },
        },
      },
    });
    // http-only URLs can't be saved as field_provenance.source_url (that
    // schema requires https) — omit rather than ship an unsavable draft.
    expect(result.suggestions.country?.source_url).toBeUndefined();
  });

  it('collects reference_urls from cited fields, candidates, and actors, deduped', () => {
    const local = buildLocalSuggestions({ title: 'Some Unmatched Title' });
    const result = applyAgentPayloadToLocal({
      local,
      maxReads: 2,
      payload: {
        status: 'ok',
        fields: {
          year: {
            value: 2003,
            url: 'https://en.wikipedia.org/wiki/Some_Show',
            evidence: 'Infobox year.',
          },
          country: {
            value: 'KR',
            url: 'https://en.wikipedia.org/wiki/Some_Show',
            evidence: 'Same page — should dedup.',
          },
        },
        candidates: [
          {
            title: 'Some Show - Wikipedia',
            url: 'https://en.wikipedia.org/wiki/Some_Show',
          },
          {
            title: 'Some Show - IMDb',
            url: 'https://www.imdb.com/title/tt0000000/',
          },
        ],
        actors: [
          {
            names: { en: 'Jane Doe' },
            url: 'https://www.imdb.com/name/nm0000000/',
          },
        ],
      },
    });
    expect(result.suggestions.reference_urls?.value).toEqual([
      'https://en.wikipedia.org/wiki/Some_Show',
      'https://www.imdb.com/title/tt0000000/',
      'https://www.imdb.com/name/nm0000000/',
    ]);
  });

  it('includes uncited/non-allowlisted urls in reference_urls even though they were not cited', () => {
    const local = buildLocalSuggestions({ title: 'Some Unmatched Title' });
    const result = applyAgentPayloadToLocal({
      local,
      maxReads: 2,
      payload: {
        status: 'ok',
        fields: {
          country: {
            value: 'KR',
            url: 'https://random-fan-blog.example/post',
            evidence: 'A fan blog said so.',
          },
        },
      },
    });
    expect(result.suggestions.reference_urls?.value).toEqual([
      'https://random-fan-blog.example/post',
    ]);
  });

  it('omits reference_urls entirely when the payload has no urls at all', () => {
    const local = buildLocalSuggestions({ title: 'Some Unmatched Title' });
    const result = applyAgentPayloadToLocal({
      local,
      maxReads: 2,
      payload: {
        status: 'ok',
        fields: {
          year: { value: 2003, evidence: 'No citation.' },
        },
      },
    });
    expect(result.suggestions.reference_urls).toBeUndefined();
  });
});

describe('pickReadableCandidates', () => {
  it('prefers allowlisted title matches', () => {
    const picked = pickReadableCandidates(
      [
        {
          title: 'Random blog',
          url: 'https://blog.example/post',
          description: 'x',
        },
        {
          title: "Breakfast at Tiffany's",
          url: 'https://en.wikipedia.org/wiki/Breakfast_at_Tiffany%27s_(film)',
          description: '1961 film',
        },
      ],
      "Breakfast at Tiffany's",
      2,
    );
    expect(picked).toHaveLength(1);
    expect(picked[0]!.url).toContain('wikipedia.org');
  });
});

describe('extractConsensusYear', () => {
  it('returns a unique majority year', () => {
    expect(
      extractConsensusYear([
        'Released in 1961 in New York',
        'The 1961 romantic comedy',
      ])?.year,
    ).toBe(1961);
  });

  it('abstains when years conflict equally', () => {
    expect(
      extractConsensusYear(['Released in 1961', 'Remake in 2001']),
    ).toBeNull();
  });
});

describe('normalizeAgentActorCandidates', () => {
  it('resolves multilingual names to one controlled person id', () => {
    const { candidates } = normalizeAgentActorCandidates([
      {
        names: {
          en: 'Lee Jung-jae',
          zh: '李政宰',
          native: { lang: 'ko', name: '이정재' },
        },
        character: 'Seong Gi-hun',
        url: 'https://en.wikipedia.org/wiki/Lee_Jung-jae',
        evidence: 'Listed in the principal cast.',
      },
    ]);
    const [actor] = candidates;
    expect(actor).toMatchObject({
      matched_person_id: 'person:lee-jung-jae',
      names: {
        en: 'Lee Jung-jae',
        zh: '李政宰',
        native: { lang: 'ko', name: '이정재' },
      },
    });
  });

  it('keeps a sourced unknown actor unresolved and rejects unsafe entries', () => {
    const { candidates: actors, dropped_uncited } = normalizeAgentActorCandidates([
      {
        names: { en: 'New Korean Actor', native: { lang: 'ko', name: '새 배우' } },
        url: 'https://ko.wikipedia.org/wiki/New_actor',
        evidence: 'Principal cast.',
      },
      {
        names: { en: 'Unsafe Result' },
        url: 'https://example.invalid/person',
        evidence: 'Untrusted.',
      },
      {
        names: { native: { lang: 'ko', name: '영문 이름 없음' } },
        url: 'https://ko.wikipedia.org/wiki/Missing_English_name',
        evidence: 'Missing required English name.',
      },
    ]);
    expect(actors).toHaveLength(1);
    expect(actors[0]).toMatchObject({
      names: { en: 'New Korean Actor', native: { lang: 'ko', name: '새 배우' } },
      matched_person_id: null,
    });
    // Regression (todo/32 R1): the non-allowlisted entry must be *counted*,
    // not silently vanish. The entry missing an English name is malformed
    // agent output rather than a policy drop, so it is not counted.
    expect(dropped_uncited).toBe(1);
  });

  it('reports uncited cast drops through web.actor_candidates_dropped', () => {
    const local = buildLocalSuggestions({ title: 'Some Title' });
    const result = applyAgentPayloadToLocal({
      local,
      maxReads: 2,
      payload: {
        status: 'ok',
        fields: {},
        actors: [
          {
            names: { en: 'Trusted Person' },
            url: 'https://en.wikipedia.org/wiki/Trusted',
            evidence: 'Cast list.',
          },
          {
            names: { en: 'Untrusted Person' },
            url: 'https://random-blog.example/person',
            evidence: 'Fan blog.',
          },
          {
            names: { en: 'No Source Person' },
            evidence: 'No url at all.',
          },
        ],
      },
    });
    expect(result.web?.actor_candidates).toHaveLength(1);
    expect(result.web?.actor_candidates_dropped).toBe(2);
  });
});
