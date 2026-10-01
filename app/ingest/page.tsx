'use client';

import {
  EuiBadge,
  EuiButton,
  EuiCallOut,
  EuiCheckbox,
  EuiComboBox,
  type EuiComboBoxOptionOption,
  EuiFieldNumber,
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
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import {
  IMPORT_CHUNK_PRESET_NAMES,
  formatChunkPresetLabel,
  resolveCustomChunkingDraft,
  type ImportChunkPreset,
} from '@/lib/ingest/chunk-presets';
import { titleFromFilename } from '@/lib/ingest/media-name';
import { useLocale } from '@/lib/i18n/locale-context';

const CreatableGroupCombo = dynamic(
  () =>
    import('@/components/CreatableGroupCombo').then(
      (m) => m.CreatableGroupCombo,
    ),
  {
    ssr: false,
    loading: () => <EuiFieldText disabled />,
  },
);

type ImportScope = 'single' | 'batch';
type IngestMode = 'url' | 'local' | 'upload';
type BatchSource = 'upload' | 'folder';

/** `custom` is not a named preset — it switches on the free-form inputs. */
type ChunkPresetChoice = ImportChunkPreset | 'custom';

/** Defaults pre-filled when the operator picks the custom option. */
const DEFAULT_CUSTOM_WINDOW_S = '20';
const DEFAULT_CUSTOM_OVERLAP_S = '3';

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
  /** Follow-on drama enrichment (R9): base `ready` is not the end. */
  drama?: {
    status: string;
    modules_done?: string[];
    error?: { code: string; message: string };
  } | null;
};

/** Drama follow-on still running — the SSE stream must stay open (R9). */
function isDramaActive(snapshot: ProgressSnapshot): boolean {
  const s = snapshot.drama?.status;
  return s === 'pending' || s === 'running';
}

/** I3: green success only for clean outcomes — never for partial/failed. */
function isDramaSuccess(snapshot: ProgressSnapshot): boolean {
  const s = snapshot.drama?.status;
  return s === undefined || s === null || s === 'succeeded' || s === 'skipped';
}

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
  job_id?: string;
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
  const [selectedGroup, setSelectedGroup] = useState<EuiComboBoxOptionOption[]>(
    [],
  );
  const [groupOptions, setGroupOptions] = useState<EuiComboBoxOptionOption[]>(
    [],
  );
  const [chunkPreset, setChunkPreset] =
    useState<ChunkPresetChoice>('2s');
  const [customWindowS, setCustomWindowS] = useState(DEFAULT_CUSTOM_WINDOW_S);
  const [customOverlapS, setCustomOverlapS] = useState(DEFAULT_CUSTOM_OVERLAP_S);
  const [autoStart, setAutoStart] = useState(true);
  const [dramaEnabled, setDramaEnabled] = useState(false);
  const [dramaLanguages, setDramaLanguages] = useState<
    EuiComboBoxOptionOption[]
  >([]);
  const [dramaSourceLanguage, setDramaSourceLanguage] = useState<'en' | 'zh' | ''>('');
  const [dramaModules, setDramaModules] = useState<EuiComboBoxOptionOption[]>(
    [],
  );
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
  // I3: once any batch item fails (base or drama), results stay until an
  // explicit reset — the finished banner must not auto-clear them.
  const batchRetainRef = useRef(false);
  const [batchRetainResults, setBatchRetainResults] = useState(false);

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
    setSelectedGroup([]);
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
    setSelectedGroup([]);
    setBatchRows([]);
    setBatchErrors([]);
    setBatchDoneCount(0);
    setBatchFailedCount(0);
    batchDoneRef.current = 0;
    batchFailedRef.current = 0;
    batchTotalRef.current = 0;
    batchRetainRef.current = false;
    setBatchRetainResults(false);
    setClientError(null);
    setApiError(null);
    setSubmitting(false);
  }, [closeBatchStreams]);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/metadata/catalogs?locale=${locale}`);
        const data = (await res.json()) as {
          groups?: Array<{ id: string; label: string }>;
        };
        if (res.ok && data.groups?.length) {
          setGroupOptions(
            data.groups.map((g) => ({ label: g.label, value: g.id })),
          );
        }
      } catch {
        /* keep empty — operator can still type a new name */
      }
    })();
  }, [locale]);

  const dramaAllowed =
    scope === 'batch' || mode === 'upload' || mode === 'local';

  const dramaLanguageOptions: EuiComboBoxOptionOption[] = [
    { label: 'zh', value: 'zh' },
    { label: 'en', value: 'en' },
    { label: 'ko', value: 'ko' },
    { label: 'th', value: 'th' },
  ];

  const dramaModuleOptions: EuiComboBoxOptionOption[] = [
    { label: t.dramaModuleSubtitles, value: 'subtitles' },
    { label: t.dramaModuleStructure, value: 'structure' },
    { label: t.dramaModuleDirectors, value: 'directors_script' },
    { label: t.dramaModuleKeyActors, value: 'key_actors' },
    { label: t.dramaModuleKeyScenes, value: 'key_scenes' },
  ];
  const bilingualDrama = dramaModules.some((o) => o.value === 'subtitles') &&
    dramaLanguages.some((o) => o.value === 'en') &&
    dramaLanguages.some((o) => o.value === 'zh');

  const appendDramaToFormData = (fd: FormData) => {
    if (!dramaEnabled || !dramaAllowed) return;
    fd.append('drama_enabled', 'true');
    fd.append(
      'drama_languages',
      JSON.stringify(dramaLanguages.map((o) => String(o.value ?? o.label))),
    );
    fd.append(
      'drama_modules',
      JSON.stringify(dramaModules.map((o) => String(o.value ?? o.label))),
    );
    if (bilingualDrama && dramaSourceLanguage) fd.append('drama_source_language', dramaSourceLanguage);
  };

  /** Append `chunk_preset` or the custom `window_ms`/`overlap_ms` pair. */
  const appendChunkingToFormData = (
    fd: FormData,
    fields: NonNullable<ReturnType<typeof chunkingRequestFields>>,
  ) => {
    if (fields.chunk_preset !== undefined) {
      fd.append('chunk_preset', fields.chunk_preset);
    }
    if (fields.window_ms !== undefined) {
      fd.append('window_ms', String(fields.window_ms));
    }
    if (fields.overlap_ms !== undefined) {
      fd.append('overlap_ms', String(fields.overlap_ms));
    }
  };

  const dramaJsonPayload = () => {
    if (!dramaEnabled || !dramaAllowed) return undefined;
    return {
      enabled: true as const,
      languages: dramaLanguages.map((o) => String(o.value ?? o.label)),
      modules: dramaModules.map((o) => String(o.value ?? o.label)),
      ...(bilingualDrama && dramaSourceLanguage ? { source_language: dramaSourceLanguage } : {}),
    };
  };

  const groupId =
    selectedGroup[0] != null
      ? String(selectedGroup[0].value ?? selectedGroup[0].label).trim()
      : '';

  const onCreateGroup = useCallback(
    (searchValue: string) => {
      const normalized = searchValue.trim().replace(/\s+/g, ' ');
      if (!normalized || normalized.length > 64) return false;
      const opt: EuiComboBoxOptionOption = {
        label: normalized,
        value: normalized,
      };
      setGroupOptions((prev) =>
        prev.some((o) => String(o.value ?? o.label) === normalized)
          ? prev
          : [...prev, opt],
      );
      setSelectedGroup([opt]);
      return true;
    },
    [],
  );

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
            // R9: base `ready` fires before the drama follow-on starts.
            // Keep listening while drama is pending/running; the server
            // keeps emitting drama progress on the same stream.
            if (isDramaActive(data)) return;
            closeStream();
            // F4: a partial/failed enrichment is NOT a success — keep the
            // terminal outcome and the retry action visible instead of
            // auto-resetting the form.
            const dramaOutcome = data.drama?.status;
            if (dramaOutcome === 'partial' || dramaOutcome === 'failed') {
              return;
            }
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
      // I3: auto-clear only a fully clean batch. Any failure (base or
      // drama) or skipped-file errors retain rows + errors until the
      // operator explicitly clears or retries.
      if (!batchRetainRef.current && batchFailedRef.current === 0) {
        setTimeout(() => {
          resetBatchForm();
        }, SUCCESS_RESET_MS);
      }
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
            // R9: keep batch rows until drama reaches a terminal state.
            if (isDramaActive(data)) return;
            es.close();
            batchStreamsRef.current.delete(row.job_id);
            // F4: partial/failed enrichment is not a batch success — keep
            // the row with its outcome + retry, record a visible error,
            // and count it as failed.
            const dramaOutcome = data.drama?.status;
            if (dramaOutcome === 'partial' || dramaOutcome === 'failed') {
              batchFailedRef.current += 1;
              setBatchFailedCount(batchFailedRef.current);
              // I3: retain partial/failed rows until explicit reset or retry.
              batchRetainRef.current = true;
              setBatchRetainResults(true);
              const detail =
                data.drama?.error?.message ??
                `drama ${dramaOutcome}: ${(data.drama?.modules_done ?? []).join(', ')}`;
              setBatchErrors((prev) => [
                ...prev.filter((e) => e.job_id !== row.job_id),
                {
                  source: row.title,
                  job_id: row.job_id,
                  code: data.drama?.error?.code ?? 'DRAMA_ENRICHMENT_PARTIAL',
                  message: detail,
                },
              ]);
              maybeFinishBatch();
              return;
            }
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
            // I3: retain failed rows until explicit reset or retry.
            batchRetainRef.current = true;
            setBatchRetainResults(true);
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

  const validateDramaClient = (): boolean => {
    if (!dramaEnabled || !dramaAllowed) return true;
    if (dramaModules.length === 0) {
      setClientError(t.dramaClientNeedModules);
      return false;
    }
    const mods = dramaModules.map((o) => String(o.value ?? o.label));
    if (mods.includes('subtitles') && dramaLanguages.length === 0) {
      setClientError(t.dramaClientNeedLanguages);
      return false;
    }
    if (bilingualDrama && !dramaSourceLanguage) {
      setClientError(t.dramaSpokenLanguageRequired);
      return false;
    }
    return true;
  };

  /**
   * Chunking fields for the request body. `custom` sends `window_ms` +
   * `overlap_ms` (the server also accepts an optional `min_ms`, deliberately
   * not exposed here); named presets keep sending only `chunk_preset`, so
   * their behavior is unchanged. Returns null when the custom inputs are
   * invalid — the caller surfaces `chunkPresetCustomInvalid` and blocks.
   */
  const chunkingRequestFields = ():
    | { chunk_preset?: ImportChunkPreset; window_ms?: number; overlap_ms?: number }
    | null => {
    if (chunkPreset !== 'custom') return { chunk_preset: chunkPreset };
    const draft = resolveCustomChunkingDraft(customWindowS, customOverlapS);
    if (!draft) return null;
    return { window_ms: draft.windowMs, overlap_ms: draft.overlapMs };
  };

  /** Validate the chunking selection; sets the message and returns false on error. */
  const validateChunkingClient = (): boolean => {
    if (chunkingRequestFields() === null) {
      setClientError(t.chunkPresetCustomInvalid);
      return false;
    }
    return true;
  };

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
    return validateDramaClient() && validateChunkingClient();
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
    return validateDramaClient() && validateChunkingClient();
  };

  // Mirrors the server-side fallback (lib/ingest/media-name.resolveIngestTitle)
  // so the progress panel shows the same display name the asset will be created
  // with — including for uploads that deliberately omit a title field.
  const resolveDisplayTitle = (): string => {
    if (title.trim()) return title.trim();
    if (mode === 'upload' && file?.name) {
      return titleFromFilename(file.name) || file.name;
    }
    if (mode === 'url') {
      try {
        const path = new URL(url.trim()).pathname;
        const base = path.split('/').filter(Boolean).pop();
        if (base) {
          return titleFromFilename(decodeURIComponent(base)) || base;
        }
      } catch {
        /* ignore */
      }
    }
    if (mode === 'local') {
      const base = localPath.trim().split('/').filter(Boolean).pop();
      if (base) return titleFromFilename(base) || base;
    }
    return '';
  };

  const startSingleImport = async () => {
    if (!validateSingleClient()) return;
    const chunkFields = chunkingRequestFields();
    if (!chunkFields) return;
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
        appendChunkingToFormData(fd, chunkFields);
        if (groupId) fd.append('group_id', groupId);
        appendDramaToFormData(fd);
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
            ...chunkFields,
            group_id: groupId || undefined,
            drama: dramaJsonPayload(),
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
    const chunkFields = chunkingRequestFields();
    if (!chunkFields) return;
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
        appendChunkingToFormData(fd, chunkFields);
        if (groupId) fd.append('group_id', groupId);
        appendDramaToFormData(fd);
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
            ...chunkFields,
            group_id: groupId || undefined,
            drama: dramaJsonPayload(),
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
      if ((data.errors ?? []).length > 0) {
        // I3: skipped-file errors are retained like other failures.
        batchRetainRef.current = true;
        setBatchRetainResults(true);
      }
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

  // F4: retry a terminal partial/failed drama enrichment and reattach the
  // stream so the new run's progress is visible. A 409 means another run
  // is active — its message is shown, nothing is restarted.
  const retryDrama = async () => {
    if (!jobId) return;
    setSubmitting(true);
    setApiError(null);
    try {
      const res = await fetch(
        `/api/jobs/${encodeURIComponent(jobId)}/retry`,
        {
          method: 'POST',
          headers: { 'Accept-Language': locale },
        },
      );
      const data = (await res.json()) as {
        error?: { message: string };
      };
      if (!res.ok) throw new Error(data.error?.message ?? t.ingestFailed);
      attachStream(jobId);
    } catch (err) {
      setApiError(err instanceof Error ? err.message : t.ingestFailed);
    } finally {
      setSubmitting(false);
    }
  };

  const retryBatchRow = async (row: BatchJobRow) => {
    try {
      const res = await fetch(
        `/api/jobs/${encodeURIComponent(row.job_id)}/retry`,
        {
          method: 'POST',
          headers: { 'Accept-Language': locale },
        },
      );
      const data = (await res.json()) as {
        error?: { message: string };
      };
      if (!res.ok) throw new Error(data.error?.message ?? t.ingestFailed);
      // Un-count the earlier failure; the reattached stream recounts the
      // new terminal outcome, and the stale error entry is dropped.
      batchFailedRef.current = Math.max(0, batchFailedRef.current - 1);
      setBatchFailedCount(batchFailedRef.current);
      setBatchErrors((prev) => prev.filter((e) => e.job_id !== row.job_id));
      attachBatchStream(row);
    } catch (err) {
      setBatchErrors((prev) => [
        ...prev.filter((e) => e.job_id !== row.job_id),
        {
          source: row.title,
          job_id: row.job_id,
          code: 'DRAMA_RETRY_FAILED',
          message: err instanceof Error ? err.message : t.ingestFailed,
        },
      ]);
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
      '20s_3s': t.chunkPreset20s3s,
      fine: t.chunkPresetFine,
      '5s': t.chunkPreset5s,
      '2s': t.chunkPreset2s,
    };
    return { value: id, text: labels[id] };
  });
  // Free-form option appended after the named presets; it is not part of
  // IMPORT_CHUNK_PRESET_NAMES because it maps to window_ms/overlap_ms.
  const chunkPresetSelectOptions = [
    ...chunkPresetOptions,
    { value: 'custom', text: t.chunkPresetCustom },
  ];
  const customChunkingInvalid =
    chunkPreset === 'custom' &&
    resolveCustomChunkingDraft(customWindowS, customOverlapS) === null;

  /**
   * Human label for the chunking actually submitted. The server echoes only
   * `chunk_preset` (`custom` for free-form), so the window/overlap pair is
   * labeled client-side to keep the progress/回显 readable.
   */
  const chunkingLabel = (
    fields: NonNullable<ReturnType<typeof chunkingRequestFields>>,
  ): string =>
    fields.chunk_preset !== undefined
      ? formatChunkPresetLabel(fields.chunk_preset)
      : formatChunkPresetLabel('custom', fields.window_ms, fields.overlap_ms);

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
            color={batchRetainResults ? 'warning' : 'success'}
            size="s"
            title={
              batchRetainResults
                ? t.batchFinishedWithErrors
                : t.batchAllDone
            }
            onDismiss={() => setBatchFinishedBanner(false)}
          />
          {batchRetainResults && (
            <>
              <EuiSpacer size="s" />
              <EuiButton size="s" onClick={() => resetBatchForm()}>
                {t.batchClearResultsLabel}
              </EuiButton>
            </>
          )}
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
          label={t.groupLabel}
          helpText={t.groupHelp}
        >
          <CreatableGroupCombo
            placeholder={t.groupLabel}
            options={groupOptions}
            selectedOptions={selectedGroup}
            onChange={setSelectedGroup}
            onCreateOption={onCreateGroup}
            isDisabled={formBusy}
            aria-label={t.groupLabel}
          />
        </EuiFormRow>

        {dramaAllowed ? (
          <>
            <EuiFormRow helpText={t.dramaEnableHelp}>
              <EuiCheckbox
                id="drama-enable"
                label={t.dramaEnableLabel}
                checked={dramaEnabled}
                onChange={(e) => setDramaEnabled(e.target.checked)}
                disabled={formBusy}
              />
            </EuiFormRow>
            {dramaEnabled && (
              <>
                <EuiFormRow
                  label={t.dramaLanguagesLabel}
                  helpText={t.dramaLanguagesHelp}
                >
                  <EuiComboBox
                    options={dramaLanguageOptions}
                    selectedOptions={dramaLanguages}
                    onChange={setDramaLanguages}
                    isDisabled={formBusy}
                    aria-label={t.dramaLanguagesLabel}
                  />
                </EuiFormRow>
                <EuiFormRow
                  label={t.dramaModulesLabel}
                  helpText={t.dramaModulesHelp}
                >
                  <EuiComboBox
                    options={dramaModuleOptions}
                    selectedOptions={dramaModules}
                    onChange={setDramaModules}
                    isDisabled={formBusy}
                    aria-label={t.dramaModulesLabel}
                  />
                </EuiFormRow>
                {bilingualDrama && (
                  <EuiFormRow label={t.dramaSpokenLanguage} helpText={t.dramaSpokenLanguageHelp}>
                    <EuiSelect
                      options={[{ value: '', text: '—' }, { value: 'en', text: 'English' }, { value: 'zh', text: '中文' }]}
                      value={dramaSourceLanguage}
                      onChange={(event) => setDramaSourceLanguage(event.target.value as 'en' | 'zh' | '')}
                      disabled={formBusy}
                      aria-label={t.dramaSpokenLanguage}
                    />
                  </EuiFormRow>
                )}
              </>
            )}
          </>
        ) : (
          <EuiFormRow>
            <EuiText size="s" color="subdued">
              <p>{t.dramaUrlHint}</p>
            </EuiText>
          </EuiFormRow>
        )}

        <EuiFormRow
          label={t.chunkPresetSelectLabel}
          helpText={t.chunkPresetHelp}
        >
          <EuiSelect
            options={chunkPresetSelectOptions}
            value={chunkPreset}
            onChange={(e) =>
              setChunkPreset(e.target.value as ChunkPresetChoice)
            }
            disabled={formBusy}
            aria-label={t.chunkPresetSelectLabel}
          />
        </EuiFormRow>

        {chunkPreset === 'custom' && (
          <>
            <EuiFormRow
              label={t.chunkPresetCustomWindowLabel}
              helpText={t.chunkPresetCustomHelp}
              isInvalid={customChunkingInvalid}
              error={customChunkingInvalid ? t.chunkPresetCustomInvalid : undefined}
            >
              <EuiFieldNumber
                value={customWindowS}
                onChange={(e) => setCustomWindowS(e.target.value)}
                min={1}
                step={1}
                disabled={formBusy}
                isInvalid={customChunkingInvalid}
                aria-label={t.chunkPresetCustomWindowLabel}
              />
            </EuiFormRow>
            <EuiFormRow
              label={t.chunkPresetCustomOverlapLabel}
              isInvalid={customChunkingInvalid}
            >
              <EuiFieldNumber
                value={customOverlapS}
                onChange={(e) => setCustomOverlapS(e.target.value)}
                min={0}
                step={1}
                disabled={formBusy}
                isInvalid={customChunkingInvalid}
                aria-label={t.chunkPresetCustomOverlapLabel}
              />
            </EuiFormRow>
          </>
        )}

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
              {progress.drama && (
                <p>
                  {t.dramaStatusLabel}: <strong>{progress.drama.status}</strong>
                  {progress.drama.modules_done &&
                    progress.drama.modules_done.length > 0 &&
                    ` · ${progress.drama.modules_done.join(', ')}`}
                </p>
              )}
              {progress.drama?.error && (
                <p style={{ color: '#BD271E' }}>
                  {progress.drama.error.code}: {progress.drama.error.message}
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
            {progress.status === 'ready' &&
              !isDramaActive(progress) &&
              isDramaSuccess(progress) && (
                <>
                  <EuiSpacer size="s" />
                  <EuiCallOut color="success" size="s" title={t.ingestSuccess} />
                </>
              )}
            {progress.status === 'ready' &&
              (progress.drama?.status === 'partial' ||
                progress.drama?.status === 'failed') && (
                <>
                  <EuiSpacer size="s" />
                  <EuiCallOut
                    color={
                      progress.drama?.status === 'partial' ? 'warning' : 'danger'
                    }
                    size="s"
                    title={
                      progress.drama?.status === 'partial'
                        ? t.dramaPartialNote
                        : t.dramaFailedNote
                    }
                  />
                  <EuiSpacer size="s" />
                  <EuiButton
                    onClick={() => void retryDrama()}
                    isLoading={submitting}
                  >
                    {t.dramaRetryLabel}
                  </EuiButton>
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
                {t.chunkPresetLabel}: {chunkingLabel(chunkingRequestFields() ?? {})}
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
                          {row.progress.drama && (
                            <>
                              {' '}· {t.dramaStatusLabel}:{' '}
                              {row.progress.drama.status}
                            </>
                          )}
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
                    {row.progress.drama?.error && (
                      <EuiText size="xs" color="danger">
                        <p>
                          {row.progress.drama.error.code}:{' '}
                          {row.progress.drama.error.message}
                        </p>
                      </EuiText>
                    )}
                    {(row.progress.drama?.status === 'partial' ||
                      row.progress.drama?.status === 'failed') && (
                      <>
                        <EuiSpacer size="xs" />
                        <EuiButton
                          size="s"
                          onClick={() => void retryBatchRow(row)}
                        >
                          {t.dramaRetryLabel}
                        </EuiButton>
                      </>
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
