'use client';

import Link from 'next/link';
import {
  EuiBadge,
  EuiBasicTable,
  type EuiBasicTableColumn,
  EuiButton,
  EuiCallOut,
  EuiConfirmModal,
  EuiEmptyPrompt,
  EuiFlexGroup,
  EuiFlexItem,
  EuiSpacer,
  EuiText,
} from '@elastic/eui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell, formatDurationMs } from '@/components/AppShell';
import { formatChunkPresetLabel } from '@/lib/ingest/chunk-presets';
import { useLocale } from '@/lib/i18n/locale-context';

type LibraryAsset = {
  video_id: string;
  title: string;
  source_mode: string;
  duration_ms: number;
  width: number;
  height: number;
  has_audio: boolean;
  status: string;
  error?: string;
  job_id?: string;
  job_stage?: string;
  progress_pct?: number;
  created_at: string;
  updated_at: string;
  variants: Array<{
    variant_id: string;
    chunk_preset: string;
    chunk_window_ms: number;
    chunk_overlap_ms: number;
    chunk_count: number;
    status: string;
    provider: string;
    model: string;
    error?: string;
  }>;
};

function statusColor(
  status: string,
): 'default' | 'primary' | 'success' | 'warning' | 'danger' {
  switch (status) {
    case 'ready':
      return 'success';
    case 'processing':
    case 'pending':
      return 'primary';
    case 'awaiting_confirm':
      return 'warning';
    case 'failed':
      return 'danger';
    default:
      return 'default';
  }
}

export default function LibraryPage() {
  const { t, locale } = useLocale();
  const [assets, setAssets] = useState<LibraryAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<LibraryAsset | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/library');
      const data = (await res.json()) as {
        assets?: LibraryAsset[];
        error?: { message: string };
      };
      if (!res.ok) throw new Error(data.error?.message ?? t.libraryError);
      setAssets(data.assets ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.libraryError);
    } finally {
      setLoading(false);
    }
  }, [t.libraryError]);

  useEffect(() => {
    void load();
  }, [load]);

  const retry = useCallback(
    async (asset: LibraryAsset) => {
      if (!asset.job_id) return;
      setBusyId(asset.video_id);
      setToast(null);
      try {
        const res = await fetch(
          `/api/jobs/${encodeURIComponent(asset.job_id)}/retry`,
          {
            method: 'POST',
            headers: { 'Accept-Language': locale },
          },
        );
        const data = (await res.json()) as { error?: { message: string } };
        if (!res.ok) throw new Error(data.error?.message ?? t.libraryError);
        setToast(t.retryStarted);
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : t.libraryError);
      } finally {
        setBusyId(null);
      }
    },
    [locale, t.libraryError, t.retryStarted, load],
  );

  const remove = useCallback(
    async (asset: LibraryAsset) => {
      setBusyId(asset.video_id);
      setToast(null);
      try {
        const res = await fetch(
          `/api/library/${encodeURIComponent(asset.video_id)}`,
          { method: 'DELETE' },
        );
        const data = (await res.json()) as { error?: { message: string } };
        if (!res.ok) throw new Error(data.error?.message ?? t.libraryError);
        setToast(t.removeDone);
        setRemoveTarget(null);
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : t.libraryError);
      } finally {
        setBusyId(null);
      }
    },
    [t.libraryError, t.removeDone, load],
  );

  const columns: EuiBasicTableColumn<LibraryAsset>[] = useMemo(
    () => [
      {
        field: 'title',
        name: t.colTitle,
        truncateText: true,
        render: (_: string, item: LibraryAsset) => (
          <div>
            <EuiText size="s">
              <strong>{item.title || item.video_id}</strong>
            </EuiText>
            <EuiText size="xs" color="subdued">
              {item.width}×{item.height} · {item.source_mode}
              {item.has_audio ? '' : ' · no audio'}
            </EuiText>
          </div>
        ),
      },
      {
        field: 'status',
        name: t.colStatus,
        width: '120px',
        render: (status: string) => (
          <EuiBadge color={statusColor(status)}>{status}</EuiBadge>
        ),
      },
      {
        field: 'duration_ms',
        name: t.colDuration,
        width: '90px',
        render: (ms: number) => formatDurationMs(ms),
      },
      {
        field: 'variants',
        name: t.colVariants,
        render: (variants: LibraryAsset['variants']) => (
          <EuiFlexGroup direction="column" gutterSize="xs">
            {(variants ?? []).map((v) => (
              <EuiFlexItem key={v.variant_id} grow={false}>
                <EuiText size="xs">
                  <code>{v.variant_id.slice(0, 8)}</code> ·{' '}
                  {formatChunkPresetLabel(
                    v.chunk_preset,
                    v.chunk_window_ms,
                    v.chunk_overlap_ms,
                  )}{' '}
                  · {v.chunk_count} {t.chunksLabel} ·{' '}
                  <EuiBadge color={statusColor(v.status)}>{v.status}</EuiBadge>
                </EuiText>
              </EuiFlexItem>
            ))}
          </EuiFlexGroup>
        ),
      },
      {
        field: 'updated_at',
        name: t.colUpdated,
        width: '160px',
        render: (iso: string) => (
          <EuiText size="xs">{new Date(iso).toLocaleString()}</EuiText>
        ),
      },
      {
        name: t.colActions,
        width: '220px',
        actions: [
          {
            name: t.actionSearch,
            description: t.actionSearch,
            type: 'icon',
            icon: 'search',
            onClick: () => {
              window.location.href = '/';
            },
          },
          {
            name: t.actionRetry,
            description: t.actionRetry,
            type: 'icon',
            icon: 'refresh',
            available: (item: LibraryAsset) => Boolean(item.job_id),
            enabled: (item: LibraryAsset) => busyId !== item.video_id,
            onClick: (item: LibraryAsset) => {
              void retry(item);
            },
          },
          {
            name: t.actionRemove,
            description: t.actionRemove,
            type: 'icon',
            icon: 'trash',
            color: 'danger',
            enabled: (item: LibraryAsset) => busyId !== item.video_id,
            onClick: (item: LibraryAsset) => setRemoveTarget(item),
          },
        ],
      },
    ],
    [t, busyId, retry],
  );

  return (
    <AppShell
      pageTitle={t.libraryTitle}
      pageDescription={t.libraryDescription}
      restrictWidth="1100px"
      rightSideItems={[
        <EuiButton key="refresh" onClick={() => void load()} isLoading={loading}>
          {t.refresh}
        </EuiButton>,
      ]}
    >
      {error && (
        <>
          <EuiCallOut color="danger" size="s" title={error} />
          <EuiSpacer size="m" />
        </>
      )}
      {toast && (
        <>
          <EuiCallOut color="success" size="s" title={toast} />
          <EuiSpacer size="m" />
        </>
      )}
      <EuiText size="xs" color="subdued">
        <p>{t.removeNote}</p>
      </EuiText>
      <EuiSpacer size="s" />

      {!loading && assets.length === 0 ? (
        <EuiEmptyPrompt
          title={<h2>{t.libraryEmpty}</h2>}
          actions={
            <Link href="/ingest">
              <EuiButton fill>{t.libraryEmptyAction}</EuiButton>
            </Link>
          }
        />
      ) : (
        <EuiBasicTable
          items={assets}
          columns={columns}
          loading={loading}
          rowHeader="title"
        />
      )}

      {removeTarget && (
        <EuiConfirmModal
          title={t.actionRemove}
          onCancel={() => setRemoveTarget(null)}
          onConfirm={() => void remove(removeTarget)}
          cancelButtonText={t.cancelConfirm}
          confirmButtonText={t.actionRemove}
          buttonColor="danger"
          defaultFocusedButton="confirm"
        >
          <p>{t.removeConfirm}</p>
          <EuiText size="s">
            <strong>{removeTarget.title || removeTarget.video_id}</strong>
          </EuiText>
        </EuiConfirmModal>
      )}
    </AppShell>
  );
}
