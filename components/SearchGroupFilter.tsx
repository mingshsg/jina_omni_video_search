'use client';

import {
  EuiButtonEmpty,
  EuiCallOut,
  EuiComboBox,
  type EuiComboBoxOptionOption,
  EuiFlexGroup,
  EuiFlexItem,
  EuiFormRow,
  EuiLoadingSpinner,
  EuiSpacer,
  EuiText,
} from '@elastic/eui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocale } from '@/lib/i18n/locale-context';
import {
  GROUP_SELECTION_LIMIT,
  capGroupSelection,
  deriveGroupVariantNotice,
  groupAvailabilityQuery,
  mergeSelectedGroupEntries,
  selectableCompatibleVariants,
  selectedSearchGroupIds,
} from '@/lib/metadata/group-availability-ui';
import type {
  GroupAvailability,
  GroupAvailabilityEntry,
} from '@/lib/metadata/group-availability-types';

type Props = {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  /** Current search variant ('' = none) — drives the compatibility notice. */
  variantId?: string;
  /**
   * Explicit, user-initiated variant switch. The control never changes the
   * variant silently: it only offers a button that calls this with a
   * compatible variant id (todo/39 G1).
   */
  onSelectVariant?: (variantId: string) => void;
  /** Variant ids the page can actually select (lib variant select options). */
  knownVariantIds?: string[];
};

/**
 * Primary search Group control (todo/39).
 * - G1: shows a variant/group compatibility notice before an empty result.
 * - G2: caps the selection at the request schema bound (`facetArrayMax`).
 * - G3: distinguishes loading / partial / unavailable catalogs and retries.
 * - G5: exact-name lookup so a group outside the top-N stays selectable.
 */
export function SearchGroupFilter({
  selectedIds,
  onChange,
  variantId = '',
  onSelectVariant,
  knownVariantIds,
}: Props) {
  const { t, locale } = useLocale();
  const [data, setData] = useState<GroupAvailability | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [limitHit, setLimitHit] = useState(false);
  const [lookup, setLookup] = useState<GroupAvailabilityEntry[]>([]);
  const [lookupMiss, setLookupMiss] = useState<string | null>(null);
  const lookupSeq = useRef(0);

  const selectedKey = selectedIds.join('\u0000');

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const query = groupAvailabilityQuery({
        locale,
        selectedIds: selectedKey ? selectedKey.split('\u0000') : [],
      });
      const res = await fetch(`/api/metadata/group-availability?${query}`);
      if (!res.ok) throw new Error('group availability failed');
      const body = (await res.json()) as GroupAvailability;
      setData(body);
    } catch {
      setFailed(true);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [locale, selectedKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const lookupGroup = useCallback(
    async (raw: string) => {
      const name = raw.normalize('NFKC').trim();
      // Only exact names can be resolved server-side; short prefixes stay
      // local (EUI filters the already-loaded options) to avoid a request per
      // keystroke (G5).
      if (name.length < 2) {
        setLookup([]);
        setLookupMiss(null);
        return;
      }
      const seq = ++lookupSeq.current;
      try {
        const query = groupAvailabilityQuery({ locale, selectedIds: [], q: name });
        const res = await fetch(`/api/metadata/group-availability?${query}`);
        if (!res.ok) return;
        const body = (await res.json()) as GroupAvailability;
        if (seq !== lookupSeq.current) return;
        const exact = (body.groups ?? []).filter((entry) => entry.id === name);
        setLookup(exact);
        setLookupMiss(exact.length === 0 && name.length >= 3 ? name : null);
      } catch {
        /* lookup is best-effort; the main list is unaffected */
      }
    },
    [locale],
  );

  const entries = useMemo(() => {
    const merged = mergeSelectedGroupEntries(
      [...(data?.groups ?? []), ...lookup],
      selectedIds,
    );
    return [...new Map(merged.map((e) => [e.id, e])).values()];
  }, [data, lookup, selectedIds]);

  const options = useMemo<EuiComboBoxOptionOption[]>(
    () => [
      { label: t.groupFilterAll, value: '' },
      ...entries.map((group) => ({ label: group.label, value: group.id })),
    ],
    [entries, t.groupFilterAll],
  );

  const selectedOptions = useMemo(
    () =>
      selectedIds.map((id) => ({
        label: entries.find((group) => group.id === id)?.label ?? id,
        value: id,
      })),
    [entries, selectedIds],
  );

  const onSelectionChange = useCallback(
    (next: EuiComboBoxOptionOption[]) => {
      const capped = capGroupSelection(selectedSearchGroupIds(next));
      setLimitHit(capped.overflowed);
      onChange(capped.ids);
    },
    [onChange],
  );

  const variantNotice = useMemo(
    () =>
      deriveGroupVariantNotice({ selectedIds, variantId, entries }),
    [selectedIds, variantId, entries],
  );

  const status: 'loading' | 'ok' | 'partial' | 'unavailable' = loading
    ? 'loading'
    : failed
      ? 'unavailable'
      : (data?.status ?? 'ok');

  const catalogLoaded = !loading && !failed;
  // A selected id that the complete catalog does not list can only be a stale
  // value; when the catalog itself is partial/unavailable we cannot say that.
  const staleSelection =
    catalogLoaded &&
    status === 'ok' &&
    selectedIds.some((id) => !(data?.groups ?? []).some((e) => e.id === id));

  const limitHelp = (
    <EuiText size="xs" color={limitHit ? 'danger' : 'subdued'}>
      <p>{t.groupFilterLimitHint.replace('{count}', String(GROUP_SELECTION_LIMIT))}</p>
    </EuiText>
  );

  return (
    <EuiFormRow
      label={t.groupFilterLabel}
      fullWidth
      helpText={limitHit ? limitHelp : undefined}
    >
      <>
        <EuiComboBox
          fullWidth
          placeholder={t.groupFilterAll}
          options={options}
          selectedOptions={selectedOptions}
          onChange={onSelectionChange}
          onSearchChange={(value) => void lookupGroup(value)}
          isClearable
          isLoading={loading}
          aria-label={t.groupFilterLabel}
        />

        {status === 'loading' && (
          <>
            <EuiSpacer size="xs" />
            <EuiFlexGroup gutterSize="xs" alignItems="center" responsive={false}>
              <EuiFlexItem grow={false}>
                <EuiLoadingSpinner size="s" />
              </EuiFlexItem>
              <EuiFlexItem>
                <EuiText size="xs" color="subdued">
                  {t.groupFilterLoading}
                </EuiText>
              </EuiFlexItem>
            </EuiFlexGroup>
          </>
        )}

        {status === 'partial' && (
          <>
            <EuiSpacer size="xs" />
            <EuiText size="xs" color="warning">
              {t.groupFilterPartial}
            </EuiText>
          </>
        )}

        {status === 'unavailable' && (
          <>
            <EuiSpacer size="xs" />
            <EuiCallOut size="s" color="warning" title={t.groupFilterUnavailable}>
              <EuiButtonEmpty size="xs" onClick={() => void load()}>
                {t.groupFilterRetry}
              </EuiButtonEmpty>
            </EuiCallOut>
          </>
        )}

        {staleSelection && (
          <>
            <EuiSpacer size="xs" />
            <EuiText size="xs" color="subdued">
              {t.groupFilterStaleOption}
            </EuiText>
          </>
        )}

        {lookupMiss && (
          <>
            <EuiSpacer size="xs" />
            <EuiText size="xs" color="subdued">
              {t.groupFilterSearchNoMatch.replace('{name}', lookupMiss)}
            </EuiText>
          </>
        )}

        {variantNotice.kind === 'unknown' && (
          <>
            <EuiSpacer size="xs" />
            <EuiText size="xs" color="warning">
              {t.groupFilterVariantUnknown}
            </EuiText>
          </>
        )}

        {variantNotice.kind === 'incompatible' && (
          <>
            <EuiSpacer size="xs" />
            <EuiText size="xs" color="warning">
              {variantNotice.suggestedVariantIds.length > 0
                ? t.groupFilterVariantSuggest.replace(
                    '{variants}',
                    variantNotice.suggestedVariantIds.join(', '),
                  )
                : t.groupFilterVariantNone}
            </EuiText>
            {onSelectVariant &&
              (() => {
                const selectable = selectableCompatibleVariants(
                  variantNotice.suggestedVariantIds,
                  knownVariantIds,
                );
                if (selectable.length === 0) return null;
                return (
                  <>
                    <EuiSpacer size="xs" />
                    <EuiFlexGroup gutterSize="xs" wrap responsive={false}>
                      {selectable.map((id) => (
                        <EuiFlexItem grow={false} key={id}>
                          <EuiButtonEmpty
                            size="xs"
                            onClick={() => onSelectVariant(id)}
                            aria-label={`${t.groupFilterVariantSwitch} ${id}`}
                          >
                            {`${t.groupFilterVariantSwitch} ${id}`}
                          </EuiButtonEmpty>
                        </EuiFlexItem>
                      ))}
                    </EuiFlexGroup>
                  </>
                );
              })()}
          </>
        )}
      </>
    </EuiFormRow>
  );
}
