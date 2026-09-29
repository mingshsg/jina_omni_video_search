import { describe, expect, it } from 'vitest';
import {
  GROUP_SELECTION_LIMIT,
  capGroupSelection,
  deriveGroupVariantNotice,
  groupAvailabilityQuery,
  mergeSelectedGroupEntries,
  selectableCompatibleVariants,
  selectedSearchGroupIds,
} from './group-availability-ui';
import type { GroupAvailabilityEntry } from './group-availability-types';

function entry(
  id: string,
  readyVariantIds: string[],
  overrides: Partial<GroupAvailabilityEntry> = {},
): GroupAvailabilityEntry {
  return {
    id,
    label: id,
    suggested: false,
    indexed_assets: 1,
    ready_variant_ids: readyVariantIds,
    ...overrides,
  };
}

describe('primary search group selection', () => {
  it('treats an empty selection and All as an unfiltered search', () => {
    expect(selectedSearchGroupIds([])).toEqual([]);
    expect(
      selectedSearchGroupIds([
        { label: 'demo', value: 'demo' },
        { label: 'All groups', value: '' },
      ]),
    ).toEqual([]);
  });

  it('keeps multiple selected groups without duplicates', () => {
    expect(
      selectedSearchGroupIds([
        { label: 'demo', value: 'demo' },
        { label: 'trailer', value: 'trailer' },
        { label: 'demo', value: 'demo' },
      ]),
    ).toEqual(['demo', 'trailer']);
  });
});

describe('capGroupSelection (G2)', () => {
  it('accepts exactly 20 ids', () => {
    const ids = Array.from({ length: 20 }, (_, i) => `g${i}`);
    const capped = capGroupSelection(ids);
    expect(capped.ids).toEqual(ids);
    expect(capped.overflowed).toBe(false);
  });

  it('blocks the 21st id and reports overflow without dropping earlier ones', () => {
    const ids = Array.from({ length: 21 }, (_, i) => `g${i}`);
    const capped = capGroupSelection(ids);
    expect(capped.ids).toEqual(ids.slice(0, GROUP_SELECTION_LIMIT));
    expect(capped.overflowed).toBe(true);
  });

  it('dedupes before applying the cap', () => {
    const ids = [...Array.from({ length: 20 }, (_, i) => `g${i}`), 'g0'];
    expect(capGroupSelection(ids)).toEqual({
      ids: Array.from({ length: 20 }, (_, i) => `g${i}`),
      overflowed: false,
    });
  });

  it('clearing to All returns an empty selection', () => {
    expect(capGroupSelection(selectedSearchGroupIds([]))).toEqual({
      ids: [],
      overflowed: false,
    });
  });
});

describe('deriveGroupVariantNotice (G1)', () => {
  it('is inert for the All selection or when no variant is chosen', () => {
    expect(
      deriveGroupVariantNotice({ selectedIds: [], variantId: 'v', entries: [] }),
    ).toEqual({ kind: 'none' });
    expect(
      deriveGroupVariantNotice({
        selectedIds: ['demo'],
        variantId: '',
        entries: [entry('demo', ['v'])],
      }),
    ).toEqual({ kind: 'no_variant' });
  });

  it('is none when a selected group has ready assets in the current variant', () => {
    expect(
      deriveGroupVariantNotice({
        selectedIds: ['demo', 'trailer'],
        variantId: 'v-2s',
        entries: [entry('demo', ['v-2s']), entry('trailer', ['v-fine'])],
      }),
    ).toEqual({ kind: 'none' });
  });

  it('flags an incompatible single group with the variants it does support', () => {
    expect(
      deriveGroupVariantNotice({
        selectedIds: ['trailer'],
        variantId: 'v-2s',
        entries: [entry('trailer', ['v-fine'])],
      }),
    ).toEqual({
      kind: 'incompatible',
      groupIds: ['trailer'],
      suggestedVariantIds: ['v-fine'],
    });
  });

  it('does not claim incompatibility for an unresolved (truncated) group', () => {
    expect(
      deriveGroupVariantNotice({
        selectedIds: ['beyond-top-200'],
        variantId: 'v-2s',
        entries: [],
      }),
    ).toMatchObject({ kind: 'unknown' });
  });

  it('reports no compatible variant when a group has no ready assets at all', () => {
    expect(
      deriveGroupVariantNotice({
        selectedIds: ['empty-group'],
        variantId: 'v-2s',
        entries: [entry('empty-group', [])],
      }),
    ).toEqual({
      kind: 'incompatible',
      groupIds: ['empty-group'],
      suggestedVariantIds: [],
    });
  });
});

describe('mergeSelectedGroupEntries (G3/G5)', () => {
  it('keeps a selected id selectable even when the catalog omitted it', () => {
    const merged = mergeSelectedGroupEntries([entry('demo', ['v'])], ['legacy']);
    expect(merged.map((e) => e.id)).toEqual(['demo', 'legacy']);
    expect(merged.find((e) => e.id === 'legacy')).toMatchObject({
      label: 'legacy',
      ready_variant_ids: [],
    });
  });
});

describe('selectableCompatibleVariants (G1)', () => {
  it('drops compatible ids the page cannot select', () => {
    expect(
      selectableCompatibleVariants(['v-fine', 'v-hidden'], ['v-2s', 'v-fine']),
    ).toEqual(['v-fine']);
  });

  it('returns all suggestions when no known list is supplied', () => {
    expect(selectableCompatibleVariants(['a', 'b'])).toEqual(['a', 'b']);
  });
});

describe('groupAvailabilityQuery (G1)', () => {
  it('repeats include for each selected id and escapes the exact-name lookup', () => {
    const query = groupAvailabilityQuery({
      locale: 'zh',
      selectedIds: ['a b', 'demo'],
      q: 'old group',
    });
    const params = new URLSearchParams(query);
    expect(params.get('locale')).toBe('zh');
    expect(params.getAll('include')).toEqual(['a b', 'demo']);
    expect(params.get('q')).toBe('old group');
  });
});
