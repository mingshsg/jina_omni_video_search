import { describe, expect, it } from 'vitest';
import {
  GROUP_SELECTION_LIMIT,
  capGroupSelection,
  composeGroupAvailability,
  deriveGroupVariantNotice,
  groupAvailabilityQuery,
  mergeSelectedGroupEntries,
  selectedSearchGroupIds,
  variantSelectableIds,
  variantSwitchTargets,
} from './group-availability-ui';
import type {
  GroupAvailability,
  GroupAvailabilityEntry,
} from './group-availability-types';

function availability(
  groups: GroupAvailabilityEntry[],
  overrides: Partial<GroupAvailability> = {},
): GroupAvailability {
  return {
    status: 'ok',
    groups,
    total_groups: groups.length,
    truncated: false,
    ready_variant_ids: [],
    ...overrides,
  };
}

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

describe('variantSelectableIds (R1)', () => {
  it('merges the server-backed option source so an older group variant is selectable', () => {
    // The page only saw v-new in /api/library's newest 200; the availability
    // endpoint knows the group's older asset uses v-old.
    expect(variantSelectableIds(['v-new'], ['v-old'])).toEqual([
      'v-new',
      'v-old',
    ]);
  });

  it('dedupes and preserves the page order', () => {
    expect(variantSelectableIds(['v-new', 'v-old'], ['v-old', 'v-older'])).toEqual(
      ['v-new', 'v-old', 'v-older'],
    );
  });

  it('stays undefined when the page has no known list', () => {
    expect(variantSelectableIds(undefined, ['v-old'])).toBeUndefined();
  });

  it('handles a missing option source', () => {
    expect(variantSelectableIds(['v-new'], undefined)).toEqual(['v-new']);
  });
});

describe('variantSwitchTargets (R1)', () => {
  const incompatible = {
    kind: 'incompatible' as const,
    groupIds: ['old-group'],
    suggestedVariantIds: [],
  };

  it('offers a ready variant of the selected group even when the notice has none', () => {
    // The older group's entry is present, but its label/notice lists no variant
    // because the page never derived one; the raw ready ids still drive the
    // switch, and the server-backed option source makes it selectable.
    expect(
      variantSwitchTargets({
        notice: incompatible,
        currentVariantId: 'v-2s',
        readyVariantIds: ['v-old'],
        knownVariantIds: variantSelectableIds(['v-new'], ['v-old']),
      }),
    ).toEqual(['v-old']);
  });

  it('never offers the current variant and respects the known list', () => {
    expect(
      variantSwitchTargets({
        notice: incompatible,
        currentVariantId: 'v-old',
        readyVariantIds: ['v-old', 'v-other'],
        knownVariantIds: ['v-2s', 'v-old'],
      }),
    ).toEqual([]);
  });

  it('is inert unless the notice is incompatible', () => {
    expect(
      variantSwitchTargets({
        notice: { kind: 'unknown', groupIds: ['x'] },
        currentVariantId: 'v-2s',
        readyVariantIds: ['v-old'],
      }),
    ).toEqual([]);
  });
});

describe('composeGroupAvailability (R2)', () => {
  const selected = ['old-group'];

  it('reports loading while a request is in flight and hides incompatibility', () => {
    const composed = composeGroupAvailability({
      data: null,
      lookup: [],
      selectedIds: selected,
      loading: true,
      failed: false,
    });
    expect(composed.resolution).toBe('loading');
    const notice = deriveGroupVariantNotice({
      selectedIds: selected,
      variantId: 'v-2s',
      entries: composed.entries,
    });
    // The placeholder has no ready variants, but the resolution is not
    // `resolved`, so the component must not claim incompatibility.
    expect(notice.kind).toBe('incompatible');
    expect(composed.resolution).not.toBe('resolved');
  });

  it('reports unavailable when the request failed, whatever the body', () => {
    const composed = composeGroupAvailability({
      data: null,
      lookup: [],
      selectedIds: selected,
      loading: false,
      failed: true,
    });
    expect(composed.resolution).toBe('unavailable');
    expect(composed.verifiedEmptyGroupIds).toEqual([]);
  });

  it('reports a failed-status response as unavailable (starter-only body)', () => {
    const composed = composeGroupAvailability({
      data: availability(
        [entry('trailer', []), entry('demo', [])],
        { status: 'unavailable', total_groups: 0 },
      ),
      lookup: [],
      selectedIds: selected,
      loading: false,
      failed: false,
    });
    expect(composed.resolution).toBe('unavailable');
    expect(composed.unresolvedGroupIds).toEqual(['old-group']);
  });

  it('reports truncated-with-selected as truncated, not a confirmed empty group', () => {
    const composed = composeGroupAvailability({
      data: availability([entry('common', ['v-2s'])], {
        status: 'partial',
        truncated: true,
        total_groups: 500,
      }),
      lookup: [],
      selectedIds: selected,
      loading: false,
      failed: false,
    });
    expect(composed.resolution).toBe('truncated');
    expect(composed.verifiedEmptyGroupIds).toEqual([]);
    // The selected id still has a placeholder so it can be cleared.
    expect(composed.entries.find((e) => e.id === 'old-group')).toMatchObject({
      label: 'old-group',
      ready_variant_ids: [],
    });
    // The placeholder is not offered as a new option.
    expect(composed.options.map((e) => e.id)).not.toContain('old-group');
  });

  it('reports a complete response that omits the selection as missing', () => {
    const composed = composeGroupAvailability({
      data: availability([entry('common', ['v-2s'])]),
      lookup: [],
      selectedIds: selected,
      loading: false,
      failed: false,
    });
    expect(composed.resolution).toBe('missing');
    expect(composed.unresolvedGroupIds).toEqual(['old-group']);
    expect(composed.verifiedEmptyGroupIds).toEqual(['old-group']);
  });

  it('reports a genuinely empty but resolved group as resolved (verified empty)', () => {
    const composed = composeGroupAvailability({
      data: availability([entry('old-group', [])]),
      lookup: [],
      selectedIds: selected,
      loading: false,
      failed: false,
    });
    expect(composed.resolution).toBe('resolved');
    expect(composed.unresolvedGroupIds).toEqual([]);
    expect(composed.verifiedEmptyGroupIds).toEqual([]);
    const notice = deriveGroupVariantNotice({
      selectedIds: selected,
      variantId: 'v-2s',
      entries: composed.entries,
    });
    expect(notice).toEqual({
      kind: 'incompatible',
      groupIds: ['old-group'],
      suggestedVariantIds: [],
    });
  });

  it('includes exact-lookup hits in the options but not as variant sources', () => {
    const composed = composeGroupAvailability({
      data: availability([entry('common', ['v-2s'])]),
      lookup: [entry('old-group', ['v-old'], { suggested: false })],
      selectedIds: [],
      loading: false,
      failed: false,
    });
    expect(composed.options.map((e) => e.id)).toEqual(
      expect.arrayContaining(['common', 'old-group']),
    );
    expect(composed.resolution).toBe('resolved');
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

it('deduplicates catalog and exact-lookup options by canonical group ID', () => {
  const demo = entry('demo', ['v1']);
  const composed = composeGroupAvailability({
    data: { status: 'ok', groups: [demo], total_groups: 1, truncated: false, ready_variant_ids: ['v1'] },
    lookup: [{ ...demo, label: 'Latest label' }], selectedIds: ['demo'], loading: false, failed: false,
  });
  expect(composed.options).toEqual([{ ...demo, label: 'Latest label' }]);
  expect(composed.entries).toHaveLength(1);
});
