import { describe, expect, it } from 'vitest';
import {
  deriveParseChips,
  suppressKeyFor,
  suppressKeyField,
  type HandFacetState,
} from './parse-chips';

const noHandFacets: HandFacetState = {
  actor_ids: [],
  country: '',
  video_type: '',
  year_from: '',
  year_to: '',
};

describe('deriveParseChips', () => {
  it('marks a matched, hybrid-scored facet as boosting', () => {
    const chips = deriveParseChips({
      extracted: { country: ['KR'] },
      applied: { country: ['KR'] },
      rejected: [],
      facetMode: 'boost',
      handFacets: noHandFacets,
      suppressed: [],
    });
    expect(chips).toEqual([
      {
        key: 'country-KR',
        field: 'country',
        label: 'KR',
        promoteValue: 'KR',
        status: 'boosting',
        actions: ['promote', 'dismiss'],
      },
    ]);
  });

  it('marks a facet with zero fusion-candidate matches as no_effect, not hidden', () => {
    const chips = deriveParseChips({
      extracted: { country: ['KR'] },
      applied: {},
      rejected: [{ field: 'country', value: 'KR', reason: 'no_effect' }],
      facetMode: 'boost',
      handFacets: noHandFacets,
      suppressed: [],
    });
    expect(chips[0]!.status).toBe('no_effect');
    // Use as filter must stay available — a hard filter re-enumerates the
    // catalog and can succeed where a boost (candidate-pool only) cannot.
    expect(chips[0]!.actions).toContain('promote');
  });

  it('marks a facet rejected for missing snapshot data', () => {
    const chips = deriveParseChips({
      extracted: { country: ['KR'] },
      applied: {},
      rejected: [{ field: 'country', value: 'KR', reason: 'snapshot_unavailable' }],
      facetMode: 'boost',
      handFacets: noHandFacets,
      suppressed: [],
    });
    expect(chips[0]!.status).toBe('snapshot_unavailable');
  });

  it('marks a facet as hybrid_off when parse ran without the text channel', () => {
    const chips = deriveParseChips({
      extracted: { country: ['KR'] },
      applied: {},
      rejected: [{ field: 'country', value: 'KR', reason: 'hybrid_text_required' }],
      facetMode: 'boost',
      handFacets: noHandFacets,
      suppressed: [],
    });
    expect(chips[0]!.status).toBe('hybrid_off');
    // Hard-filtering does not require the hybrid text channel.
    expect(chips[0]!.actions).toEqual(['promote']);
  });

  it('marks every value on a field as hard_filter once any value on that field is hand-selected (field-level, mirrors boostsMinusHardFilters)', () => {
    const chips = deriveParseChips({
      extracted: { actor_ids: ['person:a', 'person:b'] },
      applied: {},
      rejected: [
        { field: 'actor_ids', value: 'person:a', reason: 'no_effect' },
        { field: 'actor_ids', value: 'person:b', reason: 'no_effect' },
      ],
      facetMode: 'boost',
      handFacets: { ...noHandFacets, actor_ids: ['person:c'] },
      suppressed: [],
    });
    expect(chips.map((c) => c.status)).toEqual(['hard_filter', 'hard_filter']);
    expect(chips[0]!.actions).toEqual([]);
  });

  it('marks every extracted value as filter_mode under QUERY_PARSER_FACET_MODE=filter', () => {
    const chips = deriveParseChips({
      extracted: { country: ['KR'], video_type: ['movie'] },
      applied: {},
      rejected: [],
      facetMode: 'filter',
      handFacets: noHandFacets,
      suppressed: [],
    });
    expect(chips.every((c) => c.status === 'filter_mode')).toBe(true);
    expect(chips.every((c) => c.actions.length === 0)).toBe(true);
  });

  it('marks a client-dismissed value as suppressed with only a restore action', () => {
    const chips = deriveParseChips({
      extracted: { country: ['KR'] },
      applied: { country: ['KR'] },
      rejected: [],
      facetMode: 'boost',
      handFacets: noHandFacets,
      suppressed: ['country:KR'],
    });
    expect(chips[0]!.status).toBe('suppressed');
    expect(chips[0]!.actions).toEqual(['restore']);
  });

  it('suppressed takes precedence over hard_filter (top of the precedence order)', () => {
    const chips = deriveParseChips({
      extracted: { country: ['KR'] },
      applied: {},
      rejected: [],
      facetMode: 'boost',
      handFacets: { ...noHandFacets, country: 'KR' },
      suppressed: ['country:KR'],
    });
    expect(chips[0]!.status).toBe('suppressed');
  });

  it('does not suppress a different value on the same field (value-scoped suppression)', () => {
    const chips = deriveParseChips({
      extracted: { country: ['JP'] },
      applied: { country: ['JP'] },
      rejected: [],
      facetMode: 'boost',
      handFacets: noHandFacets,
      suppressed: ['country:KR'],
    });
    expect(chips[0]!.status).toBe('boosting');
  });

  it('labels a single extracted year without a dash', () => {
    const chips = deriveParseChips({
      extracted: { year_from: 1999, year_to: 1999 },
      applied: { year_from: 1999, year_to: 1999 },
      rejected: [],
      facetMode: 'boost',
      handFacets: noHandFacets,
      suppressed: [],
    });
    expect(chips[0]!.label).toBe('1999');
    expect(chips[0]!.field).toBe('year');
    expect(chips[0]!.status).toBe('boosting');
  });

  it('labels an extracted year range with an en dash', () => {
    const chips = deriveParseChips({
      extracted: { year_from: 1990, year_to: 1999 },
      applied: {},
      rejected: [],
      facetMode: 'boost',
      handFacets: noHandFacets,
      suppressed: [],
    });
    expect(chips[0]!.label).toBe('1990\u20131999');
  });

  it('reads year hybrid_off from separate year_from/year_to rejected entries', () => {
    const chips = deriveParseChips({
      extracted: { year_from: 1990, year_to: 1999 },
      applied: {},
      rejected: [
        { field: 'year_from', value: '1990', reason: 'hybrid_text_required' },
        { field: 'year_to', value: '1999', reason: 'hybrid_text_required' },
      ],
      facetMode: 'boost',
      handFacets: noHandFacets,
      suppressed: [],
    });
    expect(chips[0]!.status).toBe('hybrid_off');
  });

  it('reads year no_effect from a combined `year` rejected entry', () => {
    const chips = deriveParseChips({
      extracted: { year_from: 1990, year_to: 1999 },
      applied: {},
      rejected: [{ field: 'year', value: '1990-1999', reason: 'no_effect' }],
      facetMode: 'boost',
      handFacets: noHandFacets,
      suppressed: [],
    });
    expect(chips[0]!.status).toBe('no_effect');
  });

  it('produces no chip for a value that failed validation and never reached extracted', () => {
    // e.g. an out-of-range year or a country not in the catalog: these are
    // dropped before `extracted` is populated (lib/metadata/query-parse.ts),
    // so the caller passes an `extracted` that never contains them; the
    // rejected entry stays visible only in Parse details.
    const chips = deriveParseChips({
      extracted: {},
      applied: {},
      rejected: [{ field: 'country', value: 'Hollywood', reason: 'not in catalog' }],
      facetMode: 'boost',
      handFacets: noHandFacets,
      suppressed: [],
    });
    expect(chips).toEqual([]);
  });

  it('returns no chips when nothing was extracted', () => {
    expect(
      deriveParseChips({
        extracted: null,
        applied: null,
        rejected: [],
        facetMode: 'boost',
        handFacets: noHandFacets,
        suppressed: [],
      }),
    ).toEqual([]);
  });
});

describe('suppressKeyFor / suppressKeyField', () => {
  it('builds a field:value key for value-scoped fields', () => {
    expect(suppressKeyFor('country', 'KR')).toBe('country:KR');
    expect(suppressKeyFor('actor_ids', 'person:a')).toBe('actor_ids:person:a');
  });

  it('builds a bare field key for year (always field-level)', () => {
    expect(suppressKeyFor('year', '1990-1999')).toBe('year');
    expect(suppressKeyFor('year')).toBe('year');
  });

  it('extracts the field portion, tolerating colons inside the value', () => {
    expect(suppressKeyField('country:KR')).toBe('country');
    expect(suppressKeyField('actor_ids:person:a')).toBe('actor_ids');
    expect(suppressKeyField('year')).toBe('year');
  });
});
