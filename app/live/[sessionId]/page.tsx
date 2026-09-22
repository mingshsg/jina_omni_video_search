'use client';

import {
  EuiBadge,
  EuiButton,
  EuiButtonGroup,
  EuiCallOut,
  EuiEmptyPrompt,
  EuiFieldNumber,
  EuiFieldSearch,
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
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { LiveClipPlayer } from '@/components/live/LiveClipPlayer';
import { LiveGatewayPlayer } from '@/components/live/LiveGatewayPlayer';
import {
  LiveHitCard,
  type LiveSearchHitUi,
} from '@/components/live/LiveHitCard';
import { LiveTimeline } from '@/components/live/LiveTimeline';
import { useLocale } from '@/lib/i18n/locale-context';
import {
  canClaimSearchable,
  formatBytesShort,
  formatLagMs,
  initialFollowUiState,
  liveObservedStateColor,
  reduceFollowUiEvent,
  type FollowUiState,
} from '@/lib/live/ui-state';

type SessionSummary = {
  session_id: string;
  source_id: string;
  desired_state: string;
  observed_state: string;
  revision: number;
  stream_epoch: number;
  last_sequence_no_in_current_epoch?: number;
  last_media_at: string | null;
  last_searchable_at: string | null;
  capture_lag_ms: number | null;
  processing_lag_ms: number | null;
  queue_depth: number;
  spool_bytes: number;
  windows: {
    searchable: number;
    failed: number;
    dropped: number;
  };
  reconnect_count: number;
  current_error: { code: string; message: string; at: string } | null;
  worker_available: boolean;
  variant_id: string;
  updated_at: string;
};

type PlaybackDescriptor = {
  gateway?: {
    configured?: boolean;
    hls_url?: string | null;
    webrtc_url?: string | null;
  };
};

type Modality = 'visual' | 'audio' | 'both';
type SortBy = 'rrf' | 'visual' | 'audio';
type SearchMode = 'text' | 'image';

function observedLabel(
  state: string,
  t: ReturnType<typeof useLocale>['t'],
): string {
  switch (state) {
    case 'created':
      return t.liveStateCreated;
    case 'connecting':
      return t.liveStateConnecting;
    case 'live':
      return t.liveStateLive;
    case 'degraded':
      return t.liveStateDegraded;
    case 'stopping':
      return t.liveStateStopping;
    case 'stopped':
      return t.liveStateStopped;
    case 'failed':
      return t.liveStateFailed;
    default:
      return state;
  }
}

export default function LiveSessionPage() {
  const { t, locale } = useLocale();
  const params = useParams();
  const sessionId = String(params.sessionId ?? '');

  const [session, setSession] = useState<SessionSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [eventLog, setEventLog] = useState<string[]>([]);
  const [playback, setPlayback] = useState<PlaybackDescriptor | null>(null);

  const [searchMode, setSearchMode] = useState<SearchMode>('text');
  const [query, setQuery] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [modality, setModality] = useState<Modality>('both');
  const [sortBy, setSortBy] = useState<SortBy>('rrf');
  const [size, setSize] = useState(20);
  const [follow, setFollow] = useState(true);
  const [searching, setSearching] = useState(false);
  const [hits, setHits] = useState<LiveSearchHitUi[]>([]);
  const [resultModality, setResultModality] = useState<Modality>('both');
  const [cacheStatus, setCacheStatus] = useState<'hit' | 'miss' | null>(null);
  const [followState, setFollowState] = useState<FollowUiState>(
    initialFollowUiState(),
  );
  const [activeHit, setActiveHit] = useState<LiveSearchHitUi | null>(null);
  const [stopping, setStopping] = useState(false);

  const followEsRef = useRef<EventSource | null>(null);
  const queryIdRef = useRef<string | null>(null);

  const loadSession = useCallback(async () => {
    if (!sessionId) return;
    try {
      const res = await fetch(
        `/api/live/sessions/${encodeURIComponent(sessionId)}`,
        { headers: { 'Accept-Language': locale } },
      );
      const data = (await res.json()) as SessionSummary & {
        error?: { message: string };
      };
      if (!res.ok) throw new Error(data.error?.message ?? t.liveSessionError);
      setSession(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.liveSessionError);
    } finally {
      setLoading(false);
    }
  }, [sessionId, locale, t.liveSessionError]);

  const loadPlayback = useCallback(async () => {
    if (!sessionId) return;
    try {
      const res = await fetch(
        `/api/live/sessions/${encodeURIComponent(sessionId)}/playback`,
      );
      if (!res.ok) return;
      const data = (await res.json()) as PlaybackDescriptor;
      setPlayback(data);
    } catch {
      /* optional */
    }
  }, [sessionId]);

  useEffect(() => {
    void loadSession();
    void loadPlayback();
  }, [loadSession, loadPlayback]);

  // Session SSE for status / searchable freshness (not search results).
  useEffect(() => {
    if (!sessionId) return;
    const es = new EventSource(
      `/api/live/sessions/${encodeURIComponent(sessionId)}/events`,
    );
    const onAny = (ev: MessageEvent, type: string) => {
      setEventLog((prev) =>
        [`${type}#${ev.lastEventId || '?'}`].concat(prev).slice(0, 12),
      );
      if (type === 'searchable' || type === 'session_state') {
        void loadSession();
      }
    };
    for (const type of [
      'snapshot',
      'session_state',
      'searchable',
      'window_ready',
      'window_failed',
      'window_dropped',
      'error',
      'heartbeat',
    ]) {
      es.addEventListener(type, (ev) =>
        onAny(ev as MessageEvent, type),
      );
    }
    es.onerror = () => {
      /* browser will retry; keep UI alive */
    };
    return () => es.close();
  }, [sessionId, loadSession]);

  const stopFollow = useCallback(async () => {
    followEsRef.current?.close();
    followEsRef.current = null;
    const qid = queryIdRef.current;
    queryIdRef.current = null;
    if (qid) {
      try {
        await fetch(`/api/live/search/${encodeURIComponent(qid)}`, {
          method: 'DELETE',
        });
      } catch {
        /* ignore */
      }
    }
    setFollowState((prev) => ({ ...prev, status: 'idle' }));
  }, []);

  useEffect(() => {
    return () => {
      followEsRef.current?.close();
    };
  }, []);

  const openFollowStream = useCallback(
    (queryId: string) => {
      followEsRef.current?.close();
      queryIdRef.current = queryId;
      const es = new EventSource(
        `/api/live/search/${encodeURIComponent(queryId)}/events`,
      );
      followEsRef.current = es;

      const handle = (type: string, data: Record<string, unknown>) => {
        setFollowState((prev) => {
          let event: Parameters<typeof reduceFollowUiEvent>[1];
          switch (type) {
            case 'ready':
              event = {
                type: 'ready',
                expires_at: (data.expires_at as string) ?? null,
              };
              break;
            case 'results':
              event = {
                type: 'results',
                hits: (data.hits as unknown[]) ?? [],
                reason: data.reason as string | undefined,
              };
              break;
            case 'cursor':
              event = {
                type: 'cursor',
                revision: data.revision as number | undefined,
              };
              break;
            case 'heartbeat':
              event = { type: 'heartbeat' };
              break;
            case 'error':
              event = {
                type: 'error',
                code: data.code as string | undefined,
                message: data.message as string | undefined,
              };
              break;
            default:
              return prev;
          }
          const next = reduceFollowUiEvent(prev, event);
          if (type === 'results' && Array.isArray(data.hits)) {
            setHits(data.hits as LiveSearchHitUi[]);
          }
          return next;
        });
      };

      for (const type of ['ready', 'results', 'cursor', 'heartbeat', 'error']) {
        es.addEventListener(type, (ev) => {
          try {
            const data = JSON.parse(
              (ev as MessageEvent).data as string,
            ) as Record<string, unknown>;
            handle(type, data);
          } catch {
            /* ignore malformed */
          }
        });
      }
      es.onerror = () => {
        setFollowState((prev) =>
          reduceFollowUiEvent(prev, {
            type: 'error',
            code: 'LIVE_QUERY_EXPIRED',
            message: t.liveFollowExpired,
          }),
        );
      };
    },
    [t.liveFollowExpired],
  );

  const runSearch = useCallback(async () => {
    if (!session) return;
    setError(null);
    setSearching(true);
    await stopFollow();
    try {
      let res: Response;
      if (searchMode === 'image') {
        if (!imageFile) {
          setError(t.imageRequired);
          setSearching(false);
          return;
        }
        const form = new FormData();
        form.append('file', imageFile);
        form.append('variant_id', session.variant_id);
        form.append('session_ids', JSON.stringify([session.session_id]));
        form.append('size', String(size));
        form.append('follow', follow ? 'true' : 'false');
        res = await fetch('/api/live/search/image', {
          method: 'POST',
          headers: { 'Accept-Language': locale },
          body: form,
        });
      } else {
        const q = query.trim();
        if (!q) {
          setSearching(false);
          return;
        }
        res = await fetch('/api/live/search', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept-Language': locale,
          },
          body: JSON.stringify({
            query: q,
            variant_id: session.variant_id,
            session_ids: [session.session_id],
            modality,
            sort_by: sortBy,
            size,
            follow,
          }),
        });
      }
      const data = (await res.json()) as {
        hits?: LiveSearchHitUi[];
        query_id?: string | null;
        query_vector_cache?: 'hit' | 'miss';
        follow_expires_at?: string | null;
        meta?: { modality?: Modality };
        error?: { message: string };
      };
      if (!res.ok) throw new Error(data.error?.message ?? t.searchError);
      setHits(data.hits ?? []);
      setResultModality(data.meta?.modality ?? modality);
      setCacheStatus(data.query_vector_cache ?? null);
      setActiveHit(null);
      if (follow && data.query_id) {
        setFollowState({
          ...initialFollowUiState(),
          status: 'following',
          hits: data.hits ?? [],
          expiresAt: data.follow_expires_at ?? null,
        });
        openFollowStream(data.query_id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t.searchError);
      setHits([]);
    } finally {
      setSearching(false);
    }
  }, [
    session,
    searchMode,
    imageFile,
    query,
    modality,
    sortBy,
    size,
    follow,
    locale,
    t,
    stopFollow,
    openFollowStream,
  ]);

  const stopSession = async () => {
    if (!sessionId) return;
    setStopping(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/live/sessions/${encodeURIComponent(sessionId)}/stop`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept-Language': locale,
          },
          body: JSON.stringify({}),
        },
      );
      const data = (await res.json()) as { error?: { message: string } };
      if (!res.ok) throw new Error(data.error?.message ?? t.liveSessionError);
      await loadSession();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.liveSessionError);
    } finally {
      setStopping(false);
    }
  };

  const timelineHits = useMemo(
    () =>
      hits
        .slice()
        .sort(
          (a, b) =>
            Date.parse(a.window_start_at) - Date.parse(b.window_start_at),
        ),
    [hits],
  );

  const searchableClaim = canClaimSearchable({
    windowsSearchable: session?.windows.searchable ?? 0,
  });

  if (loading) {
    return (
      <AppShell pageTitle={t.liveSessionTitle}>
        <EuiLoadingSpinner size="l" />
      </AppShell>
    );
  }

  if (!session) {
    return (
      <AppShell pageTitle={t.liveSessionTitle}>
        <EuiCallOut title={t.liveSessionError} color="danger" size="s">
          <p>{error ?? t.liveSessionError}</p>
        </EuiCallOut>
        <EuiSpacer />
        <Link href="/live">{t.liveBackToLive}</Link>
      </AppShell>
    );
  }

  return (
    <AppShell
      pageTitle={t.liveSessionTitle}
      pageDescription={`${t.liveSessionIdLabel}: ${session.session_id}`}
      rightSideItems={[
        <Link key="back" href="/live">
          <EuiButton size="s">{t.liveBackToLive}</EuiButton>
        </Link>,
        <EuiButton
          key="stop"
          color="danger"
          size="s"
          isLoading={stopping}
          onClick={() => void stopSession()}
          aria-label={t.liveStopSession}
        >
          {t.liveStopSession}
        </EuiButton>,
      ]}
    >
      {error && (
        <>
          <EuiCallOut title={t.liveSessionError} color="danger" size="s">
            <p>{error}</p>
          </EuiCallOut>
          <EuiSpacer size="m" />
        </>
      )}

      <EuiPanel hasBorder paddingSize="m">
        <EuiFlexGroup wrap gutterSize="m" alignItems="center">
          <EuiFlexItem grow={false}>
            <EuiBadge color={liveObservedStateColor(session.observed_state)}>
              {t.liveObservedState}: {observedLabel(session.observed_state, t)}
            </EuiBadge>
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <EuiBadge
              color={session.worker_available ? 'success' : 'danger'}
            >
              {session.worker_available
                ? t.liveWorkerAvailable
                : t.liveWorkerUnavailable}
            </EuiBadge>
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <EuiText size="s">
              {t.liveDesiredState}: {session.desired_state}
            </EuiText>
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <EuiText size="s">
              {t.liveVariantPinned}: {session.variant_id}
            </EuiText>
          </EuiFlexItem>
        </EuiFlexGroup>
        <EuiSpacer size="s" />
        <EuiFlexGroup wrap gutterSize="l">
          <EuiFlexItem grow={false}>
            <EuiText size="s">
              {t.liveLagCapture}: {formatLagMs(session.capture_lag_ms)}
            </EuiText>
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <EuiText size="s">
              {t.liveLagProcessing}: {formatLagMs(session.processing_lag_ms)}
            </EuiText>
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <EuiText size="s">
              {t.liveQueueDepth}: {session.queue_depth}
            </EuiText>
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <EuiText size="s">
              {t.liveSpoolBytes}: {formatBytesShort(session.spool_bytes)}
            </EuiText>
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <EuiText size="s">
              {t.liveReconnects}: {session.reconnect_count}
            </EuiText>
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <EuiText size="s">
              {t.liveWindowsSearchable}: {session.windows.searchable} /{' '}
              {t.liveWindowsFailed}: {session.windows.failed} /{' '}
              {t.liveWindowsDropped}: {session.windows.dropped}
            </EuiText>
          </EuiFlexItem>
        </EuiFlexGroup>
        <EuiSpacer size="xs" />
        <EuiText size="xs" color="subdued">
          <p>
            {t.liveLastSearchable}: {session.last_searchable_at ?? '—'} ·{' '}
            {t.liveLastMedia}: {session.last_media_at ?? '—'}
          </p>
        </EuiText>
        {session.current_error && (
          <>
            <EuiSpacer size="s" />
            <EuiCallOut
              title={session.current_error.code}
              color="warning"
              size="s"
            >
              <p>{session.current_error.message}</p>
            </EuiCallOut>
          </>
        )}
        {!searchableClaim && (
          <>
            <EuiSpacer size="s" />
            <EuiCallOut
              title={t.liveNotSearchableYet}
              color="primary"
              size="s"
              aria-live="polite"
            />
          </>
        )}
      </EuiPanel>

      <EuiSpacer size="l" />
      <EuiFlexGroup gutterSize="l">
        <EuiFlexItem grow={3}>
          <EuiTitle size="xs">
            <h2>{t.liveSearchTitle}</h2>
          </EuiTitle>
          <EuiSpacer size="s" />
          <EuiText size="xs" color="subdued">
            <p>{t.liveFreshnessHint}</p>
          </EuiText>
          <EuiSpacer size="s" />
          <EuiButtonGroup
            legend={t.liveSearchTitle}
            options={[
              { id: 'text', label: t.liveTextSearch },
              { id: 'image', label: t.liveImageSearch },
            ]}
            idSelected={searchMode}
            onChange={(id) => setSearchMode(id as SearchMode)}
            buttonSize="compressed"
            color="primary"
          />
          <EuiSpacer size="m" />
          {searchMode === 'text' ? (
            <EuiFormRow label={t.searchPlaceholder}>
              <EuiFieldSearch
                fullWidth
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onSearch={() => void runSearch()}
                aria-label={t.searchPlaceholder}
              />
            </EuiFormRow>
          ) : (
            <EuiFormRow label={t.imageUploadLabel} helpText={t.imageUploadHint}>
              <EuiFilePicker
                id="live-query-image"
                accept="image/jpeg,image/png,image/webp,image/gif"
                onChange={(files) => {
                  const f = files && files.length > 0 ? files[0] : null;
                  setImageFile(f ?? null);
                }}
                aria-label={t.imageUploadLabel}
              />
            </EuiFormRow>
          )}
          <EuiSpacer size="s" />
          <EuiFlexGroup wrap gutterSize="m" alignItems="flexEnd">
            {searchMode === 'text' && (
              <EuiFlexItem grow={false}>
                <EuiFormRow label={t.modalityLabel}>
                  <EuiButtonGroup
                    legend={t.modalityLabel}
                    options={[
                      { id: 'both', label: t.modalityBoth },
                      { id: 'visual', label: t.modalityVisual },
                      { id: 'audio', label: t.modalityAudio },
                    ]}
                    idSelected={modality}
                    onChange={(id) => setModality(id as Modality)}
                    buttonSize="compressed"
                  />
                </EuiFormRow>
              </EuiFlexItem>
            )}
            {searchMode === 'text' && (
              <EuiFlexItem grow={false} style={{ minWidth: 160 }}>
                <EuiFormRow label={t.sortByLabel}>
                  <EuiSelect
                    options={[
                      { value: 'rrf', text: t.sortByRrf },
                      { value: 'visual', text: t.sortByVisual },
                      { value: 'audio', text: t.sortByAudio },
                    ]}
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as SortBy)}
                    aria-label={t.sortByLabel}
                  />
                </EuiFormRow>
              </EuiFlexItem>
            )}
            <EuiFlexItem grow={false} style={{ width: 100 }}>
              <EuiFormRow label={t.topKLabel}>
                <EuiFieldNumber
                  value={size}
                  min={1}
                  max={100}
                  onChange={(e) => setSize(Number(e.target.value) || 20)}
                  aria-label={t.topKLabel}
                />
              </EuiFormRow>
            </EuiFlexItem>
            <EuiFlexItem grow={false}>
              <EuiFormRow label={t.liveFollowLabel} helpText={t.liveFollowHelp}>
                <EuiButtonGroup
                  legend={t.liveFollowLabel}
                  options={[
                    { id: 'on', label: t.yes },
                    { id: 'off', label: t.no },
                  ]}
                  idSelected={follow ? 'on' : 'off'}
                  onChange={(id) => setFollow(id === 'on')}
                  buttonSize="compressed"
                />
              </EuiFormRow>
            </EuiFlexItem>
            <EuiFlexItem grow={false}>
              <EuiButton
                fill
                isLoading={searching}
                onClick={() => void runSearch()}
                aria-label={t.searchButton}
              >
                {searchMode === 'image' ? t.imageSearchButton : t.searchButton}
              </EuiButton>
            </EuiFlexItem>
            {followState.status === 'following' && (
              <EuiFlexItem grow={false}>
                <EuiButton
                  onClick={() => void stopFollow()}
                  aria-label={t.liveFollowStop}
                >
                  {t.liveFollowStop}
                </EuiButton>
              </EuiFlexItem>
            )}
          </EuiFlexGroup>
          <EuiSpacer size="s" />
          <EuiFlexGroup gutterSize="s" wrap>
            {cacheStatus && (
              <EuiFlexItem grow={false}>
                <EuiBadge color={cacheStatus === 'hit' ? 'success' : 'hollow'}>
                  {cacheStatus === 'hit' ? t.liveCacheHit : t.liveCacheMiss}
                </EuiBadge>
              </EuiFlexItem>
            )}
            {followState.status === 'following' && (
              <EuiFlexItem grow={false}>
                <EuiBadge color="primary">{t.liveFollowActive}</EuiBadge>
              </EuiFlexItem>
            )}
            {followState.status === 'expired' && (
              <EuiFlexItem grow={false}>
                <EuiBadge color="warning">{t.liveFollowExpired}</EuiBadge>
              </EuiFlexItem>
            )}
          </EuiFlexGroup>

          <EuiSpacer size="m" />
          <EuiTitle size="xxs">
            <h3>{t.resultsTitle}</h3>
          </EuiTitle>
          <EuiSpacer size="s" />
          {hits.length === 0 ? (
            <EuiEmptyPrompt
              title={<h4>{t.noResults}</h4>}
              body={<p>{t.searchEmptyHint}</p>}
            />
          ) : (
            <EuiFlexGroup direction="column" gutterSize="s">
              {hits.map((hit) => (
                <EuiFlexItem key={hit.chunk_id} grow={false}>
                  <LiveHitCard
                    hit={hit}
                    active={activeHit?.chunk_id === hit.chunk_id}
                    modality={resultModality}
                    t={t}
                    onSelect={setActiveHit}
                  />
                </EuiFlexItem>
              ))}
            </EuiFlexGroup>
          )}
        </EuiFlexItem>

        <EuiFlexItem grow={4}>
          <EuiTitle size="xs">
            <h2>{t.liveClipPlayer}</h2>
          </EuiTitle>
          <EuiSpacer size="s" />
          <EuiPanel hasBorder paddingSize="s">
            <LiveClipPlayer
              clipUrl={activeHit?.clip_url ?? null}
              label={
                activeHit
                  ? `${activeHit.window_start_at} – ${activeHit.window_end_at}`
                  : undefined
              }
            />
          </EuiPanel>
          {activeHit && timelineHits.length > 0 && (
            <>
              <EuiSpacer size="m" />
              <EuiTitle size="xxs">
                <h3>{t.timelineTitle}</h3>
              </EuiTitle>
              <EuiSpacer size="xs" />
              <LiveTimeline
                hits={timelineHits}
                activeId={activeHit.chunk_id}
                onSelect={setActiveHit}
              />
            </>
          )}

          <EuiSpacer size="l" />
          <EuiTitle size="xs">
            <h2>{t.liveGatewayPlayer}</h2>
          </EuiTitle>
          <EuiSpacer size="s" />
          <EuiPanel hasBorder paddingSize="s">
            <LiveGatewayPlayer
              hlsUrl={playback?.gateway?.hls_url ?? null}
              webrtcUrl={playback?.gateway?.webrtc_url ?? null}
            />
          </EuiPanel>

          <EuiSpacer size="l" />
          <EuiTitle size="xxs">
            <h3>{t.liveEventsTitle}</h3>
          </EuiTitle>
          <EuiSpacer size="xs" />
          <EuiText size="xs" color="subdued">
            {eventLog.length === 0 ? (
              <p>—</p>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 16 }}>
                {eventLog.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
          </EuiText>
        </EuiFlexItem>
      </EuiFlexGroup>

      <EuiSpacer size="l" />
      <EuiHorizontalRule margin="none" />
    </AppShell>
  );
}
