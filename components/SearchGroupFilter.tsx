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
  composeGroupAvailability,
  deriveGroupVariantNotice,
  groupAvailabilityQuery,
  selectedSearchGroupIds,
  variantSelectableIds,
  variantSwitchTargets,
} from '@/lib/metadata/group-availability-ui';
import {
  isStaleExactLookup,
  lookupMissName,
  planExactLookup,
} from '@/lib/metadata/exact-lookup';
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
  /**
   * Called with server-confirmed ready variant ids the page does not know yet
   * (todo/40 R1). The page must add them to its variant selector so an
   * explicit switch targets an option the selector can actually render.
   */
  onReadyVariantsChange?: (ids: string[]) => void;
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
  onReadyVariantsChange,
}: Props) {
  const { t, locale } = useLocale();
  const [data, setData] = useState<GroupAvailability | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [limitHit, setLimitHit] = useState(false);
  const [lookup, setLookup] = useState<GroupAvailabilityEntry[]>([]);
  const [lookupMiss, setLookupMiss] = useState<string | null>(null);
  // Sequence for exact-name lookups. Every input change advances it (including
  // clear), which invalidates any in-flight response (todo/40 R5).
  const lookupSeq = useRef(0);
  const lookupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Latest typed value, so a locale change mid-lookup can re-run the same name
  // instead of leaving a stale-language option (todo/40 R5).
  const lastLookupInput = useRef('');

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

  const clearLookupTimer = useCallback(() => {
    if (lookupTimer.current !== null) {
      clearTimeout(lookupTimer.current);
      lookupTimer.current = null;
    }
  }, []);

  /**
   * Exact-name lookup (G5). Every input change advances `lookupSeq` — including
   * a clear — so a late response can never repopulate the options, and names
   * shorter than the minimum clear instead of querying (todo/40 R5).
   */
  const runLookup = useCallback(
    (name: string, seq: number, delayMs: number) => {
      lookupTimer.current = setTimeout(() => {
        lookupTimer.current = null;
        void (async () => {
          try {
            const query = groupAvailabilityQuery({ locale, selectedIds: [], q: name });
            const res = await fetch(`/api/metadata/group-availability?${query}`);
            if (!res.ok) return;
            const body = (await res.json()) as GroupAvailability;
            // Superseded by a newer input change, a clear, or a locale change.
            if (isStaleExactLookup(seq, lookupSeq.current)) return;
            const exact = (body.groups ?? []).filter((entry) => entry.id === name);
            setLookup(exact);
            setLookupMiss(lookupMissName(name, exact));
          } catch {
            /* lookup is best-effort; the main list is unaffected */
          }
        })();
      }, delayMs);
    },
    [locale],
  );

  const lookupGroup = useCallback(
    (raw: string) => {
      lastLookupInput.current = raw;
      const seq = ++lookupSeq.current;
      clearLookupTimer();
      const plan = planExactLookup({ raw, seq });
      if (plan.action === 'none') return;
      if (plan.action === 'clear') {
        setLookup([]);
        setLookupMiss(null);
        return;
      }
      runLookup(plan.name, plan.seq, plan.delayMs);
    },
    [clearLookupTimer, runLookup],
  );

  // Invalidate any in-flight lookup on unmount.
  useEffect(() => clearLookupTimer, [clearLookupTimer]);

  // R1: publish server-confirmed ready variants the page does not know yet so
  // its selector can render an explicit switch target. Deferred to a microtask
  // so the parent's setState never runs during this child's render.
  const readyVariantIds = useMemo(
    () => data?.ready_variant_ids ?? [],
    [data],
  );
  useEffect(() => {
    if (!onReadyVariantsChange || readyVariantIds.length === 0) return;
    const known = new Set(knownVariantIds ?? []);
    const missing = readyVariantIds.filter((id) => !known.has(id));
    if (missing.length === 0) return;
    queueMicrotask(() => onReadyVariantsChange(missing));
  }, [onReadyVariantsChange, readyVariantIds, knownVariantIds]);

  // A locale change re-runs the same name against the new language instead of
  // showing a stale-language option; an empty input just clears (todo/40 R5).
  const localeKey = useRef(locale);
  useEffect(() => {
    if (localeKey.current === locale) return;
    localeKey.current = locale;
    const raw = lastLookupInput.current;
    const seq = ++lookupSeq.current;
    clearLookupTimer();
    const plan = planExactLookup({ raw, seq });
    if (plan.action === 'clear') {
      setLookup([]);
      setLookupMiss(null);
      return;
    }
    if (plan.action === 'debounce') runLookup(plan.name, plan.seq, plan.delayMs);
  }, [locale, clearLookupTimer, runLookup]);

  const composed = useMemo(
    () =>
      composeGroupAvailability({
        data,
        lookup,
        selectedIds,
        loading,
        failed,
      }),
    [data, lookup, selectedIds, loading, failed],
  );
  const { entries, options: catalogEntries, resolution } = composed;

  const options = useMemo<EuiComboBoxOptionOption[]>(
    () => [
      { label: t.groupFilterAll, value: '' },
      ...catalogEntries.map((group) => ({ label: group.label, value: group.id })),
    ],
    [catalogEntries, t.groupFilterAll],
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

  const derivedNotice = useMemo(
    () => deriveGroupVariantNotice({ selectedIds, variantId, entries }),
    [selectedIds, variantId, entries],
  );

  // R2: a selected group absent from a complete response is a confirmed empty
  // group. While loading, when the request failed, or when the response is
  // truncated, the same absence is *unresolved* and must not read as
  // "no ready video".
  const variantNotice = useMemo(() => {
    if (
      derivedNotice.kind === 'incompatible' &&
      resolution !== 'resolved' &&
      resolution !== 'missing'
    ) {
      return { kind: 'unknown', groupIds: selectedIds } as const;
    }
    return derivedNotice;
  }, [derivedNotice, resolution, selectedIds]);

  // R1: the availability endpoint is the server-backed ready-variant source.
  // It is merged into the page's known list so a group whose only ready asset
  // is older than `/api/library`'s newest 200 still gets an explicit switch.
  const availabilityVariantIds = data?.ready_variant_ids;
  const selectableVariantIds = useMemo(
    () => variantSelectableIds(knownVariantIds, availabilityVariantIds),
    [knownVariantIds, availabilityVariantIds],
  );

  // Ready variants of the *selected* groups — the actual switch source, so a
  // variant observed on an unrelated group is never offered.
  const switchReadyVariants = useMemo(
    () =>
      selectedIds.flatMap(
        (id) => data?.groups?.find((g) => g.id === id)?.ready_variant_ids ?? [],
      ),
    [selectedIds, data],
  );

  const switchTargets = useMemo(
    () =>
      variantSwitchTargets({
        notice: variantNotice,
        currentVariantId: variantId,
        readyVariantIds: switchReadyVariants,
        knownVariantIds: selectableVariantIds,
      }),
    [variantNotice, variantId, switchReadyVariants, selectableVariantIds],
  );

  // R1: the server confirmed a compatible variant for the selection, but the
  // page cannot select it (`knownVariantIds` is authoritative). Surface the
  // limitation instead of silently offering nothing.
  const firstReadyVariant = switchReadyVariants[0];
  const variantOptionUnavailable =
    variantNotice.kind === 'incompatible' &&
    firstReadyVariant !== undefined &&
    switchTargets.length === 0 &&
    !(selectableVariantIds ?? []).includes(firstReadyVariant);

  const status: 'loading' | 'ok' | 'partial' | 'unavailable' = loading
    ? 'loading'
    : failed
      ? 'unavailable'
      : (data?.status ?? 'ok');

  // A selected id the complete response omitted can only be a stale value;
  // when the response is partial/unavailable we cannot say that.
  const staleSelection = resolution === 'missing';

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
                const selectable = switchTargets;
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
            {variantOptionUnavailable && (
              <>
                <EuiSpacer size="xs" />
                <EuiText size="xs" color="subdued">
                <p>
                  {t.groupFilterVariantOptionUnavailable.replace(
                    '{variants}',
                    switchReadyVariants.join(', '),
                  )}
                </p>
              </EuiText>
              </>
            )}
          </>
        )}
      </>
    </EuiFormRow>
  );
}
