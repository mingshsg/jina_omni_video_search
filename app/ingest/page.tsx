'use client';

import {
  EuiBadge,
  EuiButton,
  EuiCallOut,
  EuiCheckbox,
  EuiFieldText,
  EuiFilePicker,
  EuiFlexGroup,
  EuiFlexItem,
  EuiForm,
  EuiFormRow,
  EuiPanel,
  EuiProgress,
  EuiRadioGroup,
  EuiSelect,
  EuiSpacer,
  EuiText,
  EuiTitle,
} from '@elastic/eui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import {
  IMPORT_CHUNK_PRESET_NAMES,
  type ImportChunkPreset,
} from '@/lib/ingest/chunk-presets';
import { useLocale } from '@/lib/i18n/locale-context';

type ImportScope = 'single' | 'batch';
type IngestMode = 'url' | 'local' | 'upload';
type BatchSource = 'upload' | 'folder';

type Workload = {
  windows: number;
  inference_calls: number;
  has_audio: boolean;
  chunk_preset: string;
};

type ProgressSnapshot = {
  job_id: string;
  video_id: string;
  status: string;
  stage: string;
  progress_pct: number;
  windows_total: number;
  windows_done: number;
  windows_failed: number;
  variant_id?: string;
  workload?: Workload | null;
  throughput_windows_per_min?: number | null;
  message?: string;
  error?: { code: string; message: string };
};

type BatchJobRow = {
  job_id: string;
  video_id: string;
  title: string;
  progress: ProgressSnapshot;
};

type BatchItemError = {
  source: string;
  code: string;
  message: string;
};

/** Brief success toast before clearing progress so the next import can start. */
const SUCCESS_RESET_MS = 2500;

export default function IngestPage() {
  const { t, locale } = useLocale();
  const [scope, setScope] = useState<ImportScope>('single');
  const [mode, setMode] = useState<IngestMode>('url');
  const [batchSource, setBatchSource] = useState<BatchSource>('upload');
  const [url, setUrl] = useState('');
  const [localPath, setLocalPath] = useState('');
  const [folderPath, setFolderPath] = useState('');
  const [title, setTitle] = useState('');
  const [chunkPreset, setChunkPreset] =
    useState<ImportChunkPreset>('2s');
  const [autoStart, setAutoStart] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [batchFiles, setBatchFiles] = useState<File[]>([]);
  const [filePickerKey, setFilePickerKey] = useState(0);
  const [batchPickerKey, setBatchPickerKey] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProgressSnapshot | null>(null);
  const [batchRows, setBatchRows] = useState<BatchJobRow[]>([]);
  const [batchErrors, setBatchErrors] = useState<BatchItemError[]>([]);
  const [batchDoneCount, setBatchDoneCount] = useState(0);
  const [batchFailedCount, setBatchFailedCount] = useState(0);
  const [batchFinishedBanner, setBatchFinishedBanner] = useState(false);
  const [lastSuccessTitle, setLastSuccessTitle] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const batchStreamsRef = useRef<Map<string, EventSource>>(new Map());
  const successResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const displayTitleRef = useRef('');
  const batchDoneRef = useRef(0);
  const batchFailedRef = useRef(0);
  const batchTotalRef = useRef(0);

  const closeStream = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
  }, []);

  const closeBatchStreams = useCallback(() => {
    for (const es of batchStreamsRef.current.values()) {
      es.close();
    }
    batchStreamsRef.current.clear();
  }, []);

  const clearSuccessResetTimer = useCallback(() => {
    if (successResetRef.current) {
      clearTimeout(successResetRef.current);
      successResetRef.current = null;
    }
  }, []);

  const resetFormForNextImport = useCallback(() => {
    clearSuccessResetTimer();
    closeStream();
    setUrl('');
    setLocalPath('');
    setTitle('');
    setFile(null);
    setFilePickerKey((k) => k + 1);
    setJobId(null);
    setProgress(null);
    setClientError(null);
    setApiError(null);
    setSubmitting(false);
  }, [clearSuccessResetTimer, closeStream]);

  const resetBatchForm = useCallback(() => {
    closeBatchStreams();
    setBatchFiles([]);
    setBatchPickerKey((k) => k + 1);
    setFolderPath('');
    setBatchRows([]);
    setBatchErrors([]);
    setBatchDoneCount(0);
    setBatchFailedCount(0);
    batchDoneRef.current = 0;
    batchFailedRef.current = 0;
    batchTotalRef.current = 0;
    setClientError(null);
    setApiError(null);
    setSubmitting(false);
  }, [closeBatchStreams]);

  useEffect(
    () => () => {
      closeStream();
      closeBatchStreams();
      clearSuccessResetTimer();
    },
    [closeStream, closeBatchStreams, clearSuccessResetTimer],
  );

  const attachStream = useCallback(
    (id: string) => {
      closeStream();
      clearSuccessResetTimer();
      const es = new EventSource(`/api/jobs/${encodeURIComponent(id)}/stream`);
      esRef.current = es;

      const onPayload = (raw: MessageEvent) => {
        try {
          const data = JSON.parse(String(raw.data)) as ProgressSnapshot;
          setProgress(data);
          if (data.status === 'ready') {
            closeStream();
            const label = displayTitleRef.current || data.video_id;
            clearSuccessResetTimer();
            successResetRef.current = setTimeout(() => {
              successResetRef.current = null;
              setLastSuccessTitle(label);
              resetFormForNextImport();
            }, SUCCESS_RESET_MS);
          } else if (data.status === 'failed') {
            closeStream();
            clearSuccessResetTimer();
          }
        } catch {
          /* ignore malformed SSE */
        }
      };

      for (const name of [
        'snapshot',
        'estimate',
        'progress',
        'window_done',
        'window_failed',
        'complete',
        'error',
      ]) {
        es.addEventListener(name, onPayload as EventListener);
      }
      es.onerror = () => {
        /* browser will retry; leave open */
      };
    },
    [clearSuccessResetTimer, closeStream, resetFormForNextImport],
  );

  const maybeFinishBatch = useCallback(() => {
    const finished = batchDoneRef.current + batchFailedRef.current;
    if (batchTotalRef.current > 0 && finished >= batchTotalRef.current) {
      setBatchFinishedBanner(true);
      setTimeout(() => {
        resetBatchForm();
      }, SUCCESS_RESET_MS);
    }
  }, [resetBatchForm]);

  const attachBatchStream = useCallback(
    (row: BatchJobRow) => {
      const existing = batchStreamsRef.current.get(row.job_id);
      if (existing) {
        existing.close();
        batchStreamsRef.current.delete(row.job_id);
      }
      const es = new EventSource(
        `/api/jobs/${encodeURIComponent(row.job_id)}/stream`,
      );
      batchStreamsRef.current.set(row.job_id, es);

      const onPayload = (raw: MessageEvent) => {
        try {
          const data = JSON.parse(String(raw.data)) as ProgressSnapshot;
          setBatchRows((prev) =>
            prev.map((r) =>
              r.job_id === row.job_id ? { ...r, progress: data } : r,
            ),
          );
          if (data.status === 'ready') {
            es.close();
            batchStreamsRef.current.delete(row.job_id);
            setTimeout(() => {
              setBatchRows((prev) =>
                prev.filter((r) => r.job_id !== row.job_id),
              );
              batchDoneRef.current += 1;
              setBatchDoneCount(batchDoneRef.current);
              maybeFinishBatch();
            }, SUCCESS_RESET_MS);
          } else if (data.status === 'failed') {
            es.close();
            batchStreamsRef.current.delete(row.job_id);
            batchFailedRef.current += 1;
            setBatchFailedCount(batchFailedRef.current);
            maybeFinishBatch();
          }
        } catch {
          /* ignore */
        }
      };

      for (const name of [
        'snapshot',
        'estimate',
        'progress',
        'window_done',
        'window_failed',
        'complete',
        'error',
      ]) {
        es.addEventListener(name, onPayload as EventListener);
      }
    },
    [maybeFinishBatch],
  );

  const validateSingleClient = (): boolean => {
    setClientError(null);
    if (mode === 'url') {
      const u = url.trim();
      if (!/^https?:\/\//i.test(u)) {
        setClientError(t.clientUrlRequired);
        return false;
      }
    } else if (mode === 'local') {
      if (!localPath.trim().startsWith('/')) {
        setClientError(t.clientLocalRequired);
        return false;
      }
    } else if (!file) {
      setClientError(t.clientUploadRequired);
      return false;
    }
    return true;
  };

  const validateBatchClient = (): boolean => {
    setClientError(null);
    if (batchSource === 'upload') {
      if (batchFiles.length === 0) {
        setClientError(t.clientBatchFilesRequired);
        return false;
      }
    } else if (!folderPath.trim().startsWith('/')) {
      setClientError(t.clientBatchFolderRequired);
      return false;
    }
    return true;
  };

  const resolveDisplayTitle = (): string => {
    if (title.trim()) return title.trim();
    if (mode === 'upload' && file?.name) return file.name;
    if (mode === 'url') {
      try {
        const path = new URL(url.trim()).pathname;
        const base = path.split('/').filter(Boolean).pop();
        if (base) return decodeURIComponent(base);
      } catch {
        /* ignore */
      }
    }
    if (mode === 'local') {
      const base = localPath.trim().split('/').filter(Boolean).pop();
      if (base) return base;
    }
    return '';
  };

  const startSingleImport = async () => {
    if (!validateSingleClient()) return;
    clearSuccessResetTimer();
    setSubmitting(true);
    setApiError(null);
    setProgress(null);
    setBatchFinishedBanner(false);
    displayTitleRef.current = resolveDisplayTitle();
    try {
      let res: Response;
      if (mode === 'upload') {
        const fd = new FormData();
        fd.append('file', file!);
        if (title.trim()) fd.append('title', title.trim());
        fd.append('auto_start', autoStart ? 'true' : 'false');
        fd.append('chunk_preset', chunkPreset);
        res = await fetch('/api/ingest/upload', {
          method: 'POST',
          headers: { 'Accept-Language': locale },
          body: fd,
        });
      } else {
        res = await fetch('/api/ingest', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept-Language': locale,
          },
          body: JSON.stringify({
            mode,
            source: mode === 'url' ? url.trim() : localPath.trim(),
            title: title.trim() || undefined,
            auto_start: autoStart,
            chunk_preset: chunkPreset,
          }),
        });
      }
      const data = (await res.json()) as ProgressSnapshot & {
        error?: { message: string };
        workload?: Workload;
      };
      if (!res.ok) {
        throw new Error(data.error?.message ?? t.ingestFailed);
      }
      setJobId(data.job_id);
      setProgress({
        job_id: data.job_id,
        video_id: data.video_id,
        status: data.status,
        stage: data.stage ?? 'accepted',
        progress_pct: 0,
        windows_total: data.workload?.windows ?? 0,
        windows_done: 0,
        windows_failed: 0,
        variant_id: data.variant_id,
        workload: data.workload,
      });
      attachStream(data.job_id);
    } catch (err) {
      setApiError(err instanceof Error ? err.message : t.ingestFailed);
    } finally {
      setSubmitting(false);
    }
  };

  const startBatchImport = async () => {
    if (!validateBatchClient()) return;
    closeBatchStreams();
    setSubmitting(true);
    setApiError(null);
    setBatchRows([]);
    setBatchErrors([]);
    setBatchDoneCount(0);
    setBatchFailedCount(0);
    batchDoneRef.current = 0;
    batchFailedRef.current = 0;
    setBatchFinishedBanner(false);
    setLastSuccessTitle(null);

    try {
      let res: Response;
      if (batchSource === 'upload') {
        const fd = new FormData();
        for (const f of batchFiles) {
          fd.append('files', f);
        }
        fd.append('auto_start', autoStart ? 'true' : 'false');
        fd.append('chunk_preset', chunkPreset);
        res = await fetch('/api/ingest/batch', {
          method: 'POST',
          headers: { 'Accept-Language': locale },
          body: fd,
        });
      } else {
        res = await fetch('/api/ingest/batch', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept-Language': locale,
          },
          body: JSON.stringify({
            mode: 'folder',
            path: folderPath.trim(),
            auto_start: autoStart,
            chunk_preset: chunkPreset,
          }),
        });
      }

      const data = (await res.json()) as {
        jobs?: Array<{
          job_id: string;
          video_id: string;
          title?: string;
          status: string;
          stage?: string;
          variant_id?: string;
          workload?: Workload;
        }>;
        errors?: BatchItemError[];
        error?: { message: string };
      };
      if (!res.ok) {
        throw new Error(data.error?.message ?? t.ingestFailed);
      }

      const jobs = data.jobs ?? [];
      setBatchErrors(data.errors ?? []);
      batchTotalRef.current = jobs.length;
      const rows: BatchJobRow[] = jobs.map((j) => ({
        job_id: j.job_id,
        video_id: j.video_id,
        title: j.title || j.video_id,
        progress: {
          job_id: j.job_id,
          video_id: j.video_id,
          status: j.status,
          stage: j.stage ?? 'accepted',
          progress_pct: 0,
          windows_total: j.workload?.windows ?? 0,
          windows_done: 0,
          windows_failed: 0,
          variant_id: j.variant_id,
          workload: j.workload,
        },
      }));
      setBatchRows(rows);
      for (const row of rows) {
        attachBatchStream(row);
      }
      if (jobs.length === 0) {
        setBatchFinishedBanner(true);
      }
    } catch (err) {
      setApiError(err instanceof Error ? err.message : t.ingestFailed);
    } finally {
      setSubmitting(false);
    }
  };

  const confirmJob = async () => {
    if (!jobId) return;
    setSubmitting(true);
    setApiError(null);
    try {
      const res = await fetch(
        `/api/jobs/${encodeURIComponent(jobId)}/confirm`,
        {
          method: 'POST',
          headers: { 'Accept-Language': locale },
        },
      );
      const data = (await res.json()) as {
        error?: { message: string };
        job_id?: string;
      };
      if (!res.ok) throw new Error(data.error?.message ?? t.ingestFailed);
      attachStream(jobId);
    } catch (err) {
      setApiError(err instanceof Error ? err.message : t.ingestFailed);
    } finally {
      setSubmitting(false);
    }
  };

  const scopeOptions = [
    { id: 'single', label: t.scopeSingle },
    { id: 'batch', label: t.scopeBatch },
  ];

  const modeOptions = [
    { id: 'url', label: t.modeUrl },
    { id: 'local', label: t.modeLocal },
    { id: 'upload', label: t.modeUpload },
  ];

  const batchSourceOptions = [
    { id: 'upload', label: t.batchModeUpload },
    { id: 'folder', label: t.batchModeFolder },
  ];

  const chunkPresetOptions = IMPORT_CHUNK_PRESET_NAMES.map((id) => {
    const labels: Record<ImportChunkPreset, string> = {
      standard: t.chunkPresetStandard,
      '60s': t.chunkPreset60s,
      '30s': t.chunkPreset30s,
      '20s': t.chunkPreset20s,
      fine: t.chunkPresetFine,
      '2s': t.chunkPreset2s,
    };
    return { value: id, text: labels[id] };
  });

  const awaiting =
    progress?.status === 'awaiting_confirm' ||
    progress?.stage === 'awaiting_confirm';

  const singleBusy =
    Boolean(progress) &&
    (progress!.status === 'processing' ||
      progress!.status === 'pending' ||
      progress!.status === 'ready' ||
      awaiting);

  const batchBusy = batchRows.length > 0;
  const formBusy = submitting || singleBusy || batchBusy;

  return (
    <AppShell
      pageTitle={t.ingestTitle}
      pageDescription={t.ingestDescription}
      restrictWidth="800px"
    >
      {lastSuccessTitle && !progress && scope === 'single' && (
        <>
          <EuiCallOut
            color="success"
            size="s"
            title={t.lastImportSuccess.replace('{title}', lastSuccessTitle)}
            onDismiss={() => setLastSuccessTitle(null)}
          />
          <EuiSpacer size="m" />
        </>
      )}

      {batchFinishedBanner && !batchBusy && (
        <>
          <EuiCallOut
            color="success"
            size="s"
            title={t.batchAllDone}
            onDismiss={() => setBatchFinishedBanner(false)}
          />
          <EuiSpacer size="m" />
        </>
      )}

      <EuiForm component="form" onSubmit={(e) => e.preventDefault()}>
        <EuiFormRow label={t.scopeLabel}>
          <EuiRadioGroup
            options={scopeOptions}
            idSelected={scope}
            onChange={(id) => {
              setScope(id as ImportScope);
              setClientError(null);
              setApiError(null);
            }}
            name="ingest-scope"
            disabled={formBusy}
          />
        </EuiFormRow>

        <EuiSpacer size="m" />

        {scope === 'single' && (
          <>
            <EuiFormRow label={t.modeLabel}>
              <EuiRadioGroup
                options={modeOptions}
                idSelected={mode}
                onChange={(id) => setMode(id as IngestMode)}
                name="ingest-mode"
                disabled={formBusy}
              />
            </EuiFormRow>

            <EuiSpacer size="m" />

            {mode === 'url' && (
              <EuiFormRow label={t.urlLabel} isInvalid={Boolean(clientError)}>
                <EuiFieldText
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder={t.urlPlaceholder}
                  disabled={formBusy}
                />
              </EuiFormRow>
            )}
            {mode === 'local' && (
              <EuiFormRow label={t.localLabel} isInvalid={Boolean(clientError)}>
                <EuiFieldText
                  value={localPath}
                  onChange={(e) => setLocalPath(e.target.value)}
                  placeholder={t.localPlaceholder}
                  disabled={formBusy}
                />
              </EuiFormRow>
            )}
            {mode === 'upload' && (
              <EuiFormRow
                label={t.uploadLabel}
                isInvalid={Boolean(clientError)}
              >
                <EuiFilePicker
                  key={filePickerKey}
                  id="ingest-upload"
                  initialPromptText={t.uploadLabel}
                  onChange={(files) => {
                    const list = files ? Array.from(files) : [];
                    setFile(list[0] ?? null);
                  }}
                  display="large"
                  accept="video/*,.mp4,.mov,.mkv,.webm,.avi"
                  disabled={formBusy}
                />
              </EuiFormRow>
            )}

            <EuiFormRow label={t.titleLabel}>
              <EuiFieldText
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t.titlePlaceholder}
                disabled={formBusy}
              />
            </EuiFormRow>
          </>
        )}

        {scope === 'batch' && (
          <>
            <EuiFormRow label={t.batchModeLabel}>
              <EuiRadioGroup
                options={batchSourceOptions}
                idSelected={batchSource}
                onChange={(id) => setBatchSource(id as BatchSource)}
                name="batch-source"
                disabled={formBusy}
              />
            </EuiFormRow>

            <EuiSpacer size="m" />

            {batchSource === 'upload' && (
              <EuiFormRow
                label={t.batchUploadLabel}
                isInvalid={Boolean(clientError)}
              >
                <EuiFilePicker
                  key={batchPickerKey}
                  id="ingest-batch-upload"
                  initialPromptText={t.batchUploadLabel}
                  multiple
                  onChange={(files) => {
                    setBatchFiles(files ? Array.from(files) : []);
                  }}
                  display="large"
                  accept="video/*,.mp4,.mov,.mkv,.webm,.avi"
                  disabled={formBusy}
                />
              </EuiFormRow>
            )}
            {batchSource === 'folder' && (
              <EuiFormRow
                label={t.batchFolderLabel}
                helpText={t.batchFolderHelp}
                isInvalid={Boolean(clientError)}
              >
                <EuiFieldText
                  value={folderPath}
                  onChange={(e) => setFolderPath(e.target.value)}
                  placeholder={t.batchFolderPlaceholder}
                  disabled={formBusy}
                />
              </EuiFormRow>
            )}
          </>
        )}

        <EuiFormRow
          label={t.chunkPresetSelectLabel}
          helpText={t.chunkPresetHelp}
        >
          <EuiSelect
            options={chunkPresetOptions}
            value={chunkPreset}
            onChange={(e) =>
              setChunkPreset(e.target.value as ImportChunkPreset)
            }
            disabled={formBusy}
            aria-label={t.chunkPresetSelectLabel}
          />
        </EuiFormRow>

        <EuiFormRow helpText={t.autoStartHelp}>
          <EuiCheckbox
            id="auto-start"
            label={t.autoStartLabel}
            checked={autoStart}
            onChange={(e) => setAutoStart(e.target.checked)}
            disabled={formBusy}
          />
        </EuiFormRow>

        {clientError && (
          <>
            <EuiCallOut color="warning" size="s" title={clientError} />
            <EuiSpacer size="s" />
          </>
        )}
        {apiError && (
          <>
            <EuiCallOut color="danger" size="s" title={apiError} />
            <EuiSpacer size="s" />
          </>
        )}

        <EuiButton
          fill
          onClick={() =>
            void (scope === 'batch' ? startBatchImport() : startSingleImport())
          }
          isLoading={submitting}
          disabled={formBusy}
        >
          {scope === 'batch' ? t.batchSubmit : t.submitImport}
        </EuiButton>
      </EuiForm>

      {scope === 'single' && progress && (
        <>
          <EuiSpacer size="xl" />
          <EuiPanel hasBorder paddingSize="m">
            <EuiTitle size="xs">
              <h2>{t.progressTitle}</h2>
            </EuiTitle>
            <EuiSpacer size="s" />

            {progress.workload && (
              <>
                <EuiTitle size="xxs">
                  <h3>{t.workloadTitle}</h3>
                </EuiTitle>
                <EuiText size="s">
                  <ul>
                    <li>
                      {t.windowsLabel}: {progress.workload.windows}
                    </li>
                    <li>
                      {t.inferenceCallsLabel}:{' '}
                      {progress.workload.inference_calls}
                    </li>
                    <li>
                      {t.hasAudioLabel}:{' '}
                      {progress.workload.has_audio ? t.yes : t.no}
                    </li>
                    <li>
                      {t.chunkPresetLabel}: {progress.workload.chunk_preset}
                    </li>
                  </ul>
                </EuiText>
                <EuiSpacer size="s" />
              </>
            )}

            {awaiting && (
              <>
                <EuiCallOut color="primary" size="s" title={t.confirmNeeded} />
                <EuiSpacer size="s" />
                <EuiFlexGroup gutterSize="s">
                  <EuiFlexItem grow={false}>
                    <EuiButton
                      fill
                      onClick={() => void confirmJob()}
                      isLoading={submitting}
                    >
                      {t.confirmWorkload}
                    </EuiButton>
                  </EuiFlexItem>
                  <EuiFlexItem grow={false}>
                    <EuiButton
                      onClick={() => {
                        closeStream();
                        clearSuccessResetTimer();
                        setProgress(null);
                        setJobId(null);
                      }}
                    >
                      {t.cancelConfirm}
                    </EuiButton>
                  </EuiFlexItem>
                </EuiFlexGroup>
                <EuiSpacer size="m" />
              </>
            )}

            <EuiText size="s">
              <p>
                {t.statusLabel}: <strong>{progress.status}</strong> ·{' '}
                {t.stageLabel}: {progress.stage}
              </p>
              <p>
                {t.windowsDoneLabel}: {progress.windows_done}/
                {progress.windows_total} · {t.windowsFailedLabel}:{' '}
                {progress.windows_failed}
              </p>
              {progress.message && <p>{progress.message}</p>}
              {progress.throughput_windows_per_min != null && (
                <p>
                  {t.throughputLabel}:{' '}
                  {progress.throughput_windows_per_min.toFixed(1)}
                </p>
              )}
              {progress.error && (
                <p style={{ color: '#BD271E' }}>
                  {progress.error.code}: {progress.error.message}
                </p>
              )}
            </EuiText>
            <EuiSpacer size="s" />
            <EuiProgress
              value={Math.min(100, Math.max(0, progress.progress_pct || 0))}
              max={100}
              size="m"
              color={
                progress.status === 'failed'
                  ? 'danger'
                  : progress.status === 'ready'
                    ? 'success'
                    : 'primary'
              }
            />
            {progress.status === 'ready' && (
              <>
                <EuiSpacer size="s" />
                <EuiCallOut color="success" size="s" title={t.ingestSuccess} />
              </>
            )}
            {progress.status === 'failed' && (
              <>
                <EuiSpacer size="s" />
                <EuiCallOut color="danger" size="s" title={t.ingestFailed} />
                <EuiSpacer size="s" />
                <EuiButton
                  onClick={() => {
                    closeStream();
                    clearSuccessResetTimer();
                    setProgress(null);
                    setJobId(null);
                    setApiError(null);
                  }}
                >
                  {t.cancelConfirm}
                </EuiButton>
              </>
            )}
          </EuiPanel>
        </>
      )}

      {scope === 'batch' && (batchRows.length > 0 || batchErrors.length > 0) && (
        <>
          <EuiSpacer size="xl" />
          <EuiPanel hasBorder paddingSize="m">
            <EuiTitle size="xs">
              <h2>{t.batchProgressTitle}</h2>
            </EuiTitle>
            <EuiSpacer size="s" />
            <EuiText size="s">
              <p>
                {t.batchJobsLabel}: {batchRows.length} · {t.batchDoneLabel}:{' '}
                {batchDoneCount} · {t.batchFailedLabel}: {batchFailedCount} ·{' '}
                {t.chunkPresetLabel}: {chunkPreset}
              </p>
            </EuiText>

            {batchErrors.length > 0 && (
              <>
                <EuiSpacer size="s" />
                <EuiCallOut
                  color="warning"
                  size="s"
                  title={t.batchPartialErrors}
                >
                  <ul>
                    {batchErrors.map((e) => (
                      <li key={`${e.source}-${e.code}`}>
                        {e.source}: {e.message}
                      </li>
                    ))}
                  </ul>
                </EuiCallOut>
              </>
            )}

            <EuiSpacer size="m" />
            <EuiFlexGroup direction="column" gutterSize="m">
              {batchRows.map((row) => (
                <EuiFlexItem key={row.job_id} grow={false}>
                  <EuiPanel color="subdued" paddingSize="s" hasBorder>
                    <EuiFlexGroup
                      alignItems="center"
                      justifyContent="spaceBetween"
                      gutterSize="s"
                    >
                      <EuiFlexItem>
                        <EuiText size="s">
                          <strong>{row.title}</strong>
                        </EuiText>
                        <EuiText size="xs" color="subdued">
                          {t.statusLabel}: {row.progress.status} ·{' '}
                          {t.stageLabel}: {row.progress.stage} ·{' '}
                          {row.progress.windows_done}/
                          {row.progress.windows_total}
                        </EuiText>
                      </EuiFlexItem>
                      <EuiFlexItem grow={false}>
                        <EuiBadge
                          color={
                            row.progress.status === 'failed'
                              ? 'danger'
                              : row.progress.status === 'ready'
                                ? 'success'
                                : 'primary'
                          }
                        >
                          {row.progress.status}
                        </EuiBadge>
                      </EuiFlexItem>
                    </EuiFlexGroup>
                    <EuiSpacer size="xs" />
                    <EuiProgress
                      value={Math.min(
                        100,
                        Math.max(0, row.progress.progress_pct || 0),
                      )}
                      max={100}
                      size="s"
                      color={
                        row.progress.status === 'failed'
                          ? 'danger'
                          : row.progress.status === 'ready'
                            ? 'success'
                            : 'primary'
                      }
                    />
                    {row.progress.error && (
                      <EuiText size="xs" color="danger">
                        <p>
                          {row.progress.error.code}:{' '}
                          {row.progress.error.message}
                        </p>
                      </EuiText>
                    )}
                  </EuiPanel>
                </EuiFlexItem>
              ))}
            </EuiFlexGroup>
          </EuiPanel>
        </>
      )}
    </AppShell>
  );
}
