'use client';

import {
  EuiAccordion,
  EuiBadge,
  EuiButton,
  EuiButtonEmpty,
  EuiButtonGroup,
  EuiCallOut,
  EuiDescriptionList,
  EuiEmptyPrompt,
  EuiFieldSearch,
  EuiFieldNumber,
  EuiFlexGroup,
  EuiFlexItem,
  EuiFormRow,
  EuiHorizontalRule,
  EuiIconTip,
  EuiLoadingSpinner,
  EuiPanel,
  EuiSelect,
  EuiSpacer,
  EuiSwitch,
  EuiText,
  EuiTitle,
} from '@elastic/eui';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { AppShell } from '@/components/AppShell';
import {
  EMPTY_FACETS,
  facetsToApiFilters,
  SearchFacets,
  type SearchFacetState,
} from '@/components/SearchFacets';
import {
  SearchQueryExplainFlyout,
  type SearchExplainPayload,
} from '@/components/SearchQueryExplainFlyout';
import {
  groupSearchHitsTopK,
  oversampleForGroupedTopK,
} from '@/lib/es/group-hits';
import { formatChunkPresetLabel } from '@/lib/ingest/chunk-presets';
import { useLocale } from '@/lib/i18n/locale-context';
import {
  deriveParseChips,
  suppressKeyFor,
  suppressKeyField,
  type ExtractedFacets,
  type ParseChip,
  type RejectedEntry,
} from '@/lib/metadata/parse-chips';

type Modality = 'visual' | 'audio' | 'both';
type ModalityBadge = 'visual' | 'audio' | 'both';
type SortBy = 'rrf' | 'visual' | 'audio' | 'hybrid';

type SearchHit = {
  chunk_id: string;
  video_id: string;
  variant_id: string;
  title: string;
  start_ms: number;
  end_ms: number;
  start_label: string;
  end_label: string;
  score: number;
  score_visual: number | null;
  score_audio: number | null;
  rank_visual: number | null;
  rank_audio: number | null;
  modality_badge: ModalityBadge;
  thumb_url: string;
  score_kind?: 'hybrid_rrf' | 'knn' | 'rrf';
  rank_text?: number | null;
  metadata_match?: boolean;
};

type LibraryAsset = {
  video_id: string;
  title: string;
  duration_ms: number;
  variants: Array<{
    variant_id: string;
    status: string;
    chunk_preset: string;
    chunk_window_ms?: number;
    chunk_overlap_ms?: number;
  }>;
};

function formatScore(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return value.toFixed(3);
}

function formatRrfScore(score: number, modality: Modality): string {
  if (modality !== 'both' || score === 0) return '—';
  return score.toFixed(3);
}

function formatPrimaryScore(
  hit: SearchHit,
  modality: Modality,
  hybridOn: boolean,
): string {
  if (hybridOn || hit.score_kind === 'hybrid_rrf') {
    return hit.score.toFixed(3);
  }
  return formatRrfScore(hit.score, modality);
}

function badgeLabel(
  badge: ModalityBadge,
  t: { modalityVisual: string; modalityAudio: string; modalityBoth: string },
): string {
  switch (badge) {
    case 'visual':
      return t.modalityVisual;
    case 'audio':
      return t.modalityAudio;
    case 'both':
      return t.modalityBoth;
    default: {
      const _exhaustive: never = badge;
      return _exhaustive;
    }
  }
}

function badgeColor(badge: ModalityBadge): 'primary' | 'accent' | 'success' {
  switch (badge) {
    case 'visual':
      return 'primary';
    case 'audio':
      return 'accent';
    case 'both':
      return 'success';
    default: {
      const _exhaustive: never = badge;
      return _exhaustive;
    }
  }
}

export default function SearchPage() {
  const { t } = useLocale();
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const [query, setQuery] = useState('');
  const [modality, setModality] = useState<Modality>('visual');
  const [sortBy, setSortBy] = useState<SortBy>('visual');
  const [useHybridText, setUseHybridText] = useState(false);
  const [parseQuery, setParseQuery] = useState(false);
  const [suppressExtracted, setSuppressExtracted] = useState<string[]>([]);
  const [parseMeta, setParseMeta] = useState<Record<string, unknown> | null>(
    null,
  );
  const [variantId, setVariantId] = useState('');
  const [videoId, setVideoId] = useState<string>('');
  const [size, setSize] = useState(5);
  const [facets, setFacets] = useState<SearchFacetState>(EMPTY_FACETS);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [assets, setAssets] = useState<LibraryAsset[]>([]);
  const [variantIds, setVariantIds] = useState<string[]>([]);
  const [loadingLib, setLoadingLib] = useState(true);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeHit, setActiveHit] = useState<SearchHit | null>(null);
  const [durationMs, setDurationMs] = useState(0);
  const [resultModality, setResultModality] = useState<Modality>('visual');
  const [resultHybrid, setResultHybrid] = useState(false);
  const [searchExplain, setSearchExplain] = useState<SearchExplainPayload | null>(
    null,
  );
  const [explainOpen, setExplainOpen] = useState(false);
  // Tracks the trimmed query text of the last submitted search so a fresh
  // query resets stale suppressions instead of silently carrying them over
  // (plan/05-parse-chip-state-model.md decision 3). `null` means "no search
  // submitted yet" and must not itself count as a change.
  const lastSubmittedQueryRef = useRef<string | null>(null);
  // Monotonic request sequence so an out-of-order response from an older
  // request (e.g. two quick chip clicks) never overwrites a newer one.
  const requestSeqRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingLib(true);
      try {
        const res = await fetch('/api/library');
        const data = (await res.json()) as {
          assets?: LibraryAsset[];
          variant_ids?: string[];
          error?: { message: string };
        };
        if (!res.ok) throw new Error(data.error?.message ?? t.libraryError);
        if (cancelled) return;
        setAssets(data.assets ?? []);
        const ids = data.variant_ids ?? [];
        setVariantIds(ids);
        if (ids.length > 0) {
          setVariantId((prev) => prev || ids[0]);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : t.libraryError);
        }
      } finally {
        if (!cancelled) setLoadingLib(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [t.libraryError]);

  const videoOptions = useMemo(
    () => [
      { value: '', text: t.videoFilterAll },
      ...assets.map((a) => ({ value: a.video_id, text: a.title || a.video_id })),
    ],
    [assets, t.videoFilterAll],
  );

  const facetsActiveCount = useMemo(() => {
    let n = 0;
    if (facets.year_from.trim()) n += 1;
    if (facets.year_to.trim()) n += 1;
    if (facets.country) n += 1;
    if (facets.video_type) n += 1;
    if (facets.primary_language) n += 1;
    if (facets.actor_ids.length) n += 1;
    if (facets.tags.trim()) n += 1;
    return n;
  }, [facets]);

  const variantOptions = useMemo(
    () =>
      variantIds.map((id) => {
        const meta = assets
          .flatMap((a) => a.variants)
          .find((v) => v.variant_id === id);
        const label = meta
          ? formatChunkPresetLabel(
              meta.chunk_preset,
              meta.chunk_window_ms,
              meta.chunk_overlap_ms,
            )
          : '';
        return {
          value: id,
          text: label ? `${id.slice(0, 8)}… (${label})` : id,
        };
      }),
    [variantIds, assets],
  );

  const chunkWindowMs = useMemo(() => {
    const meta = assets
      .flatMap((a) => a.variants)
      .find((v) => v.variant_id === variantId);
    const w = meta?.chunk_window_ms;
    return typeof w === 'number' && w > 0 ? w : 64_000;
  }, [assets, variantId]);

  const hitGroups = useMemo(
    () => groupSearchHitsTopK(hits, chunkWindowMs, size),
    [hits, chunkWindowMs, size],
  );

    const timelineHits = useMemo(() => {
    if (!activeHit) return [];
    return hits
      .filter(
        (h) =>
          h.video_id === activeHit.video_id &&
          h.variant_id === activeHit.variant_id,
      )
      .slice()
      .sort((a, b) => a.start_ms - b.start_ms);
  }, [hits, activeHit]);

  const seekToHit = useCallback((hit: SearchHit) => {
    setActiveHit(hit);
    const el = videoRef.current;
    if (!el) return;
    const onReady = () => {
      el.currentTime = hit.start_ms / 1000;
      void el.play().catch(() => undefined);
    };
    if (el.src.includes(hit.video_id) && el.readyState >= 1) {
      onReady();
    } else {
      el.src = `/api/media/${encodeURIComponent(hit.video_id)}`;
      el.onloadedmetadata = () => {
        setDurationMs((el.duration || 0) * 1000);
        onReady();
      };
    }
  }, []);

  const runSearch = useCallback(async (opts?: {
    sortOverride?: SortBy;
    facetsOverride?: SearchFacetState;
    suppressOverride?: string[];
  }) => {
    setError(null);
    if (!variantId) {
      setError(t.selectVariantFirst);
      return;
    }
    const q = query.trim();
    if (!q) return;
    const queryChanged =
      lastSubmittedQueryRef.current !== null &&
      lastSubmittedQueryRef.current !== q;
    lastSubmittedQueryRef.current = q;
    if (queryChanged) {
      // A new query text invalidates dismissed-boost state from the
      // previous query (e.g. dismissing `country` on "Korean kissing" must
      // not also suppress `country` on a later "Japanese kissing" search).
      setSuppressExtracted([]);
    }
    const nextSort = useHybridText || parseQuery
      ? 'hybrid'
      : (opts?.sortOverride ?? sortBy);
    const activeFacets = opts?.facetsOverride ?? facets;
    const activeSuppress = queryChanged
      ? []
      : (opts?.suppressOverride ?? suppressExtracted);

    const seq = ++requestSeqRef.current;
    setSearching(true);
    try {
      const parsedFacets = facetsToApiFilters(activeFacets, {
        yearInvalid: t.facetYearInvalid,
        yearReversed: t.facetYearReversed,
      });
      if (!parsedFacets.ok) {
        setError(parsedFacets.error);
        setSearching(false);
        return;
      }
      const filters = parsedFacets.filters;
      const hybridPayload =
        useHybridText || parseQuery
          ? {
              use_text: true,
              ...(parseQuery
                ? {
                    parse_query: true,
                    ...(activeSuppress.length
                      ? {
                          // Client suppress keys may be `field:value`; the
                          // server currently only recognises field names
                          // (plan/05-parse-chip-state-model.md PR-C adds
                          // value-level support). Map down and dedup here
                          // so PR-B can ship before PR-C.
                          suppress_extracted: [
                            ...new Set(activeSuppress.map(suppressKeyField)),
                          ],
                        }
                      : {}),
                  }
                : {}),
            }
          : undefined;
      const requestBody: Record<string, unknown> = {
        query: q,
        modality,
        variant_id: variantId,
        video_id: videoId || null,
        size: oversampleForGroupedTopK(size),
        sort_by: nextSort,
        ...(filters ? { filters } : {}),
        ...(hybridPayload ? { hybrid: hybridPayload } : {}),
      };
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
      const data = (await res.json()) as {
        hits?: SearchHit[];
        meta?: Record<string, unknown> & {
          modality?: Modality;
          sort_by?: SortBy;
          hybrid?: { use_text?: boolean } | null;
          parse?: Record<string, unknown> | null;
        };
        error?: { message: string };
      };
      if (seq !== requestSeqRef.current) return; // superseded by a newer search
      if (!res.ok) throw new Error(data.error?.message ?? t.searchError);
      setHits(data.hits ?? []);
      setResultModality(data.meta?.modality ?? modality);
      setResultHybrid(
        Boolean(data.meta?.hybrid?.use_text) || data.meta?.sort_by === 'hybrid',
      );
      setParseMeta(data.meta?.parse ?? null);
      setSearchExplain({
        request: requestBody,
        meta: data.meta ?? {},
      });
      setActiveHit(null);
    } catch (err) {
      if (seq !== requestSeqRef.current) return; // superseded by a newer search
      setError(err instanceof Error ? err.message : t.searchError);
      setHits([]);
      setResultHybrid(false);
      setParseMeta(null);
      setSearchExplain(null);
    } finally {
      if (seq === requestSeqRef.current) setSearching(false);
    }
  }, [
    query,
    modality,
    variantId,
    videoId,
    size,
    sortBy,
    facets,
    useHybridText,
    parseQuery,
    suppressExtracted,
    t,
  ]);

  const modalityOptions = [
    { id: 'visual', label: t.modalityVisual },
    { id: 'audio', label: t.modalityAudio },
    { id: 'both', label: t.modalityBoth },
  ];

  const sortOptions = useHybridText
    ? [{ value: 'hybrid', text: t.sortByHybrid }]
    : [
        {
          value: 'rrf',
          text: t.sortByRrf,
          disabled: modality !== 'both',
        },
        { value: 'visual', text: t.sortByVisual },
        { value: 'audio', text: t.sortByAudio },
      ];

  const onModalityChange = (id: string) => {
    const next = id as Modality;
    setModality(next);
    if (useHybridText) {
      setSortBy('hybrid');
      return;
    }
    if (next !== 'both' && sortBy === 'rrf') {
      // RRF needs both modalities; fall back to the active single modality.
      setSortBy(next);
    }
  };

  const onHybridTextChange = (checked: boolean) => {
    setUseHybridText(checked);
    if (checked) {
      setSortBy('hybrid');
    } else if (sortBy === 'hybrid') {
      setSortBy(modality === 'both' ? 'rrf' : modality);
    }
  };

  const parseExtracted = (parseMeta?.extracted ?? null) as ExtractedFacets | null;
  const parseApplied = (parseMeta?.applied ?? null) as ExtractedFacets | null;
  const parseRejected: RejectedEntry[] = Array.isArray(parseMeta?.rejected)
    ? (parseMeta!.rejected as RejectedEntry[])
    : [];
  const parseFacetMode =
    typeof parseMeta?.facet_mode === 'string'
      ? (parseMeta.facet_mode as string)
      : undefined;
  const filterModeActive = parseFacetMode === 'filter';

  const handFacetState = useMemo(
    () => ({
      actor_ids: facets.actor_ids.map((o) => String(o.value ?? o.label)),
      country: facets.country,
      video_type: facets.video_type,
      year_from: facets.year_from,
      year_to: facets.year_to,
    }),
    [facets],
  );

  const parseChips = useMemo(
    () =>
      deriveParseChips({
        extracted: parseExtracted,
        applied: parseApplied,
        rejected: parseRejected,
        facetMode: parseFacetMode,
        handFacets: handFacetState,
        suppressed: suppressExtracted,
      }),
    [
      parseExtracted,
      parseApplied,
      parseRejected,
      parseFacetMode,
      handFacetState,
      suppressExtracted,
    ],
  );
  const visibleParseChips = useMemo(
    () => parseChips.filter((c) => c.status !== 'suppressed'),
    [parseChips],
  );
  const suppressedParseChips = useMemo(
    () => parseChips.filter((c) => c.status === 'suppressed'),
    [parseChips],
  );

  const parseChipStatusLabel = (status: ParseChip['status']): string => {
    switch (status) {
      case 'boosting':
        return t.parseChipStatusBoosting;
      case 'no_effect':
        return t.parseChipStatusNoEffect;
      case 'hybrid_off':
        return t.parseChipStatusHybridOff;
      case 'snapshot_unavailable':
        return t.parseChipStatusSnapshotUnavailable;
      case 'hard_filter':
        return t.parseChipStatusHardFilter;
      case 'filter_mode':
        return t.parseChipStatusFilterMode;
      case 'suppressed':
        return '';
    }
  };

  const parseChipHint = (status: ParseChip['status']): string | undefined => {
    switch (status) {
      case 'no_effect':
        return t.parseChipHintNoEffect;
      case 'hybrid_off':
        return t.parseChipHintHybridOff;
      case 'snapshot_unavailable':
        return t.parseChipHintSnapshotUnavailable;
      default:
        return undefined;
    }
  };

  const parseChipColor = (status: ParseChip['status']): string => {
    switch (status) {
      case 'boosting':
        return 'primary';
      case 'hard_filter':
        return 'success';
      case 'no_effect':
      case 'hybrid_off':
      case 'snapshot_unavailable':
        return 'warning';
      default:
        return 'hollow';
    }
  };

  const promoteChip = (chip: ParseChip) => {
    const nextFacets = { ...facets };
    if (chip.field === 'actor_ids' && chip.promoteValue) {
      if (
        !facets.actor_ids.some(
          (o) => o.value === chip.promoteValue || o.label === chip.promoteValue,
        )
      ) {
        nextFacets.actor_ids = [
          ...facets.actor_ids,
          { label: chip.promoteValue, value: chip.promoteValue },
        ];
      }
    } else if (chip.field === 'country' && chip.promoteValue) {
      nextFacets.country = chip.promoteValue;
    } else if (chip.field === 'video_type' && chip.promoteValue) {
      nextFacets.video_type = chip.promoteValue;
    } else if (chip.field === 'year') {
      const from = parseExtracted?.year_from;
      const to = parseExtracted?.year_to;
      if (from != null) nextFacets.year_from = String(from);
      if (to != null) nextFacets.year_to = String(to);
    }
    // Do not also suppress the boost here: the server's
    // boostsMinusHardFilters already drops the matching boost field once
    // the hand filter is present, and clearing the facet later restores the
    // boost automatically (plan/05-parse-chip-state-model.md decision 2).
    setFacets(nextFacets);
    if (query.trim() && variantId) {
      void runSearch({ facetsOverride: nextFacets });
    }
  };

  const dismissChip = (chip: ParseChip) => {
    const key = suppressKeyFor(chip.field, chip.label);
    if (suppressExtracted.includes(key)) return;
    const nextSuppress = [...suppressExtracted, key];
    setSuppressExtracted(nextSuppress);
    if (query.trim() && variantId) {
      void runSearch({ suppressOverride: nextSuppress });
    }
  };

  const restoreSuppressedChips = () => {
    if (suppressExtracted.length === 0) return;
    setSuppressExtracted([]);
    if (query.trim() && variantId) {
      void runSearch({ suppressOverride: [] });
    }
  };

  const resetFilters = () => {
    setFacets(EMPTY_FACETS);
    setSuppressExtracted([]);
    if (query.trim() && variantId) {
      void runSearch({
        facetsOverride: EMPTY_FACETS,
        suppressOverride: [],
      });
    }
  };

  const filtersDirty =
    facetsActiveCount > 0 || suppressExtracted.length > 0;

  return (
    <AppShell pageTitle={t.appTitle} pageDescription={t.appSubtitle}>
      <EuiFlexGroup gutterSize="m" alignItems="flexEnd" wrap>
        <EuiFlexItem grow={4}>
          <EuiFormRow fullWidth label={t.searchPlaceholder}>
            <EuiFieldSearch
              fullWidth
              placeholder={t.searchPlaceholder}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onSearch={() => void runSearch()}
              isClearable
            />
          </EuiFormRow>
        </EuiFlexItem>
        <EuiFlexItem grow={false}>
          <EuiButton
            fill
            onClick={() => void runSearch()}
            isLoading={searching}
            disabled={loadingLib || !variantId}
          >
            {t.searchButton}
          </EuiButton>
        </EuiFlexItem>
        <EuiFlexItem grow={false}>
          <EuiFormRow label={t.parseQueryLabel}>
            <EuiSwitch
              label={t.parseQueryLabel}
              showLabel={false}
              checked={parseQuery}
              onChange={(e) => {
                const on = e.target.checked;
                setParseQuery(on);
                if (on) {
                  // Smart parse facet boosts require the hybrid text channel.
                  setUseHybridText(true);
                  setSortBy('hybrid');
                } else {
                  setSuppressExtracted([]);
                  setParseMeta(null);
                }
              }}
              compressed
            />
          </EuiFormRow>
        </EuiFlexItem>
      </EuiFlexGroup>

      {parseQuery && (
        <>
          <EuiSpacer size="s" />
          <EuiText size="xs" color="subdued">
            <p>{t.parseImpliesHybridHint}</p>
          </EuiText>
        </>
      )}

      <EuiSpacer size="m" />

      <EuiFlexGroup gutterSize="s" alignItems="center" justifyContent="spaceBetween">
        <EuiFlexItem grow>
          <EuiAccordion
            id="search-facets"
            buttonContent={
              facetsActiveCount > 0
                ? `${t.facetsLabel} (${facetsActiveCount})`
                : t.facetsLabel
            }
            paddingSize="m"
            initialIsOpen={facetsActiveCount > 0}
          >
            <EuiText size="xs" color="subdued">
              <p>{t.facetsActiveHint}</p>
            </EuiText>
            <EuiSpacer size="s" />
            <SearchFacets value={facets} onChange={setFacets} />
          </EuiAccordion>
        </EuiFlexItem>
        <EuiFlexItem grow={false}>
          <EuiButtonEmpty
            size="s"
            flush="right"
            disabled={!filtersDirty}
            onClick={resetFilters}
          >
            {t.facetsReset}
          </EuiButtonEmpty>
        </EuiFlexItem>
      </EuiFlexGroup>

      <EuiSpacer size="m" />

      <EuiFlexGroup gutterSize="m" wrap>
        <EuiFlexItem grow={false}>
          <EuiFormRow label={t.modalityLabel}>
            <EuiButtonGroup
              legend={t.modalityLabel}
              options={modalityOptions}
              idSelected={modality}
              onChange={onModalityChange}
              buttonSize="compressed"
              color="primary"
            />
          </EuiFormRow>
        </EuiFlexItem>
        <EuiFlexItem grow={2}>
          <EuiFormRow label={t.variantLabel}>
            {loadingLib ? (
              <EuiLoadingSpinner size="m" />
            ) : variantOptions.length === 0 ? (
              <EuiText size="s" color="subdued">
                <p>{t.noVariants}</p>
              </EuiText>
            ) : (
              <EuiSelect
                options={variantOptions}
                value={variantId}
                onChange={(e) => setVariantId(e.target.value)}
                aria-label={t.variantLabel}
              />
            )}
          </EuiFormRow>
        </EuiFlexItem>
        <EuiFlexItem grow={2}>
          <EuiFormRow label={t.videoFilterLabel}>
            <EuiSelect
              options={videoOptions}
              value={videoId}
              onChange={(e) => setVideoId(e.target.value)}
              aria-label={t.videoFilterLabel}
            />
          </EuiFormRow>
        </EuiFlexItem>
        <EuiFlexItem grow={false} style={{ width: 120 }}>
          <EuiFormRow label={t.topKLabel} helpText={t.topKHelp}>
            <EuiFieldNumber
              value={size}
              min={1}
              max={100}
              onChange={(e) => setSize(Number(e.target.value) || 5)}
            />
          </EuiFormRow>
        </EuiFlexItem>
        <EuiFlexItem grow={false} style={{ minWidth: 180 }}>
          <EuiFormRow label={t.sortByLabel}>
            <EuiSelect
              options={sortOptions}
              value={useHybridText ? 'hybrid' : sortBy}
              disabled={useHybridText}
              onChange={(e) => {
                const next = e.target.value as SortBy;
                setSortBy(next);
                if (query.trim() && variantId) void runSearch({ sortOverride: next });
              }}
              aria-label={t.sortByLabel}
            />
          </EuiFormRow>
        </EuiFlexItem>
        <EuiFlexItem grow={false}>
          <EuiFormRow
            label={
              <>
                {t.hybridTextLabel}{' '}
                <EuiIconTip
                  type="question"
                  color="subdued"
                  content={t.hybridTextHelp}
                  position="top"
                />
              </>
            }
          >
            <EuiSwitch
              label={t.hybridTextLabel}
              showLabel={false}
              checked={useHybridText}
              disabled={parseQuery}
              onChange={(e) => onHybridTextChange(e.target.checked)}
              compressed
            />
          </EuiFormRow>
        </EuiFlexItem>
      </EuiFlexGroup>

      {parseQuery && parseMeta && parseMeta.parser !== 'disabled' && (
        <>
          <EuiSpacer size="m" />
          {visibleParseChips.length > 0 && (
            <EuiFlexGroup gutterSize="s" wrap alignItems="center">
              {visibleParseChips.map((chip) => (
                <EuiFlexItem grow={false} key={chip.key}>
                  <EuiBadge color={parseChipColor(chip.status)}>
                    {chip.label}{' '}
                    <EuiText size="xs" color="subdued" component="span">
                      ({parseChipStatusLabel(chip.status)})
                    </EuiText>{' '}
                    {parseChipHint(chip.status) && (
                      <EuiIconTip
                        type="question"
                        color="subdued"
                        content={parseChipHint(chip.status)}
                        position="top"
                      />
                    )}{' '}
                    {chip.actions.includes('promote') && (
                      <EuiButtonEmpty
                        size="xs"
                        onClick={() => promoteChip(chip)}
                      >
                        {t.parseChipPromote}
                      </EuiButtonEmpty>
                    )}
                    {chip.actions.includes('dismiss') && (
                      <EuiButtonEmpty
                        size="xs"
                        iconType="cross"
                        aria-label={t.parseChipDismissAria}
                        onClick={() => dismissChip(chip)}
                      />
                    )}
                  </EuiBadge>
                </EuiFlexItem>
              ))}
            </EuiFlexGroup>
          )}
          {suppressedParseChips.length > 0 && (
            <>
              <EuiSpacer size="xs" />
              <EuiText size="xs" color="subdued">
                <p>
                  {t.parseChipIgnoredCount.replace(
                    '{count}',
                    String(suppressedParseChips.length),
                  )}{' '}
                  <EuiButtonEmpty size="xs" onClick={restoreSuppressedChips}>
                    {t.parseChipRestore}
                  </EuiButtonEmpty>
                </p>
              </EuiText>
            </>
          )}
          {filterModeActive && (
            <>
              <EuiSpacer size="xs" />
              <EuiCallOut
                size="s"
                color="warning"
                title={t.parseChipFilterModeNote}
              />
            </>
          )}
          <EuiSpacer size="s" />
          <EuiAccordion id="parse-detail" buttonContent={t.parseDetailTitle}>
            <EuiText size="s">
              <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
                {JSON.stringify(
                  {
                    parser: parseMeta.parser,
                    vector_query: parseMeta.vector_query,
                    free_text: parseMeta.free_text,
                    scene_terms_present: parseMeta.scene_terms_present,
                    extracted: parseMeta.extracted,
                    applied: parseMeta.applied,
                    rejected: parseRejected,
                    confidence: parseMeta.confidence,
                    elapsed_ms: parseMeta.elapsed_ms,
                    facet_mode: parseMeta.facet_mode,
                    suppress_extracted: suppressExtracted,
                  },
                  null,
                  2,
                )}
              </pre>
            </EuiText>
          </EuiAccordion>
        </>
      )}

      {error && (
        <>
          <EuiSpacer size="m" />
          <EuiCallOut title={t.searchError} color="danger" size="s">
            <p>{error}</p>
          </EuiCallOut>
        </>
      )}

      <EuiSpacer size="l" />
      <EuiHorizontalRule margin="none" />
      <EuiSpacer size="l" />

      <EuiFlexGroup
        gutterSize="m"
        alignItems="center"
        justifyContent="spaceBetween"
      >
        <EuiFlexItem grow={false}>
          <EuiTitle size="xs">
            <h2>{t.resultsTitle}</h2>
          </EuiTitle>
        </EuiFlexItem>
        <EuiFlexItem grow={false}>
          <EuiButtonEmpty
            size="s"
            isDisabled={!searchExplain}
            onClick={() => setExplainOpen(true)}
          >
            {t.queryExplainButton}
          </EuiButtonEmpty>
        </EuiFlexItem>
      </EuiFlexGroup>
      <EuiSpacer size="s" />
      {searchExplain?.meta?.query_dsl != null && (
        <>
          <EuiAccordion
            id="hybrid-query-dsl"
            buttonContent={t.hybridDslTitle}
            paddingSize="m"
            initialIsOpen={false}
          >
            {(searchExplain.meta.query_dsl as { status?: string })?.status ===
              'not_applied' && (
              <>
                <EuiCallOut color="warning" size="s" title={t.hybridDslNotApplied} />
                <EuiSpacer size="s" />
              </>
            )}
            <EuiDescriptionList
              type="column"
              listItems={[
                {
                  title: 'hybrid',
                  description: resultHybrid
                    ? t.queryExplainHybridOn
                    : t.queryExplainHybridOff,
                },
                {
                  title: 'text_channel_status',
                  description: String(
                    searchExplain.meta.text_channel_status ?? 'disabled',
                  ),
                },
                {
                  title: 'ranking_strategy',
                  description: String(
                    searchExplain.meta.ranking_strategy ?? '—',
                  ),
                },
                {
                  title: 'filters',
                  description:
                    searchExplain.meta.filters != null
                      ? JSON.stringify(searchExplain.meta.filters)
                      : t.queryExplainFiltersNone,
                },
                {
                  title: 'parse.applied',
                  description: JSON.stringify(
                    (searchExplain.meta.parse as { applied?: unknown } | null)
                      ?.applied ?? {},
                  ),
                },
                {
                  title: 'parse.rejected',
                  description: JSON.stringify(
                    (searchExplain.meta.parse as { rejected?: unknown } | null)
                      ?.rejected ?? [],
                  ),
                },
              ]}
              compressed
            />
            <EuiSpacer size="s" />
            <EuiText size="s">
              <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
                {JSON.stringify(searchExplain.meta.query_dsl, null, 2)}
              </pre>
            </EuiText>
          </EuiAccordion>
          <EuiSpacer size="m" />
        </>
      )}
      <EuiFlexGroup gutterSize="l" alignItems="stretch">
        <EuiFlexItem grow={3}>
          {hits.length === 0 && !searching ? (
            <EuiEmptyPrompt
              title={<h3>{t.noResults}</h3>}
              body={<p>{t.searchEmptyHint}</p>}
            />
          ) : (
            <EuiFlexGroup direction="column" gutterSize="s">
              {hitGroups.map((group) => {
                const active = group.members.some(
                  (m) => m.chunk_id === activeHit?.chunk_id,
                );
                return (
                <EuiFlexItem key={group.key} grow={false}>
                  <EuiPanel
                    hasBorder
                    paddingSize="s"
                    style={{
                      cursor: 'pointer',
                      outline: active ? '2px solid #0077CC' : undefined,
                    }}
                    onClick={() => seekToHit(group.representative)}
                  >
                    <EuiFlexGroup gutterSize="m" alignItems="center">
                      <EuiFlexItem grow={false}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={group.representative.thumb_url}
                          alt=""
                          width={120}
                          height={68}
                          style={{
                            objectFit: 'cover',
                            borderRadius: 4,
                            background: '#eee',
                          }}
                        />
                      </EuiFlexItem>
                      <EuiFlexItem>
                        <EuiText size="s">
                          <strong>{group.representative.title}</strong>
                        </EuiText>
                        <EuiText size="s" color="subdued">
                          {group.start_label} – {group.end_label}
                        </EuiText>
                        <EuiSpacer size="xs" />
                        <EuiFlexGroup gutterSize="s" alignItems="center" wrap>
                          <EuiFlexItem grow={false}>
                            <EuiText size="xs">
                              {resultHybrid
                                ? t.scoreHybridLabel
                                : t.scoreRrfLabel}{' '}
                              {formatPrimaryScore(
                                group.representative,
                                resultModality,
                                resultHybrid,
                              )}
                            </EuiText>
                          </EuiFlexItem>
                          <EuiFlexItem grow={false}>
                            <EuiText size="xs">
                              {t.scoreVisualLabel}{' '}
                              {formatScore(group.representative.score_visual)}
                            </EuiText>
                          </EuiFlexItem>
                          <EuiFlexItem grow={false}>
                            <EuiText size="xs">
                              {t.scoreAudioLabel}{' '}
                              {formatScore(group.representative.score_audio)}
                            </EuiText>
                          </EuiFlexItem>
                          <EuiFlexItem grow={false}>
                            <EuiBadge
                              color={badgeColor(
                                group.representative.modality_badge,
                              )}
                            >
                              {badgeLabel(
                                group.representative.modality_badge,
                                t,
                              )}
                            </EuiBadge>
                          </EuiFlexItem>
                          {group.representative.metadata_match && (
                            <EuiFlexItem grow={false}>
                              <EuiBadge color="hollow">
                                {t.metadataMatchBadge}
                              </EuiBadge>
                            </EuiFlexItem>
                          )}
                          {group.members.length > 1 && (
                            <EuiFlexItem grow={false}>
                              <EuiBadge color="hollow">
                                {group.members.length === 1
                                  ? t.groupedMomentsOne
                                  : t.groupedMoments.replace(
                                      '{count}',
                                      String(group.members.length),
                                    )}
                              </EuiBadge>
                            </EuiFlexItem>
                          )}
                        </EuiFlexGroup>
                        {group.members.length > 1 && (
                          <>
                            <EuiSpacer size="xs" />
                            <EuiFlexGroup gutterSize="xs" wrap>
                              {group.members.map((m) => (
                                <EuiFlexItem key={m.chunk_id} grow={false}>
                                  <EuiButton
                                    size="s"
                                    color={
                                      activeHit?.chunk_id === m.chunk_id
                                        ? 'primary'
                                        : 'text'
                                    }
                                    onClick={(e: ReactMouseEvent) => {
                                      e.stopPropagation();
                                      seekToHit(m);
                                    }}
                                  >
                                    {m.start_label}
                                  </EuiButton>
                                </EuiFlexItem>
                              ))}
                            </EuiFlexGroup>
                          </>
                        )}
                      </EuiFlexItem>
                    </EuiFlexGroup>
                  </EuiPanel>
                </EuiFlexItem>
                );
              })}
            </EuiFlexGroup>
          )}
        </EuiFlexItem>

        <EuiFlexItem grow={4}>
          <EuiTitle size="xs">
            <h2>{t.playerTitle}</h2>
          </EuiTitle>
          <EuiSpacer size="s" />
          <EuiPanel hasBorder paddingSize="s">
            <video
              ref={videoRef}
              controls
              style={{ width: '100%', maxHeight: 420, background: '#111' }}
              preload="metadata"
            />
            {activeHit && (
              <>
                <EuiSpacer size="s" />
                <EuiText size="s">
                  <p>
                    {activeHit.title} · {t.seekingTo} {activeHit.start_label}
                  </p>
                </EuiText>
              </>
            )}
          </EuiPanel>

          {activeHit && timelineHits.length > 0 && (
            <>
              <EuiSpacer size="m" />
              <EuiTitle size="xxs">
                <h3>{t.timelineTitle}</h3>
              </EuiTitle>
              <EuiSpacer size="xs" />
              <TimelineStrip
                hits={timelineHits}
                durationMs={
                  durationMs ||
                  assets.find((a) => a.video_id === activeHit.video_id)
                    ?.duration_ms ||
                  Math.max(...timelineHits.map((h) => h.end_ms), 1)
                }
                activeId={activeHit.chunk_id}
                onSelect={seekToHit}
              />
            </>
          )}
        </EuiFlexItem>
      </EuiFlexGroup>
      {explainOpen && searchExplain && (
        <SearchQueryExplainFlyout
          data={searchExplain}
          onClose={() => setExplainOpen(false)}
        />
      )}
    </AppShell>
  );
}

function TimelineStrip({
  hits,
  durationMs,
  activeId,
  onSelect,
}: {
  hits: SearchHit[];
  durationMs: number;
  activeId: string;
  onSelect: (hit: SearchHit) => void;
}) {
  const dur = Math.max(durationMs, 1);
  return (
    <div
      style={{
        position: 'relative',
        height: 28,
        background: '#e8e8e8',
        borderRadius: 4,
        overflow: 'hidden',
      }}
    >
      {hits.map((h) => {
        const left = (h.start_ms / dur) * 100;
        const width = Math.max(((h.end_ms - h.start_ms) / dur) * 100, 0.8);
        const active = h.chunk_id === activeId;
        return (
          <button
            key={h.chunk_id}
            type="button"
            title={`${h.start_label}–${h.end_label}`}
            onClick={() => onSelect(h)}
            style={{
              position: 'absolute',
              left: `${left}%`,
              width: `${width}%`,
              top: 4,
              height: 20,
              border: 'none',
              borderRadius: 3,
              cursor: 'pointer',
              background: active ? '#0077CC' : '#54B399',
              opacity: active ? 1 : 0.75,
            }}
          />
        );
      })}
    </div>
  );
}
