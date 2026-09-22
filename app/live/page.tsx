'use client';

import {
  EuiBadge,
  EuiButton,
  EuiButtonEmpty,
  EuiCallOut,
  EuiCheckbox,
  EuiConfirmModal,
  EuiEmptyPrompt,
  EuiFieldText,
  EuiFlexGroup,
  EuiFlexItem,
  EuiFormRow,
  EuiHorizontalRule,
  EuiPanel,
  EuiSelect,
  EuiSpacer,
  EuiText,
  EuiTitle,
} from '@elastic/eui';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { useLocale } from '@/lib/i18n/locale-context';
import {
  formatBytesShort,
  formatLagMs,
  isLiveConnectionRefInputValid,
  liveObservedStateColor,
  liveValidationStateColor,
} from '@/lib/live/ui-state';

type LiveSourceRow = {
  source_id: string;
  name: string;
  protocol: string;
  connection_ref: string;
  transport?: string;
  enabled: boolean;
  validation_state: string;
  endpoint_redacted?: string;
  active_session_id?: string | null;
  latest_session?: {
    session_id: string;
    desired_state: string;
    observed_state: string;
    revision: number;
    updated_at: string;
  } | null;
};

function isE2eSourceName(name: string): boolean {
  return name.startsWith('app-e2e-');
}

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

function validationLabel(
  state: string,
  t: ReturnType<typeof useLocale>['t'],
): string {
  switch (state) {
    case 'pending_validation':
      return t.liveValidationPending;
    case 'ready':
      return t.liveValidationReady;
    case 'invalid':
      return t.liveValidationInvalid;
    default:
      return state;
  }
}

export default function LiveSourcesPage() {
  const { t, locale } = useLocale();
  const [sources, setSources] = useState<LiveSourceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [connectionRef, setConnectionRef] = useState('LIVE_SOURCE_DEMO_URL');
  const [protocol, setProtocol] = useState('rtsp');
  const [transport, setTransport] = useState('tcp');
  const [protocolOptions, setProtocolOptions] = useState<
    Array<{ protocol: string; transports: string[] }>
  >([{ protocol: 'rtsp', transports: ['tcp'] }]);
  const [enabled, setEnabled] = useState(true);
  const [creating, setCreating] = useState(false);
  const [startingId, setStartingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<LiveSourceRow | null>(null);
  const [hideE2e, setHideE2e] = useState(true);
  const [bulkDeletingE2e, setBulkDeletingE2e] = useState(false);
  const [confirmBulkE2e, setConfirmBulkE2e] = useState(false);
  const [info, setInfo] = useState<string | null>(null);

  const loadProtocols = useCallback(async () => {
    try {
      const res = await fetch('/api/live/protocols', {
        headers: { 'Accept-Language': locale },
      });
      const data = (await res.json()) as {
        protocols?: Array<{ protocol: string; transports: string[] }>;
      };
      if (res.ok && data.protocols?.length) {
        setProtocolOptions(data.protocols);
        const first = data.protocols[0]!;
        setProtocol(first.protocol);
        setTransport(first.transports[0] ?? 'tcp');
      }
    } catch {
      // Keep RTSP-only defaults when the hint endpoint is unavailable.
    }
  }, [locale]);

  const loadSources = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/live/sources', {
        headers: { 'Accept-Language': locale },
      });
      const data = (await res.json()) as {
        sources?: LiveSourceRow[];
        error?: { message: string };
      };
      if (!res.ok) throw new Error(data.error?.message ?? t.liveSourceError);
      setSources(data.sources ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.liveSourceError);
    } finally {
      setLoading(false);
    }
  }, [locale, t.liveSourceError]);

  useEffect(() => {
    void loadProtocols();
    void loadSources();
  }, [loadProtocols, loadSources]);

  const selectedProtocol =
    protocolOptions.find((p) => p.protocol === protocol) ?? protocolOptions[0];
  const transportChoices = selectedProtocol?.transports ?? ['tcp'];
  const protocolSelectDisabled = protocolOptions.length <= 1;
  const transportSelectDisabled = transportChoices.length <= 1;

  const e2eSources = useMemo(
    () => sources.filter((s) => isE2eSourceName(s.name)),
    [sources],
  );
  const visibleSources = useMemo(
    () => (hideE2e ? sources.filter((s) => !isE2eSourceName(s.name)) : sources),
    [sources, hideE2e],
  );

  const createSource = async () => {
    setError(null);
    setInfo(null);
    if (!name.trim()) {
      setError(t.liveSourceNameLabel);
      return;
    }
    if (!isLiveConnectionRefInputValid(connectionRef)) {
      setError(t.liveInvalidConnectionRef);
      return;
    }
    setCreating(true);
    try {
      const res = await fetch('/api/live/sources', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept-Language': locale,
        },
        body: JSON.stringify({
          name: name.trim(),
          protocol,
          connection_ref: connectionRef.trim(),
          transport,
          enabled,
        }),
      });
      const data = (await res.json()) as { error?: { message: string } };
      if (!res.ok) throw new Error(data.error?.message ?? t.liveSourceError);
      setName('');
      await loadSources();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.liveSourceError);
    } finally {
      setCreating(false);
    }
  };

  const startSession = async (sourceId: string) => {
    setError(null);
    setInfo(null);
    setStartingId(sourceId);
    try {
      const idempotencyKey = `ui-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const res = await fetch('/api/live/sessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept-Language': locale,
        },
        body: JSON.stringify({
          source_id: sourceId,
          idempotency_key: idempotencyKey,
        }),
      });
      const data = (await res.json()) as {
        session?: { session_id: string };
        error?: { message: string };
      };
      if (!res.ok) throw new Error(data.error?.message ?? t.liveSessionError);
      const sessionId = data.session?.session_id;
      if (sessionId) {
        window.location.href = `/live/${encodeURIComponent(sessionId)}`;
        return;
      }
      await loadSources();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.liveSessionError);
    } finally {
      setStartingId(null);
    }
  };

  const deleteSource = async (source: LiveSourceRow) => {
    setError(null);
    setInfo(null);
    setDeletingId(source.source_id);
    try {
      const res = await fetch(
        `/api/live/sources/${encodeURIComponent(source.source_id)}`,
        {
          method: 'DELETE',
          headers: { 'Accept-Language': locale },
        },
      );
      const data = (await res.json()) as { error?: { message: string } };
      if (!res.ok) throw new Error(data.error?.message ?? t.liveSourceError);
      setDeleteTarget(null);
      await loadSources();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.liveSourceError);
    } finally {
      setDeletingId(null);
    }
  };

  const deleteAllE2eSources = async () => {
    setError(null);
    setInfo(null);
    setBulkDeletingE2e(true);
    setConfirmBulkE2e(false);
    const failures: string[] = [];
    let deleted = 0;
    try {
      for (const source of e2eSources) {
        const res = await fetch(
          `/api/live/sources/${encodeURIComponent(source.source_id)}`,
          {
            method: 'DELETE',
            headers: { 'Accept-Language': locale },
          },
        );
        if (res.ok) {
          deleted += 1;
        } else {
          const data = (await res.json()) as { error?: { message: string } };
          failures.push(
            `${source.name}: ${data.error?.message ?? t.liveSourceError}`,
          );
        }
      }
      await loadSources();
      if (failures.length) {
        setError(failures.join(' · '));
      } else {
        setInfo(`${t.liveDeleteE2eDone} (${deleted})`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t.liveSourceError);
    } finally {
      setBulkDeletingE2e(false);
    }
  };

  return (
    <AppShell pageTitle={t.liveTitle} pageDescription={t.liveDescription}>
      {error && (
        <>
          <EuiCallOut title={t.liveSourceError} color="danger" size="s">
            <p>{error}</p>
          </EuiCallOut>
          <EuiSpacer size="m" />
        </>
      )}
      {info && (
        <>
          <EuiCallOut title={info} color="success" size="s" />
          <EuiSpacer size="m" />
        </>
      )}

      <EuiPanel hasBorder paddingSize="m">
        <EuiTitle size="xs">
          <h2>{t.liveRegisterSource}</h2>
        </EuiTitle>
        <EuiSpacer size="s" />
        <EuiFlexGroup gutterSize="m" wrap alignItems="flexStart">
          <EuiFlexItem grow={2}>
            <EuiFormRow label={t.liveSourceNameLabel}>
              <EuiFieldText
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t.liveSourceNamePlaceholder}
                aria-label={t.liveSourceNameLabel}
              />
            </EuiFormRow>
          </EuiFlexItem>
          <EuiFlexItem grow={3}>
            <EuiFormRow
              label={t.liveConnectionRefLabel}
              helpText={t.liveConnectionRefHelp}
            >
              <EuiFieldText
                value={connectionRef}
                onChange={(e) => setConnectionRef(e.target.value)}
                placeholder={t.liveConnectionRefPlaceholder}
                aria-label={t.liveConnectionRefLabel}
              />
            </EuiFormRow>
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <EuiFormRow label={t.liveProtocolLabel}>
              <EuiSelect
                options={protocolOptions.map((p) => ({
                  value: p.protocol,
                  text: p.protocol,
                }))}
                value={protocol}
                disabled={protocolSelectDisabled}
                onChange={(e) => {
                  const next = e.target.value;
                  setProtocol(next);
                  const match = protocolOptions.find((p) => p.protocol === next);
                  setTransport(match?.transports[0] ?? 'tcp');
                }}
                aria-label={t.liveProtocolLabel}
              />
            </EuiFormRow>
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <EuiFormRow label={t.liveTransportLabel}>
              <EuiSelect
                options={transportChoices.map((tr) => ({
                  value: tr,
                  text: tr,
                }))}
                value={transport}
                disabled={transportSelectDisabled}
                onChange={(e) => setTransport(e.target.value)}
                aria-label={t.liveTransportLabel}
              />
            </EuiFormRow>
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <EuiFormRow hasEmptyLabelSpace>
              <EuiCheckbox
                id="live-source-enabled"
                label={t.liveSourceEnabled}
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
            </EuiFormRow>
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <EuiFormRow hasEmptyLabelSpace>
              <EuiButton
                fill
                onClick={() => void createSource()}
                isLoading={creating}
                aria-label={t.liveCreateSource}
              >
                {t.liveCreateSource}
              </EuiButton>
            </EuiFormRow>
          </EuiFlexItem>
        </EuiFlexGroup>
        <EuiSpacer size="s" />
        <EuiText size="xs" color="subdued">
          <p>{t.liveIdempotencyHint}</p>
        </EuiText>
      </EuiPanel>

      <EuiSpacer size="l" />
      <EuiFlexGroup justifyContent="spaceBetween" alignItems="center" wrap>
        <EuiFlexItem grow={false}>
          <EuiTitle size="xs">
            <h2>{t.liveSourcesTitle}</h2>
          </EuiTitle>
        </EuiFlexItem>
        <EuiFlexItem grow={false}>
          <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false} wrap>
            <EuiFlexItem grow={false}>
              <EuiCheckbox
                id="live-hide-e2e"
                label={t.liveHideE2eSources}
                checked={hideE2e}
                onChange={(e) => setHideE2e(e.target.checked)}
              />
            </EuiFlexItem>
            {e2eSources.length > 0 && (
              <EuiFlexItem grow={false}>
                <EuiButtonEmpty
                  size="s"
                  color="danger"
                  isLoading={bulkDeletingE2e}
                  onClick={() => setConfirmBulkE2e(true)}
                  aria-label={t.liveDeleteAllE2eSources}
                >
                  {t.liveDeleteAllE2eSources} ({e2eSources.length})
                </EuiButtonEmpty>
              </EuiFlexItem>
            )}
            <EuiFlexItem grow={false}>
              <EuiButton
                onClick={() => void loadSources()}
                isLoading={loading}
                aria-label={t.liveRefreshSources}
              >
                {t.liveRefreshSources}
              </EuiButton>
            </EuiFlexItem>
          </EuiFlexGroup>
        </EuiFlexItem>
      </EuiFlexGroup>
      <EuiSpacer size="s" />

      {!loading && visibleSources.length === 0 ? (
        <EuiEmptyPrompt title={<h3>{t.liveNoSources}</h3>} />
      ) : (
        <EuiFlexGroup direction="column" gutterSize="s">
          {visibleSources.map((s) => {
            const latest = s.latest_session;
            return (
              <EuiFlexItem key={s.source_id} grow={false}>
                <EuiPanel hasBorder paddingSize="m">
                  <EuiFlexGroup
                    justifyContent="spaceBetween"
                    alignItems="flexStart"
                    wrap
                  >
                    <EuiFlexItem>
                      <EuiText>
                        <strong>{s.name}</strong>
                      </EuiText>
                      <EuiText size="s" color="subdued">
                        {t.liveSourceIdLabel}: {s.source_id}
                      </EuiText>
                      <EuiText size="s" color="subdued">
                        {s.connection_ref}
                        {s.endpoint_redacted
                          ? ` · ${t.liveEndpointLabel}: ${s.endpoint_redacted}`
                          : ''}
                      </EuiText>
                      <EuiSpacer size="xs" />
                      <EuiFlexGroup gutterSize="s" wrap>
                        <EuiFlexItem grow={false}>
                          <EuiBadge
                            color={liveValidationStateColor(s.validation_state)}
                          >
                            {t.liveValidationState}:{' '}
                            {validationLabel(s.validation_state, t)}
                          </EuiBadge>
                        </EuiFlexItem>
                        {latest && (
                          <EuiFlexItem grow={false}>
                            <EuiBadge
                              color={liveObservedStateColor(
                                latest.observed_state,
                              )}
                            >
                              {t.liveObservedState}:{' '}
                              {observedLabel(latest.observed_state, t)}
                            </EuiBadge>
                          </EuiFlexItem>
                        )}
                        {!s.enabled && (
                          <EuiFlexItem grow={false}>
                            <EuiBadge color="hollow">disabled</EuiBadge>
                          </EuiFlexItem>
                        )}
                      </EuiFlexGroup>
                    </EuiFlexItem>
                    <EuiFlexItem grow={false}>
                      <EuiFlexGroup
                        gutterSize="s"
                        responsive={false}
                        wrap
                        alignItems="center"
                      >
                        {latest?.session_id && (
                          <EuiFlexItem grow={false}>
                            <Link
                              href={`/live/${encodeURIComponent(latest.session_id)}`}
                            >
                              <EuiButton size="s" aria-label={t.liveOpenSession}>
                                {t.liveOpenSession}
                              </EuiButton>
                            </Link>
                          </EuiFlexItem>
                        )}
                        <EuiFlexItem grow={false}>
                          <EuiButton
                            size="s"
                            fill
                            disabled={
                              !s.enabled || s.validation_state !== 'ready'
                            }
                            isLoading={startingId === s.source_id}
                            onClick={() => void startSession(s.source_id)}
                            aria-label={t.liveStartSession}
                          >
                            {t.liveStartSession}
                          </EuiButton>
                        </EuiFlexItem>
                        <EuiFlexItem grow={false}>
                          <EuiButton
                            size="s"
                            fill
                            color="danger"
                            iconType="trash"
                            isLoading={deletingId === s.source_id}
                            onClick={() => setDeleteTarget(s)}
                            aria-label={t.liveDeleteSource}
                            data-test-subj={`live-delete-source-${s.source_id}`}
                          >
                            {t.liveDeleteSource}
                          </EuiButton>
                        </EuiFlexItem>
                      </EuiFlexGroup>
                    </EuiFlexItem>
                  </EuiFlexGroup>
                  {latest && (
                    <>
                      <EuiHorizontalRule margin="s" />
                      <EuiText size="xs" color="subdued">
                        <p>
                          {t.liveSessionIdLabel}: {latest.session_id} · rev{' '}
                          {latest.revision} · lag —
                          {formatLagMs(undefined)} / spool{' '}
                          {formatBytesShort(undefined)}
                        </p>
                      </EuiText>
                    </>
                  )}
                </EuiPanel>
              </EuiFlexItem>
            );
          })}
        </EuiFlexGroup>
      )}

      {deleteTarget && (
        <EuiConfirmModal
          title={t.liveDeleteSource}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => void deleteSource(deleteTarget)}
          cancelButtonText={t.cancelConfirm}
          confirmButtonText={t.liveDeleteSource}
          buttonColor="danger"
          defaultFocusedButton="confirm"
        >
          <p>{t.liveDeleteSourceConfirm}</p>
          <EuiText size="s">
            <strong>{deleteTarget.name}</strong>
          </EuiText>
          <EuiText size="xs" color="subdued">
            <p>{t.liveDeleteSourceHint}</p>
          </EuiText>
        </EuiConfirmModal>
      )}

      {confirmBulkE2e && (
        <EuiConfirmModal
          title={t.liveDeleteAllE2eSources}
          onCancel={() => setConfirmBulkE2e(false)}
          onConfirm={() => void deleteAllE2eSources()}
          cancelButtonText={t.cancelConfirm}
          confirmButtonText={t.liveDeleteAllE2eSources}
          buttonColor="danger"
          defaultFocusedButton="confirm"
        >
          <p>{t.liveDeleteAllE2eConfirm}</p>
          <EuiText size="s">
            <p>{e2eSources.length} × app-e2e-*</p>
          </EuiText>
        </EuiConfirmModal>
      )}
    </AppShell>
  );
}
