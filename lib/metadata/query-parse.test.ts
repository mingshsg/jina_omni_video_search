import { describe, expect, it, beforeAll } from 'vitest';
import { loadPeopleCatalog } from './people';
import {
  boostsMinusHardFilters,
  extractYears,
  parseQueryDictionary,
} from './query-parse';

describe('parseQueryDictionary', () => {
  beforeAll(() => {
    loadPeopleCatalog(true);
  });

  it('splits name-plus-scene into free_text and vector residual', () => {
    const parsed = parseQueryDictionary('Audrey Hepburn running');
    expect(parsed.extracted.actor_ids).toEqual(['person:audrey-hepburn']);
    expect(parsed.free_text.toLowerCase()).toContain('audrey hepburn');
    expect(parsed.vector_query.toLowerCase()).toContain('running');
    expect(parsed.scene_terms_present).toBe(true);
    expect(parsed.parser).toBe('dictionary');
  });

  // Regression (todo/22 F2): free_text used to drop the residual whenever an
  // actor matched, so title terms never reached BM25 — only the alias did.
  it('keeps non-actor terms in free_text alongside a matched actor', () => {
    const parsed = parseQueryDictionary('Audrey Hepburn Roman Holiday');
    expect(parsed.extracted.actor_ids).toEqual(['person:audrey-hepburn']);
    expect(parsed.free_text.toLowerCase()).toContain('audrey hepburn');
    expect(parsed.free_text.toLowerCase()).toContain('roman holiday');
    expect(parsed.vector_query.toLowerCase()).toContain('roman holiday');
  });

  it('marks name-only queries as lacking scene terms', () => {
    const parsed = parseQueryDictionary('Audrey Hepburn');
    expect(parsed.extracted.actor_ids).toEqual(['person:audrey-hepburn']);
    expect(parsed.scene_terms_present).toBe(false);
  });

  it('extracts country demonyms and video-type synonyms', () => {
    const parsed = parseQueryDictionary('Korean trailer 1960s');
    expect(parsed.extracted.country).toEqual(['KR']);
    expect(parsed.extracted.video_type).toEqual(['trailer']);
    expect(parsed.extracted.year_from).toBe(1960);
    expect(parsed.extracted.year_to).toBe(1969);
  });

  it('extracts a single year', () => {
    const years = extractYears('film from 1961');
    expect(years.year_from).toBe(1961);
    expect(years.year_to).toBe(1961);
  });
});

describe('boostsMinusHardFilters', () => {
  it('drops extracted facets already selected as hard filters', () => {
    const out = boostsMinusHardFilters(
      {
        actor_ids: ['person:audrey-hepburn'],
        country: ['US'],
        year_from: 1960,
      },
      { actor_ids: ['person:audrey-hepburn'] },
    );
    expect(out.actor_ids).toBeUndefined();
    expect(out.country).toEqual(['US']);
    expect(out.year_from).toBe(1960);
  });
});
