'use client';

import {
  EuiBadge,
  EuiButton,
  EuiButtonGroup,
  EuiCallOut,
  EuiEmptyPrompt,
  EuiFieldSearch,
  EuiFieldNumber,
  EuiFlexGroup,
  EuiFlexItem,
  EuiFormRow,
  EuiHorizontalRule,
  EuiLoadingSpinner,
  EuiPanel,
  EuiSelect,
  EuiSpacer,
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
  groupSearchHitsTopK,
  oversampleForGroupedTopK,
} from '@/lib/es/group-hits';
import { formatChunkPresetLabel } from '@/lib/ingest/chunk-presets';
import { useLocale } from '@/lib/i18n/locale-context';

type Modality = 'visual' | 'audio' | 'both';
type ModalityBadge = 'visual' | 'audio' | 'both';
type SortBy = 'rrf' | 'visual' | 'audio';

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
  const [variantId, setVariantId] = useState('');
  const [videoId, setVideoId] = useState<string>('');
  const [size, setSize] = useState(5);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [assets, setAssets] = useState<LibraryAsset[]>([]);
  const [variantIds, setVariantIds] = useState<string[]>([]);
  const [loadingLib, setLoadingLib] = useState(true);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeHit, setActiveHit] = useState<SearchHit | null>(null);
  const [durationMs, setDurationMs] = useState(0);
  const [resultModality, setResultModality] = useState<Modality>('visual');

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

  const runSearch = useCallback(async (sortOverride?: SortBy) => {
    setError(null);
    if (!variantId) {
      setError(t.selectVariantFirst);
      return;
    }
    const q = query.trim();
    if (!q) return;
    const nextSort = sortOverride ?? sortBy;

    setSearching(true);
    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: q,
          modality,
          variant_id: variantId,
          video_id: videoId || null,
          size: oversampleForGroupedTopK(size),
          sort_by: nextSort,
        }),
      });
      const data = (await res.json()) as {
        hits?: SearchHit[];
        meta?: { modality?: Modality };
        error?: { message: string };
      };
      if (!res.ok) throw new Error(data.error?.message ?? t.searchError);
      setHits(data.hits ?? []);
      setResultModality(data.meta?.modality ?? modality);
      setActiveHit(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.searchError);
      setHits([]);
    } finally {
      setSearching(false);
    }
  }, [query, modality, variantId, videoId, size, sortBy, t]);

  const modalityOptions = [
    { id: 'visual', label: t.modalityVisual },
    { id: 'audio', label: t.modalityAudio },
    { id: 'both', label: t.modalityBoth },
  ];

  const sortOptions = [
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
    if (next !== 'both' && sortBy === 'rrf') {
      // RRF needs both modalities; fall back to the active single modality.
      setSortBy(next);
    }
  };

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
          <EuiFormRow label={t.sortByLabel} helpText={t.sortByHelp}>
            <EuiSelect
              options={sortOptions}
              value={sortBy}
              onChange={(e) => {
                const next = e.target.value as SortBy;
                setSortBy(next);
                if (query.trim() && variantId) void runSearch(next);
              }}
              aria-label={t.sortByLabel}
            />
          </EuiFormRow>
        </EuiFlexItem>
      </EuiFlexGroup>

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

      <EuiFlexGroup gutterSize="l" alignItems="stretch">
        <EuiFlexItem grow={3}>
          <EuiTitle size="xs">
            <h2>{t.resultsTitle}</h2>
          </EuiTitle>
          <EuiSpacer size="s" />
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
                              {t.scoreRrfLabel}{' '}
                              {formatRrfScore(
                                group.representative.score,
                                resultModality,
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
