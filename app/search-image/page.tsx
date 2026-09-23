'use client';

import {
  EuiBadge,
  EuiButton,
  EuiAccordion,
  EuiCallOut,
  EuiEmptyPrompt,
  EuiFieldNumber,
  EuiFilePicker,
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
  EMPTY_FACETS,
  facetsToApiFilters,
  SearchFacets,
  type SearchFacetState,
} from '@/components/SearchFacets';
import {
  groupSearchHitsTopK,
  oversampleForGroupedTopK,
} from '@/lib/es/group-hits';
import { formatChunkPresetLabel } from '@/lib/ingest/chunk-presets';
import { useLocale } from '@/lib/i18n/locale-context';

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
  modality_badge: 'visual' | 'audio' | 'both';
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

const ACCEPT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

function formatScore(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return value.toFixed(3);
}

function isAcceptedImage(file: File): boolean {
  if (ACCEPT_TYPES.includes(file.type)) return true;
  const lower = file.name.toLowerCase();
  return (
    lower.endsWith('.jpg') ||
    lower.endsWith('.jpeg') ||
    lower.endsWith('.png') ||
    lower.endsWith('.webp') ||
    lower.endsWith('.gif')
  );
}

export default function ImageSearchPage() {
  const { t } = useLocale();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [variantId, setVariantId] = useState('');
  const [videoId, setVideoId] = useState('');
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

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
      }
    };
  }, []);

  const setSelectedFile = useCallback(
    (file: File | null) => {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = null;
      }
      if (!file) {
        setImageFile(null);
        setPreviewUrl(null);
        return;
      }
      if (!isAcceptedImage(file)) {
        setError(t.imageTypeError);
        setImageFile(null);
        setPreviewUrl(null);
        return;
      }
      setError(null);
      const url = URL.createObjectURL(file);
      previewUrlRef.current = url;
      setImageFile(file);
      setPreviewUrl(url);
    },
    [t.imageTypeError],
  );

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

  const runSearch = useCallback(async () => {
    setError(null);
    if (!variantId) {
      setError(t.selectVariantFirst);
      return;
    }
    if (!imageFile) {
      setError(t.imageRequired);
      return;
    }

    setSearching(true);
    try {
      const parsedFacets = facetsToApiFilters(facets, {
        yearInvalid: t.facetYearInvalid,
        yearReversed: t.facetYearReversed,
      });
      if (!parsedFacets.ok) {
        setError(parsedFacets.error);
        setSearching(false);
        return;
      }
      const form = new FormData();
      form.append('file', imageFile);
      form.append('variant_id', variantId);
      if (videoId) form.append('video_id', videoId);
      form.append('size', String(oversampleForGroupedTopK(size)));
      if (parsedFacets.filters) {
        form.append('filters', JSON.stringify(parsedFacets.filters));
      }

      const res = await fetch('/api/search/image', {
        method: 'POST',
        body: form,
      });
      const data = (await res.json()) as {
        hits?: SearchHit[];
        error?: { message: string };
      };
      if (!res.ok) throw new Error(data.error?.message ?? t.searchError);
      setHits(data.hits ?? []);
      setActiveHit(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.searchError);
      setHits([]);
    } finally {
      setSearching(false);
    }
  }, [imageFile, variantId, videoId, size, facets, t]);

  return (
    <AppShell
      pageTitle={t.imageSearchTitle}
      pageDescription={t.imageSearchSubtitle}
    >
      <EuiFlexGroup gutterSize="m" alignItems="flexStart" wrap>
        <EuiFlexItem grow={3}>
          <EuiFormRow
            fullWidth
            label={t.imageUploadLabel}
            helpText={t.imageUploadHint}
          >
            <EuiFilePicker
              id="image-search-file"
              fullWidth
              initialPromptText={t.imageDropHint}
              accept={ACCEPT_TYPES.join(',')}
              onChange={(files) => {
                const next = files && files.length > 0 ? files[0] : null;
                setSelectedFile(next);
              }}
              display="large"
              aria-label={t.imageUploadLabel}
            />
          </EuiFormRow>
          {previewUrl && imageFile && (
            <>
              <EuiSpacer size="s" />
              <EuiFlexGroup gutterSize="m" alignItems="center">
                <EuiFlexItem grow={false}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={previewUrl}
                    alt=""
                    width={160}
                    height={100}
                    style={{
                      objectFit: 'contain',
                      borderRadius: 4,
                      background: '#eee',
                    }}
                  />
                </EuiFlexItem>
                <EuiFlexItem>
                  <EuiText size="s">
                    <p>
                      {t.imageSelectedLabel}: {imageFile.name}
                    </p>
                  </EuiText>
                  <EuiButton size="s" onClick={() => setSelectedFile(null)}>
                    {t.imageClear}
                  </EuiButton>
                </EuiFlexItem>
              </EuiFlexGroup>
            </>
          )}
        </EuiFlexItem>
        <EuiFlexItem grow={false} style={{ alignSelf: 'flex-end' }}>
          <EuiButton
            fill
            onClick={() => void runSearch()}
            isLoading={searching}
            disabled={loadingLib || !variantId || !imageFile}
          >
            {t.imageSearchButton}
          </EuiButton>
        </EuiFlexItem>
      </EuiFlexGroup>

      <EuiSpacer size="m" />

      <EuiAccordion
        id="image-search-facets"
        buttonContent={
          facetsActiveCount > 0
            ? `${t.facetsLabel} (${facetsActiveCount})`
            : t.facetsLabel
        }
        paddingSize="m"
        initialIsOpen={false}
      >
        <SearchFacets value={facets} onChange={setFacets} />
      </EuiAccordion>

      <EuiSpacer size="m" />

      <EuiFlexGroup gutterSize="m" wrap>
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
              body={<p>{t.imageSearchEmptyHint}</p>}
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
                              {t.scoreVisualLabel}{' '}
                              {formatScore(
                                group.representative.score_visual ??
                                  group.representative.score,
                              )}
                            </EuiText>
                          </EuiFlexItem>
                          <EuiFlexItem grow={false}>
                            <EuiBadge color="primary">
                              {t.modalityVisual}
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
