'use client';

import {
  EuiButton,
  EuiAccordion,
  EuiBadge,
  EuiButtonEmpty,
  EuiButtonIcon,
  EuiComboBox,
  EuiConfirmModal,
  type EuiComboBoxOptionOption,
  EuiFieldNumber,
  EuiFieldText,
  EuiFlexGroup,
  EuiFlexItem,
  EuiFlyout,
  EuiFlyoutBody,
  EuiFlyoutFooter,
  EuiFlyoutHeader,
  EuiForm,
  EuiFormRow,
  EuiPanel,
  EuiSelect,
  EuiSpacer,
  EuiText,
  EuiTextArea,
  EuiTitle,
  EuiCallOut,
} from '@elastic/eui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocale } from '@/lib/i18n/locale-context';

type MetaReviewEntry = {
  source?: 'manual' | 'suggestion';
  confirmed?: boolean;
  confidence?: number;
  evidence?: string;
  provider?: 'local_title' | 'media_tag' | 'caller_hint' | 'external_web';
  source_url?: string;
  retrieved_at?: string;
  request_id?: string;
};

type MetaDto = {
  video_id: string;
  title: string;
  meta_revision: number;
  meta: {
    description?: string;
    abstract?: string;
    year?: number;
    actors?: string[];
    actor_ids?: string[];
    video_type?: string;
    primary_language?: string;
    country?: string;
    tags?: string[];
    work_title?: {
      en: string;
      zh?: string;
      native?: { lang: string; name: string };
    };
    reference_urls?: string[];
    review?: {
      description?: MetaReviewEntry;
      abstract?: MetaReviewEntry;
      year?: MetaReviewEntry;
      actors?: MetaReviewEntry;
      video_type?: MetaReviewEntry;
      primary_language?: MetaReviewEntry;
      country?: MetaReviewEntry;
      tags?: MetaReviewEntry;
      work_title?: MetaReviewEntry;
      reference_urls?: MetaReviewEntry;
    };
  };
};

type Catalogs = {
  video_types: string[];
  primary_languages: string[];
  countries: Array<{ code: string; label: string }>;
  people: Array<{ id: string; display: string; aliases: string[] }>;
};

type SuggestField = {
  value: string | number | string[];
  confidence: number;
  source: string;
  evidence: string;
  source_url?: string;
  retrieved_at?: string;
  request_id?: string;
};

type SuggestActorCandidate = {
  names: {
    en: string;
    zh: string | null;
    native: { lang: string; name: string } | null;
  };
  character: string | null;
  url: string;
  evidence: string;
  retrieved_at: string;
  request_id?: string;
  matched_person_id: string | null;
};

type SuggestToolTraceEntry = {
  tool_id: string;
  query?: string;
  question?: string;
  url?: string;
};

type SuggestResult = {
  request_id: string;
  meta_revision: number;
  retrieved_at: string;
  status?: 'ok' | 'empty';
  suggestions?: {
    year?: SuggestField;
    video_type?: SuggestField;
    primary_language?: SuggestField;
    country?: SuggestField;
    description?: SuggestField;
    abstract?: SuggestField;
    tags?: SuggestField;
    reference_urls?: SuggestField;
  };
  web?: {
    status?: 'ok' | 'ambiguous' | 'empty' | 'unavailable' | 'skipped';
    reason?: string;
    candidates?: Array<{
      provider: 'jina' | 'agent_builder';
      title: string;
      url: string;
      snippet: string;
      allowlisted: boolean;
    }>;
    actor_candidates?: SuggestActorCandidate[];
    actor_candidates_dropped?: number;
    tool_trace?: SuggestToolTraceEntry[];
  } | null;
};

type SuggestJobResponse = {
  request_id?: string;
  meta_revision?: number;
  status?: 'pending' | 'complete' | 'failed' | 'cancelled';
  stage?:
    | 'queued'
    | 'preparing'
    | 'researching'
    | 'validating'
    | 'complete'
    | 'failed'
    | 'cancelled';
  result?: SuggestResult;
  error?: { message?: string };
};

type SuggestedSources = {
  year?: 'suggestion';
  actors?: 'suggestion';
  video_type?: 'suggestion';
  primary_language?: 'suggestion';
  country?: 'suggestion';
  description?: 'suggestion';
  abstract?: 'suggestion';
  tags?: 'suggestion';
  work_title?: 'suggestion';
  reference_urls?: 'suggestion';
};

type FieldProvenance = {
  year?: MetaReviewEntry;
  actors?: MetaReviewEntry;
  video_type?: MetaReviewEntry;
  primary_language?: MetaReviewEntry;
  country?: MetaReviewEntry;
  description?: MetaReviewEntry;
  abstract?: MetaReviewEntry;
  tags?: MetaReviewEntry;
  work_title?: MetaReviewEntry;
  reference_urls?: MetaReviewEntry;
};

type ScalarSuggestKey =
  | 'year'
  | 'video_type'
  | 'primary_language'
  | 'country'
  | 'description'
  | 'abstract'
  | 'tags'
  | 'work_title'
  | 'reference_urls';

/**
 * Suggestions that were NOT auto-applied because the field already had
 * content. Kept so the UI can show them below the field with a "+" apply
 * button instead of silently discarding them (plan/06).
 */
type PendingSuggestions = Partial<Record<ScalarSuggestKey, SuggestField>>;

type Props = {
  videoId: string;
  onClose: () => void;
  onSaved: () => void;
};

function sameTags(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

function waitForPoll(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = () => {
      signal.removeEventListener('abort', abort);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    if (signal.aborted) return abort();
    signal.addEventListener('abort', abort, { once: true });
  });
}

export function EditMetadataFlyout({ videoId, onClose, onSaved }: Props) {
  const { t, locale } = useLocale();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestStage, setSuggestStage] = useState<SuggestJobResponse['stage']>();
  // Elapsed-time readout while Suggest runs — the stage label ("Agent is
  // searching...") is otherwise the operator's only signal, and with no
  // further stage transitions for a while there's no way to tell "still
  // working" from "stuck". Ticks every second; independent of the actual
  // job status so it doesn't need a job-status poll to update.
  const [suggestElapsedMs, setSuggestElapsedMs] = useState(0);
  const suggestStartRef = useRef<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  // Bug fix (todo/30 S1): web.status/reason existed on the response but was
  // never read — a provider outage, timeout or malformed model output was
  // shown to the operator identically to a real (if empty) suggestion.
  const [webWarning, setWebWarning] = useState<string | null>(null);
  const [conflict, setConflict] = useState<number | null>(null);
  const [dto, setDto] = useState<MetaDto | null>(null);
  const [catalogs, setCatalogs] = useState<Catalogs | null>(null);

  const [description, setDescription] = useState('');
  const [abstract, setAbstract] = useState('');
  const [year, setYear] = useState<string>('');
  const [videoType, setVideoType] = useState('');
  const [language, setLanguage] = useState('');
  const [country, setCountry] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [selectedReferenceUrls, setSelectedReferenceUrls] = useState<
    EuiComboBoxOptionOption[]
  >([]);
  const [workTitleEn, setWorkTitleEn] = useState('');
  const [workTitleZh, setWorkTitleZh] = useState('');
  const [workTitleNativeLang, setWorkTitleNativeLang] = useState('');
  const [workTitleNativeName, setWorkTitleNativeName] = useState('');
  const [selectedActors, setSelectedActors] = useState<
    EuiComboBoxOptionOption[]
  >([]);
  const [actorOptions, setActorOptions] = useState<EuiComboBoxOptionOption[]>(
    [],
  );
  const [actorCandidates, setActorCandidates] = useState<SuggestActorCandidate[]>([]);
  // Pending text in each selected actor's "add a known name" input, keyed by
  // catalog person id. Local-only until the operator submits it.
  const [knownAsDraft, setKnownAsDraft] = useState<Record<string, string>>({});
  const [toolTrace, setToolTrace] = useState<SuggestToolTraceEntry[]>([]);
  // todo/32 R1: agent-found cast withheld because its source wasn't on the
  // name allowlist. Rendered as an explicit notice — an empty candidate
  // list must not be ambiguous between "none found" and "found, withheld".
  const [actorCandidatesDropped, setActorCandidatesDropped] = useState(0);
  // todo/32 R2: removing a known name rewrites the shared person catalog
  // and takes effect for every video's search immediately, with no undo —
  // so the destructive direction is confirmed. Adding stays frictionless.
  const [knownAsRemoveTarget, setKnownAsRemoveTarget] = useState<
    { personId: string; personLabel: string; name: string } | null
  >(null);
  const [fieldSources, setFieldSources] = useState<SuggestedSources>({});
  const [fieldProvenance, setFieldProvenance] = useState<FieldProvenance>({});
  const [pendingSuggestions, setPendingSuggestions] = useState<PendingSuggestions>({});
  const suggestSeq = useRef(0);
  const suggestAbort = useRef<AbortController | null>(null);
  const suggestRequestId = useRef<string | null>(null);
  const formRef = useRef({
    description: '',
    abstract: '',
    year: '',
    videoType: '',
    language: '',
    country: '',
    tagsText: '',
    workTitleEn: '',
    referenceUrls: [] as string[],
  });

  useEffect(() => {
    formRef.current = {
      description,
      abstract,
      year,
      videoType,
      language,
      country,
      tagsText,
      workTitleEn,
      referenceUrls: selectedReferenceUrls.map((o) => String(o.value ?? o.label)),
    };
  }, [
    description,
    abstract,
    year,
    videoType,
    language,
    country,
    tagsText,
    workTitleEn,
    selectedReferenceUrls,
  ]);

  useEffect(() => {
    if (!suggesting) {
      suggestStartRef.current = null;
      return;
    }
    suggestStartRef.current = Date.now();
    setSuggestElapsedMs(0);
    const tick = () => {
      if (suggestStartRef.current != null) {
        setSuggestElapsedMs(Date.now() - suggestStartRef.current);
      }
    };
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [suggesting]);

  const clearSuggestionMark = useCallback(
    (field: keyof SuggestedSources) => {
      setFieldSources((prev) => {
        if (!prev[field]) return prev;
        const next = { ...prev };
        delete next[field];
        return next;
      });
      setFieldProvenance((prev) => {
        if (!prev[field]) return prev;
        const next = { ...prev };
        delete next[field];
        return next;
      });
    },
    [],
  );

  const applyDto = useCallback((data: MetaDto, people: Catalogs['people']) => {
    setDto(data);
    setDescription(data.meta.description ?? '');
    setAbstract(data.meta.abstract ?? '');
    setYear(data.meta.year != null ? String(data.meta.year) : '');
    setVideoType(data.meta.video_type ?? '');
    setLanguage(data.meta.primary_language ?? '');
    setCountry(data.meta.country ?? '');
    setTagsText((data.meta.tags ?? []).join(', '));
    setSelectedReferenceUrls(
      (data.meta.reference_urls ?? []).map((url) => ({
        label: url,
        value: url,
      })),
    );
    setWorkTitleEn(data.meta.work_title?.en ?? '');
    setWorkTitleZh(data.meta.work_title?.zh ?? '');
    setWorkTitleNativeLang(data.meta.work_title?.native?.lang ?? '');
    setWorkTitleNativeName(data.meta.work_title?.native?.name ?? '');
    const review = data.meta.review ?? {};
    const sources: SuggestedSources = {};
    const provenance: FieldProvenance = {};
    const adopt = (key: keyof SuggestedSources, entry?: MetaReviewEntry) => {
      if (entry?.source !== 'suggestion') return;
      sources[key] = 'suggestion';
      if (
        entry.confidence != null ||
        entry.evidence ||
        entry.provider ||
        entry.source_url ||
        entry.retrieved_at ||
        entry.request_id
      ) {
        provenance[key] = {
          confidence: entry.confidence,
          evidence: entry.evidence,
          provider: entry.provider,
          source_url: entry.source_url,
          retrieved_at: entry.retrieved_at,
          request_id: entry.request_id,
        };
      }
    };
    adopt('description', review.description);
    adopt('abstract', review.abstract);
    adopt('year', review.year);
    adopt('actors', review.actors);
    adopt('video_type', review.video_type);
    adopt('primary_language', review.primary_language);
    adopt('tags', review.tags);
    adopt('work_title', review.work_title);
    adopt('reference_urls', review.reference_urls);
    setFieldSources(sources);
    setFieldProvenance(provenance);
    setInfo(null);
    setActorCandidates([]);
    setToolTrace([]);
    setActorCandidatesDropped(0);
    setPendingSuggestions({});
    const ids = data.meta.actor_ids ?? [];
    setSelectedActors(
      ids.map((id) => {
        const person = people.find((p) => p.id === id);
        return {
          label: person?.display ?? data.meta.actors?.[ids.indexOf(id)] ?? id,
          value: id,
        };
      }),
    );
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setConflict(null);
    try {
      const [metaRes, catRes] = await Promise.all([
        fetch(`/api/library/${encodeURIComponent(videoId)}`, {
          headers: { 'Accept-Language': locale },
        }),
        fetch(`/api/metadata/catalogs?locale=${locale}`, {
          headers: { 'Accept-Language': locale },
        }),
      ]);
      const metaData = (await metaRes.json()) as MetaDto & {
        error?: { message: string };
      };
      const catData = (await catRes.json()) as Catalogs & {
        error?: { message: string };
      };
      if (!metaRes.ok) {
        throw new Error(metaData.error?.message ?? t.metaLoadError);
      }
      if (!catRes.ok) {
        throw new Error(catData.error?.message ?? t.metaLoadError);
      }
      setCatalogs(catData);
      setActorOptions(
        catData.people.map((p) => ({ label: p.display, value: p.id })),
      );
      applyDto(metaData, catData.people);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.metaLoadError);
    } finally {
      setLoading(false);
    }
  }, [videoId, locale, t.metaLoadError, applyDto]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    return () => {
      suggestAbort.current?.abort();
      const requestId = suggestRequestId.current;
      if (requestId) {
        void fetch(
          `/api/library/${encodeURIComponent(videoId)}/meta/suggest?request_id=${encodeURIComponent(requestId)}`,
          { method: 'DELETE', keepalive: true },
        );
      }
    };
  }, [videoId]);

  const onActorSearch = useCallback(
    async (searchValue: string) => {
      try {
        const res = await fetch(
          `/api/metadata/catalogs?locale=${locale}&q=${encodeURIComponent(searchValue)}`,
        );
        const data = (await res.json()) as Catalogs;
        if (res.ok) {
          setActorOptions(
            data.people.map((p) => ({ label: p.display, value: p.id })),
          );
        }
      } catch {
        /* ignore autocomplete errors */
      }
    },
    [locale],
  );

  const countryOptions = useMemo(
    () => [
      { value: '', text: t.metaEmptyOption },
      ...(catalogs?.countries ?? []).map((c) => ({
        value: c.code,
        text: c.label,
      })),
    ],
    [catalogs, t.metaEmptyOption],
  );

  const typeOptions = useMemo(
    () => [
      { value: '', text: t.metaEmptyOption },
      ...(catalogs?.video_types ?? []).map((v) => ({ value: v, text: v })),
    ],
    [catalogs, t.metaEmptyOption],
  );

  const langOptions = useMemo(
    () => [
      { value: '', text: t.metaEmptyOption },
      ...(catalogs?.primary_languages ?? []).map((v) => ({
        value: v,
        text: v,
      })),
    ],
    [catalogs, t.metaEmptyOption],
  );

  const suggestStageText =
    suggestStage === 'queued'
      ? t.metaSuggestStageQueued
      : suggestStage === 'preparing'
        ? t.metaSuggestStagePreparing
        : suggestStage === 'researching'
          ? t.metaSuggestStageResearching
          : suggestStage === 'validating'
            ? t.metaSuggestStageValidating
            : t.metaSuggesting;

  const suggestElapsedText = (() => {
    const totalSeconds = Math.floor(suggestElapsedMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  })();

  const cancelSuggest = useCallback(() => {
    suggestAbort.current?.abort();
    const requestId = suggestRequestId.current;
    suggestRequestId.current = null;
    if (requestId) {
      void fetch(
        `/api/library/${encodeURIComponent(videoId)}/meta/suggest?request_id=${encodeURIComponent(requestId)}`,
        { method: 'DELETE' },
      );
    }
    suggestSeq.current += 1;
    setSuggestStage('cancelled');
    setSuggesting(false);
  }, [videoId]);

  const onSuggest = useCallback(async () => {
    const seq = ++suggestSeq.current;
    const snapshot = {
      yearEmpty: year.trim() === '',
      typeEmpty: videoType === '',
      langEmpty: language === '',
      countryEmpty: country === '',
      descriptionEmpty: description.trim() === '',
      abstractEmpty: abstract.trim() === '',
      workTitleEnEmpty: workTitleEn.trim() === '',
      tagsEmpty:
        tagsText
          .split(/[,，]/)
          .map((s) => s.trim())
          .filter(Boolean).length === 0,
      referenceUrlsEmpty: selectedReferenceUrls.length === 0,
    };
    suggestAbort.current?.abort();
    const ac = new AbortController();
    suggestAbort.current = ac;
    setSuggesting(true);
    setSuggestStage('queued');
    setActorCandidates([]);
    setToolTrace([]);
    setActorCandidatesDropped(0);
    setPendingSuggestions({});
    setError(null);
    setInfo(null);
    setWebWarning(null);
    try {
      const startRes = await fetch(
        `/api/library/${encodeURIComponent(videoId)}/meta/suggest`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept-Language': locale,
          },
          signal: ac.signal,
          body: JSON.stringify({
            draft: {
              year: year.trim() === '' ? null : Number(year),
              video_type: videoType === '' ? null : videoType,
              primary_language: language === '' ? null : language,
              country: country === '' ? null : country,
              description: description.trim() === '' ? null : description,
              abstract: abstract.trim() === '' ? null : abstract,
              tags: snapshot.tagsEmpty
                ? null
                : tagsText
                    .split(/[,，]/)
                    .map((s) => s.trim())
                    .filter(Boolean),
            },
          }),
        },
      );
      let job = (await startRes.json()) as SuggestJobResponse;
      if (seq !== suggestSeq.current) return;
      if (!startRes.ok) {
        throw new Error(job.error?.message ?? t.metaSuggestError);
      }
      if (!job.request_id) throw new Error(t.metaSuggestError);
      const requestId = job.request_id;
      suggestRequestId.current = requestId;
      setSuggestStage(job.stage);

      const pollStarted = Date.now();
      while (job.status === 'pending') {
        if (Date.now() - pollStarted > 210_000) {
          throw new Error(t.metaSuggestTimeout);
        }
        await waitForPoll(1_000, ac.signal);
        const pollRes = await fetch(
          `/api/library/${encodeURIComponent(videoId)}/meta/suggest?request_id=${encodeURIComponent(requestId)}`,
          { signal: ac.signal },
        );
        job = (await pollRes.json()) as SuggestJobResponse;
        if (!pollRes.ok) {
          throw new Error(job.error?.message ?? t.metaSuggestError);
        }
        if (seq !== suggestSeq.current) return;
        setSuggestStage(job.stage);
      }

      suggestRequestId.current = null;
      if (job.status === 'cancelled') return;
      if (job.status === 'failed' || !job.result) {
        throw new Error(job.error?.message ?? t.metaSuggestError);
      }
      const data = job.result;
      if (data.meta_revision !== dto?.meta_revision) {
        setConflict(data.meta_revision);
        throw new Error(t.metaConflict);
      }
      const candidates = data.web?.actor_candidates ?? [];
      setActorCandidates(
        candidates.map((candidate) => ({
          ...candidate,
          request_id: data.request_id,
        })),
      );
      setToolTrace(data.web?.tool_trace ?? []);
      setActorCandidatesDropped(data.web?.actor_candidates_dropped ?? 0);
      // Bug fix (todo/30 S1): a provider outage/timeout/malformed response is
      // reported as web.status === 'unavailable'. Surface it distinctly from
      // a real empty result so the operator knows no internet research
      // happened and the remaining suggestions are local title clues only.
      if (data.web?.status === 'unavailable') {
        setWebWarning(
          `${t.metaSuggestWebUnavailable}${data.web.reason ? ` (${data.web.reason})` : ''}`,
        );
      }
      if (
        (data.status === 'empty' || !data.suggestions) &&
        candidates.length === 0
      ) {
        setInfo(t.metaSuggestEmpty);
        return;
      }

      // Atomic merge against live form values (typing during request wins).
      const cur = formRef.current;
      const nextSources: SuggestedSources = {};
      const nextProvenance: FieldProvenance = {};
      const nextPending: PendingSuggestions = {};
      let applied = 0;
      const sug = data.suggestions ?? {};

      const mark = (key: keyof SuggestedSources, draft: SuggestField) => {
        nextSources[key] = 'suggestion';
        nextProvenance[key] = {
          confidence: draft.confidence,
          evidence: draft.evidence,
          provider:
            draft.source === 'external_web' ||
            draft.source === 'local_title' ||
            draft.source === 'caller_hint' ||
            draft.source === 'media_tag'
              ? draft.source
              : undefined,
          source_url: draft.source_url,
          retrieved_at: draft.retrieved_at ?? data.retrieved_at,
          request_id: data.request_id,
        };
        applied += 1;
      };

      if (snapshot.yearEmpty && cur.year.trim() === '' && sug.year != null) {
        setYear(String(sug.year.value));
        mark('year', sug.year);
      } else if (sug.year != null) {
        nextPending.year = sug.year;
      }
      if (snapshot.typeEmpty && cur.videoType === '' && sug.video_type != null) {
        setVideoType(String(sug.video_type.value));
        mark('video_type', sug.video_type);
      } else if (sug.video_type != null) {
        nextPending.video_type = sug.video_type;
      }
      if (
        snapshot.langEmpty &&
        cur.language === '' &&
        sug.primary_language != null
      ) {
        setLanguage(String(sug.primary_language.value));
        mark('primary_language', sug.primary_language);
      } else if (sug.primary_language != null) {
        nextPending.primary_language = sug.primary_language;
      }
      if (snapshot.countryEmpty && cur.country === '' && sug.country != null) {
        setCountry(String(sug.country.value));
        mark('country', sug.country);
      } else if (sug.country != null) {
        nextPending.country = sug.country;
      }
      if (
        snapshot.descriptionEmpty &&
        cur.description.trim() === '' &&
        sug.description != null
      ) {
        setDescription(String(sug.description.value));
        mark('description', sug.description);
      } else if (sug.description != null) {
        nextPending.description = sug.description;
      }
      if (
        snapshot.abstractEmpty &&
        cur.abstract.trim() === '' &&
        sug.abstract != null
      ) {
        setAbstract(String(sug.abstract.value));
        mark('abstract', sug.abstract);
      } else if (sug.abstract != null) {
        nextPending.abstract = sug.abstract;
      }
      const curTagsEmpty =
        cur.tagsText
          .split(/[,，]/)
          .map((s) => s.trim())
          .filter(Boolean).length === 0;
      if (
        snapshot.tagsEmpty &&
        curTagsEmpty &&
        Array.isArray(sug.tags?.value) &&
        sug.tags.value.length > 0
      ) {
        setTagsText(sug.tags.value.join(', '));
        mark('tags', sug.tags);
      } else if (Array.isArray(sug.tags?.value) && sug.tags.value.length > 0) {
        nextPending.tags = sug.tags;
      }
      const curReferenceUrlsEmpty = cur.referenceUrls.length === 0;
      if (
        snapshot.referenceUrlsEmpty &&
        curReferenceUrlsEmpty &&
        Array.isArray(sug.reference_urls?.value) &&
        sug.reference_urls.value.length > 0
      ) {
        setSelectedReferenceUrls(
          sug.reference_urls.value.map((url) => ({
            label: String(url),
            value: String(url),
          })),
        );
        mark('reference_urls', sug.reference_urls);
      } else if (
        Array.isArray(sug.reference_urls?.value) &&
        sug.reference_urls.value.length > 0
      ) {
        nextPending.reference_urls = sug.reference_urls;
      }

      // Work-title candidate isn't part of `sug` (structured agent fields) —
      // it comes from the work-identification web candidate list instead.
      // Bug fix (todo/30 S2): only trust this when the agent actually
      // resolved to a single answer. `status !== 'ok'` (e.g. 'ambiguous' —
      // the agent explicitly could not disambiguate) must never auto-apply a
      // candidate as if it were a confirmed title. The server now also gates
      // `web.candidates` on status==='ok'; this check is defense-in-depth.
      // Confidence lowered from an invented 0.7 (higher than any other
      // web-derived field in this flow) to 0.55, matching the confidence
      // used elsewhere for an unconfirmed single web source.
      const topCandidateTitle =
        data.web?.status === 'ok'
          ? data.web?.candidates?.[0]?.title?.trim()
          : undefined;
      if (topCandidateTitle) {
        const workTitleDraft: SuggestField = {
          value: topCandidateTitle,
          confidence: 0.55,
          source: 'external_web',
          evidence:
            data.web?.candidates?.[0]?.snippet || t.metaWorkTitleSuggestEvidence,
          source_url: data.web?.candidates?.[0]?.url,
          retrieved_at: data.retrieved_at,
        };
        if (snapshot.workTitleEnEmpty && cur.workTitleEn.trim() === '') {
          setWorkTitleEn(topCandidateTitle);
          mark('work_title', workTitleDraft);
        } else {
          nextPending.work_title = workTitleDraft;
        }
      }

      for (const key of Object.keys(nextPending) as ScalarSuggestKey[]) {
        const draft = nextPending[key];
        if (draft) {
          nextPending[key] = {
            ...draft,
            retrieved_at: draft.retrieved_at ?? data.retrieved_at,
            request_id: data.request_id,
          };
        }
      }
      setPendingSuggestions(nextPending);
      const pendingCount = Object.keys(nextPending).length;

      if (applied > 0) {
        setFieldSources((prev) => ({ ...prev, ...nextSources }));
        setFieldProvenance((prev) => ({ ...prev, ...nextProvenance }));
        setInfo(t.metaSuggestApplied);
      } else if (pendingCount > 0) {
        setInfo(t.metaSuggestReviewBelow);
      } else if (candidates.length === 0) {
        setInfo(t.metaSuggestEmpty);
      } else {
        setInfo(t.metaSuggestActorCandidatesFound);
      }
    } catch (err) {
      if (seq !== suggestSeq.current) return;
      const requestId = suggestRequestId.current;
      suggestRequestId.current = null;
      if (requestId) {
        void fetch(
          `/api/library/${encodeURIComponent(videoId)}/meta/suggest?request_id=${encodeURIComponent(requestId)}`,
          { method: 'DELETE' },
        );
      }
      if (err instanceof DOMException && err.name === 'AbortError') {
        setInfo(t.metaSuggestTimeout);
        return;
      }
      setSuggestStage('failed');
      setError(err instanceof Error ? err.message : t.metaSuggestError);
    } finally {
      if (seq === suggestSeq.current) {
        setSuggesting(false);
        suggestAbort.current = null;
      }
    }
  }, [
    year,
    videoType,
    language,
    country,
    description,
    abstract,
    tagsText,
    selectedReferenceUrls,
    videoId,
    locale,
    t.metaSuggestEmpty,
    t.metaSuggestActorCandidatesFound,
    t.metaSuggestReviewBelow,
    t.metaSuggestApplied,
    t.metaSuggestError,
    t.metaSuggestTimeout,
    t.metaConflict,
    dto?.meta_revision,
  ]);

  const addActorCandidate = useCallback(
    (candidate: SuggestActorCandidate) => {
      const personId = candidate.matched_person_id;
      if (!personId) return;
      const person = catalogs?.people.find((item) => item.id === personId);
      setSelectedActors((previous) => {
        if (previous.some((option) => option.value === personId)) return previous;
        return [
          ...previous,
          { label: person?.display ?? candidate.names.en, value: personId },
        ];
      });
      setFieldSources((previous) => ({ ...previous, actors: 'suggestion' }));
      setFieldProvenance((previous) => ({
        ...previous,
        actors: {
          confidence: 0.65,
          evidence: candidate.evidence,
          provider: 'external_web',
          source_url: candidate.url,
          retrieved_at: candidate.retrieved_at,
          request_id: candidate.request_id,
        },
      }));
    },
    [catalogs?.people],
  );

  /**
   * Grows the controlled person catalog with one new entry (POST
   * /api/metadata/catalogs/people), then makes the new id immediately
   * selectable by folding it into `actorOptions`. Actors stay catalog-IDs
   * only server-side (lib/metadata/validate.ts) — this is how free-text
   * names become valid ids instead of bypassing that invariant.
   */
  const createPerson = useCallback(
    async (input: {
      en: string;
      zh?: string;
      native?: { lang: string; name: string };
    }): Promise<EuiComboBoxOptionOption | null> => {
      try {
        const res = await fetch('/api/metadata/catalogs/people', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept-Language': locale,
          },
          body: JSON.stringify(input),
        });
        const data = (await res.json()) as {
          id?: string;
          display?: string;
          aliases?: string[];
          error?: { code?: string; message?: string };
        };
        if (!res.ok || !data.id) {
          setError(data.error?.message ?? t.metaActorCatalogAddError);
          return null;
        }
        const option: EuiComboBoxOptionOption = {
          label: data.display ?? input.en,
          value: data.id,
        };
        setActorOptions((previous) =>
          previous.some((o) => o.value === option.value)
            ? previous
            : [...previous, option],
        );
        // Bug fix (fixes the "Known as" panel below staying empty for a
        // just-created actor): `catalogs.people` is only populated at load
        // time via GET /api/metadata/catalogs — without this, a freshly
        // created person has no entry there until the whole catalog is
        // reloaded, so their known-names list would render empty/missing
        // immediately after creation.
        setCatalogs((previous) => {
          if (!previous) return previous;
          const newPerson = {
            id: data.id!,
            display: option.label,
            aliases: data.aliases ?? [input.en],
          };
          return previous.people.some((p) => p.id === newPerson.id)
            ? previous
            : { ...previous, people: [...previous.people, newPerson] };
        });
        return option;
      } catch {
        setError(t.metaActorCatalogAddError);
        return null;
      }
    },
    [locale, t.metaActorCatalogAddError],
  );

  /**
   * Replaces a catalog person's full "known as" list (`PATCH
   * /api/metadata/catalogs/people/{id}`). Optimistically updates local
   * `catalogs.people` so the chip list reflects the change immediately;
   * rolls back to the pre-edit list on failure (409 alias-conflict with
   * another person, or a validation error) so the UI never shows a name
   * that didn't actually persist.
   */
  const updatePersonKnownAs = useCallback(
    async (personId: string, nextAliases: string[]) => {
      const previousPeople = catalogs?.people;
      setCatalogs((previous) => {
        if (!previous) return previous;
        return {
          ...previous,
          people: previous.people.map((p) =>
            p.id === personId ? { ...p, aliases: nextAliases } : p,
          ),
        };
      });
      try {
        const res = await fetch(
          `/api/metadata/catalogs/people/${encodeURIComponent(personId)}`,
          {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              'Accept-Language': locale,
            },
            body: JSON.stringify({ aliases: nextAliases }),
          },
        );
        const data = (await res.json()) as {
          aliases?: string[];
          error?: { code?: string; message?: string };
        };
        if (!res.ok) {
          setError(data.error?.message ?? t.metaKnownAsError);
          if (previousPeople) {
            setCatalogs((previous) =>
              previous ? { ...previous, people: previousPeople } : previous,
            );
          }
          return;
        }
        // Reconcile with the server's normalized/deduped list (trim, NFKC,
        // de-dup order) rather than trusting the optimistic local value.
        if (data.aliases) {
          setCatalogs((previous) => {
            if (!previous) return previous;
            return {
              ...previous,
              people: previous.people.map((p) =>
                p.id === personId ? { ...p, aliases: data.aliases! } : p,
              ),
            };
          });
        }
      } catch {
        setError(t.metaKnownAsError);
        if (previousPeople) {
          setCatalogs((previous) =>
            previous ? { ...previous, people: previousPeople } : previous,
          );
        }
      }
    },
    [catalogs?.people, locale, t.metaKnownAsError],
  );

  const createActorFromFreeText = useCallback(
    (name: string) => {
      clearSuggestionMark('actors');
      void createPerson({ en: name }).then((option) => {
        if (!option) return;
        setSelectedActors((previous) =>
          previous.some((o) => o.value === option.value)
            ? previous
            : [...previous, option],
        );
      });
    },
    [createPerson, clearSuggestionMark],
  );

  const addUnresolvedCandidate = useCallback(
    (candidate: SuggestActorCandidate) => {
      void createPerson({
        en: candidate.names.en,
        zh: candidate.names.zh ?? undefined,
        native: candidate.names.native ?? undefined,
      }).then((option) => {
        if (!option) return;
        setActorCandidates((previous) =>
          previous.map((item) =>
            item === candidate
              ? { ...item, matched_person_id: option.value as string }
              : item,
          ),
        );
        setSelectedActors((previous) =>
          previous.some((o) => o.value === option.value)
            ? previous
            : [...previous, option],
        );
        setFieldSources((previous) => ({ ...previous, actors: 'suggestion' }));
        setFieldProvenance((previous) => ({
          ...previous,
          actors: {
            confidence: 0.65,
            evidence: candidate.evidence,
            provider: 'external_web',
            source_url: candidate.url,
            retrieved_at: candidate.retrieved_at,
            request_id: candidate.request_id,
          },
        }));
      });
    },
    [createPerson],
  );

  const applyPendingSuggestion = useCallback(
    (key: ScalarSuggestKey) => {
      const draft = pendingSuggestions[key];
      if (!draft) return;
      if (key === 'tags') {
        const existing = tagsText
          .split(/[,，]/)
          .map((s) => s.trim())
          .filter(Boolean);
        const incoming = Array.isArray(draft.value)
          ? draft.value.map(String)
          : [];
        const merged = [...existing];
        for (const tag of incoming) {
          if (!merged.some((t) => t.toLowerCase() === tag.toLowerCase())) {
            merged.push(tag);
          }
        }
        setTagsText(merged.join(', '));
      } else if (key === 'reference_urls') {
        const existing = selectedReferenceUrls.map((o) =>
          String(o.value ?? o.label),
        );
        const incoming = Array.isArray(draft.value)
          ? draft.value.map(String)
          : [];
        const merged = [...existing];
        for (const url of incoming) {
          if (!merged.includes(url)) {
            merged.push(url);
          }
        }
        setSelectedReferenceUrls(
          merged.map((url) => ({ label: url, value: url })),
        );
      } else if (key === 'year') {
        setYear(String(draft.value));
      } else if (key === 'video_type') {
        setVideoType(String(draft.value));
      } else if (key === 'primary_language') {
        setLanguage(String(draft.value));
      } else if (key === 'country') {
        setCountry(String(draft.value));
      } else if (key === 'description') {
        setDescription(String(draft.value));
      } else if (key === 'abstract') {
        setAbstract(String(draft.value));
      } else if (key === 'work_title') {
        setWorkTitleEn(String(draft.value));
      }
      setFieldSources((previous) => ({ ...previous, [key]: 'suggestion' }));
      setFieldProvenance((previous) => ({
        ...previous,
        [key]: {
          confidence: draft.confidence,
          evidence: draft.evidence,
          provider:
            draft.source === 'external_web' ||
            draft.source === 'local_title' ||
            draft.source === 'caller_hint' ||
            draft.source === 'media_tag'
              ? draft.source
              : undefined,
          source_url: draft.source_url,
          retrieved_at: draft.retrieved_at,
          request_id: draft.request_id,
        },
      }));
      setPendingSuggestions((previous) => {
        const next = { ...previous };
        delete next[key];
        return next;
      });
    },
    [pendingSuggestions, tagsText, selectedReferenceUrls],
  );

  const save = useCallback(async () => {
    if (!dto) return;
    setSaving(true);
    setError(null);
    setConflict(null);
    const tags = tagsText
      .split(/[,，]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const referenceUrls = selectedReferenceUrls
      .map((o) => String(o.value ?? o.label).trim())
      .filter(Boolean);
    const yearNum = year.trim() === '' ? null : Number(year);
    if (yearNum !== null && (!Number.isInteger(yearNum) || Number.isNaN(yearNum))) {
      setError(t.metaSaveError);
      setSaving(false);
      return;
    }

    const baseline = dto.meta;
    const baselineTags = baseline.tags ?? [];
    const baselineReferenceUrls = baseline.reference_urls ?? [];
    const baselineActors = baseline.actor_ids ?? [];
    const nextActors = selectedActors.map((o) => String(o.value));

    // Only PATCH changed fields so unchanged suggestion provenance survives.
    const body: Record<string, unknown> = {
      expected_revision: dto.meta_revision,
    };
    const sources: SuggestedSources = {};
    const provenance: FieldProvenance = {};

    const takeSource = (key: keyof SuggestedSources) => {
      if (fieldSources[key] === 'suggestion') {
        sources[key] = 'suggestion';
        if (fieldProvenance[key]) provenance[key] = fieldProvenance[key];
      }
    };

    const nextDescription = description.trim() === '' ? null : description;
    const baseDescription = baseline.description ?? null;
    if (nextDescription !== baseDescription) {
      body.description = nextDescription;
      takeSource('description');
    }

    const nextAbstract = abstract.trim() === '' ? null : abstract;
    const baseAbstract = baseline.abstract ?? null;
    if (nextAbstract !== baseAbstract) {
      body.abstract = nextAbstract;
      takeSource('abstract');
    }

    const baseYear = baseline.year ?? null;
    if (yearNum !== baseYear) {
      body.year = yearNum;
      takeSource('year');
    }

    if (!sameTags(nextActors, baselineActors)) {
      body.actor_ids = nextActors.length === 0 ? null : nextActors;
      takeSource('actors');
    }

    const nextType = videoType === '' ? null : videoType;
    const baseType = baseline.video_type ?? null;
    if (nextType !== baseType) {
      body.video_type = nextType;
      takeSource('video_type');
    }

    const nextLang = language === '' ? null : language;
    const baseLang = baseline.primary_language ?? null;
    if (nextLang !== baseLang) {
      body.primary_language = nextLang;
      takeSource('primary_language');
    }

    const nextCountry = country === '' ? null : country;
    const baseCountry = baseline.country ?? null;
    if (nextCountry !== baseCountry) {
      body.country = nextCountry;
      takeSource('country');
    }

    if (!sameTags(tags, baselineTags)) {
      body.tags = tags.length === 0 ? null : tags;
      takeSource('tags');
    }

    if (!sameTags(referenceUrls, baselineReferenceUrls)) {
      body.reference_urls = referenceUrls.length === 0 ? null : referenceUrls;
      takeSource('reference_urls');
    }

    const nextWorkTitleEn = workTitleEn.trim();
    const nextWorkTitleZh = workTitleZh.trim();
    const nextWorkTitleNativeLang = workTitleNativeLang.trim();
    const nextWorkTitleNativeName = workTitleNativeName.trim();
    const nextWorkTitle = nextWorkTitleEn
      ? {
          en: nextWorkTitleEn,
          ...(nextWorkTitleZh ? { zh: nextWorkTitleZh } : {}),
          ...(nextWorkTitleNativeLang && nextWorkTitleNativeName
            ? {
                native: {
                  lang: nextWorkTitleNativeLang,
                  name: nextWorkTitleNativeName,
                },
              }
            : {}),
        }
      : null;
    const baseWorkTitle = baseline.work_title ?? null;
    if (JSON.stringify(nextWorkTitle) !== JSON.stringify(baseWorkTitle)) {
      body.work_title = nextWorkTitle;
      takeSource('work_title');
    }

    const editableKeys = [
      'description',
      'abstract',
      'year',
      'actor_ids',
      'video_type',
      'primary_language',
      'country',
      'tags',
      'work_title',
      'reference_urls',
    ] as const;
    if (!editableKeys.some((k) => body[k] !== undefined)) {
      setError(t.metaSaveError);
      setSaving(false);
      return;
    }

    if (Object.keys(sources).length > 0) body.field_sources = sources;
    if (Object.keys(provenance).length > 0) body.field_provenance = provenance;

    try {
      const res = await fetch(
        `/api/library/${encodeURIComponent(videoId)}/meta`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Accept-Language': locale,
          },
          body: JSON.stringify(body),
        },
      );
      const data = (await res.json()) as {
        meta_revision?: number;
        meta?: MetaDto['meta'];
        error?: {
          code?: string;
          message?: string;
          current_revision?: number;
        };
      };
      if (res.status === 409) {
        setConflict(data.error?.current_revision ?? null);
        setError(data.error?.message ?? t.metaConflict);
        return;
      }
      if (!res.ok) {
        throw new Error(data.error?.message ?? t.metaSaveError);
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.metaSaveError);
    } finally {
      setSaving(false);
    }
  }, [
    dto,
    tagsText,
    selectedReferenceUrls,
    year,
    description,
    abstract,
    selectedActors,
    videoType,
    language,
    country,
    workTitleEn,
    workTitleZh,
    workTitleNativeLang,
    workTitleNativeName,
    fieldSources,
    fieldProvenance,
    videoId,
    locale,
    t.metaConflict,
    t.metaSaveError,
    onSaved,
    onClose,
  ]);

  const evidenceHelp = (key: keyof SuggestedSources) => {
    if (fieldSources[key] !== 'suggestion') return undefined;
    const prov = fieldProvenance[key];
    const parts: string[] = [t.metaFieldSuggested];
    if (prov?.confidence != null) {
      parts.push(`${Math.round(prov.confidence * 100)}%`);
    }
    if (prov?.evidence) parts.push(prov.evidence);
    return (
      <>
        <span>{parts.join(' · ')}</span>
        {prov?.source_url && (
          <>
            {' · '}
            <a href={prov.source_url} target="_blank" rel="noreferrer">
              {t.metaActorCandidateSource}
            </a>
          </>
        )}
      </>
    );
  };

  const renderPendingSuggestion = (key: ScalarSuggestKey) => {
    const draft = pendingSuggestions[key];
    if (!draft) return null;
    const displayValue = Array.isArray(draft.value)
      ? draft.value.join(', ')
      : String(draft.value);
    return (
      <>
        <EuiSpacer size="xs" />
        <EuiCallOut size="s" color="primary">
          <EuiFlexGroup alignItems="center" gutterSize="s" responsive={false}>
            <EuiFlexItem>
              <EuiText size="xs">
                <p>
                  <strong>{t.metaSuggestPendingValue}:</strong> {displayValue}
                </p>
                <p>
                  {draft.confidence != null
                    ? `${Math.round(draft.confidence * 100)}% · `
                    : ''}
                  {draft.evidence}
                  {draft.source_url && (
                    <>
                      {' · '}
                      <a href={draft.source_url} target="_blank" rel="noreferrer">
                        {t.metaActorCandidateSource}
                      </a>
                    </>
                  )}
                  {draft.retrieved_at ? ` · ${draft.retrieved_at}` : ''}
                </p>
              </EuiText>
            </EuiFlexItem>
            <EuiFlexItem grow={false}>
              <EuiButtonEmpty
                size="s"
                onClick={() => applyPendingSuggestion(key)}
              >
                {t.metaSuggestPendingApply}
              </EuiButtonEmpty>
            </EuiFlexItem>
          </EuiFlexGroup>
        </EuiCallOut>
        <EuiSpacer size="s" />
      </>
    );
  };

  return (
    <EuiFlyout ownFocus onClose={onClose} size="m" aria-labelledby="meta-flyout">
      <EuiFlyoutHeader hasBorder>
        <EuiTitle size="s">
          <h2 id="meta-flyout">{t.actionEditMeta}</h2>
        </EuiTitle>
        <EuiText size="s" color="subdued">
          <p>{dto?.title || videoId}</p>
        </EuiText>
      </EuiFlyoutHeader>
      <EuiFlyoutBody>
        {error && (
          <>
            <EuiCallOut color="danger" size="s" title={error} />
            <EuiSpacer size="m" />
            {conflict != null && (
              <>
                <EuiButton size="s" onClick={() => void load()}>
                  {t.metaReload}
                </EuiButton>
                <EuiSpacer size="m" />
              </>
            )}
          </>
        )}
        {info && !error && (
          <>
            <EuiCallOut color="primary" size="s" title={info} />
            <EuiSpacer size="m" />
          </>
        )}
        {webWarning && !error && (
          <>
            <EuiCallOut
              color="warning"
              iconType="alert"
              size="s"
              title={webWarning}
            />
            <EuiSpacer size="m" />
          </>
        )}
        {suggesting && !error && (
          <>
            <EuiCallOut
              color="primary"
              iconType="search"
              size="s"
              title={
                <EuiFlexGroup
                  alignItems="center"
                  justifyContent="spaceBetween"
                  gutterSize="s"
                  responsive={false}
                >
                  <EuiFlexItem grow={false}>{suggestStageText}</EuiFlexItem>
                  <EuiFlexItem grow={false}>
                    <EuiText size="xs" color="subdued">
                      <span aria-label={t.metaSuggestElapsedLabel}>
                        {suggestElapsedText}
                      </span>
                    </EuiText>
                  </EuiFlexItem>
                </EuiFlexGroup>
              }
            >
              <p>{t.metaSuggestStageHelp}</p>
            </EuiCallOut>
            <EuiSpacer size="m" />
          </>
        )}
        {loading || !catalogs ? (
          <EuiText size="s">{t.metaLoading}</EuiText>
        ) : (
          <EuiForm component="form" onSubmit={(e) => e.preventDefault()} fullWidth>
            <EuiFormRow
              label={t.metaWorkTitle}
              helpText={evidenceHelp('work_title') ?? t.metaWorkTitleHelp}
              fullWidth
            >
              <EuiFlexGroup gutterSize="s" responsive={false} wrap>
                <EuiFlexItem style={{ minWidth: 180 }}>
                  <EuiFieldText
                    placeholder={t.metaWorkTitleEn}
                    value={workTitleEn}
                    onChange={(e) => {
                      clearSuggestionMark('work_title');
                      setWorkTitleEn(e.target.value);
                    }}
                    compressed
                    fullWidth
                  />
                </EuiFlexItem>
                <EuiFlexItem style={{ minWidth: 140 }}>
                  <EuiFieldText
                    placeholder={t.metaWorkTitleZh}
                    value={workTitleZh}
                    onChange={(e) => {
                      clearSuggestionMark('work_title');
                      setWorkTitleZh(e.target.value);
                    }}
                    compressed
                    fullWidth
                  />
                </EuiFlexItem>
                <EuiFlexItem style={{ minWidth: 70 }} grow={false}>
                  <EuiFieldText
                    placeholder="ko / ja / th"
                    value={workTitleNativeLang}
                    onChange={(e) => {
                      clearSuggestionMark('work_title');
                      setWorkTitleNativeLang(e.target.value);
                    }}
                    compressed
                    style={{ width: 90 }}
                  />
                </EuiFlexItem>
                <EuiFlexItem style={{ minWidth: 140 }}>
                  <EuiFieldText
                    placeholder={t.metaWorkTitleNative}
                    value={workTitleNativeName}
                    onChange={(e) => {
                      clearSuggestionMark('work_title');
                      setWorkTitleNativeName(e.target.value);
                    }}
                    compressed
                    fullWidth
                  />
                </EuiFlexItem>
              </EuiFlexGroup>
            </EuiFormRow>
            {renderPendingSuggestion('work_title')}
            <EuiFormRow
              label={t.metaDescription}
              helpText={evidenceHelp('description')}
              fullWidth
            >
              <EuiTextArea
                value={description}
                onChange={(e) => {
                  clearSuggestionMark('description');
                  setDescription(e.target.value);
                }}
                rows={4}
                compressed
                fullWidth
              />
            </EuiFormRow>
            {renderPendingSuggestion('description')}
            <EuiFormRow
              label={t.metaAbstract}
              helpText={evidenceHelp('abstract')}
              fullWidth
            >
              <EuiFieldText
                value={abstract}
                onChange={(e) => {
                  clearSuggestionMark('abstract');
                  setAbstract(e.target.value);
                }}
                compressed
                fullWidth
              />
            </EuiFormRow>
            {renderPendingSuggestion('abstract')}
            <EuiFormRow label={t.metaYear} helpText={evidenceHelp('year')} fullWidth>
              <EuiFieldNumber
                value={year}
                onChange={(e) => {
                  clearSuggestionMark('year');
                  setYear(e.target.value);
                }}
                compressed
                fullWidth
                placeholder="1990"
              />
            </EuiFormRow>
            {renderPendingSuggestion('year')}
            <EuiFormRow
              label={t.metaActors}
              helpText={evidenceHelp('actors') ?? t.metaActorsHelp}
              fullWidth
            >
              <EuiComboBox
                options={actorOptions}
                selectedOptions={selectedActors}
                onChange={(opts) => {
                  clearSuggestionMark('actors');
                  setSelectedActors(opts);
                }}
                onSearchChange={(q) => void onActorSearch(q)}
                onCreateOption={(searchValue) => {
                  const trimmed = searchValue.trim();
                  if (!trimmed) return false;
                  createActorFromFreeText(trimmed);
                }}
                isClearable
                compressed
                fullWidth
              />
            </EuiFormRow>
            {selectedActors.length > 0 && (
              <>
                <EuiText size="xs" color="subdued">
                  <p>{t.metaKnownAsHelp}</p>
                </EuiText>
                <EuiSpacer size="xs" />
                {selectedActors.map((option) => {
                  const personId = String(option.value);
                  const person = catalogs?.people.find((p) => p.id === personId);
                  // Free-text-created / suggestion-added actors are folded
                  // into `catalogs.people` as soon as they're created (see
                  // `createPerson`) — this should only be null for a brief
                  // instant mid-request, never steady-state.
                  if (!person) return null;
                  const draft = knownAsDraft[personId] ?? '';
                  const canRemove = person.aliases.length > 1;
                  const addName = () => {
                    const trimmed = draft.trim();
                    setKnownAsDraft((prev) => ({ ...prev, [personId]: '' }));
                    if (!trimmed) return;
                    if (
                      person.aliases.some(
                        (a) => a.toLowerCase() === trimmed.toLowerCase(),
                      )
                    ) {
                      return;
                    }
                    void updatePersonKnownAs(personId, [
                      ...person.aliases,
                      trimmed,
                    ]);
                  };
                  const removeName = (name: string) => {
                    if (!canRemove) return;
                    // Confirmed, not immediate: this rewrites the shared
                    // person catalog for every video (todo/32 R2).
                    setKnownAsRemoveTarget({
                      personId,
                      personLabel: person.display,
                      name,
                    });
                  };
                  return (
                    <div key={personId}>
                      <EuiPanel
                        color="subdued"
                        paddingSize="s"
                        hasShadow={false}
                        hasBorder
                      >
                        <EuiText size="xs">
                          <strong>{person.display}</strong>
                        </EuiText>
                        <EuiSpacer size="xs" />
                        <EuiFlexGroup
                          wrap
                          responsive={false}
                          gutterSize="xs"
                          alignItems="center"
                        >
                          {person.aliases.map((name) =>
                            canRemove ? (
                              <EuiFlexItem grow={false} key={name}>
                                <EuiBadge
                                  color="hollow"
                                  iconType="cross"
                                  iconSide="right"
                                  iconOnClick={() => removeName(name)}
                                  iconOnClickAriaLabel={
                                    t.metaKnownAsRemoveAriaLabel
                                  }
                                >
                                  {name}
                                </EuiBadge>
                              </EuiFlexItem>
                            ) : (
                              <EuiFlexItem grow={false} key={name}>
                                <EuiBadge color="hollow">{name}</EuiBadge>
                              </EuiFlexItem>
                            ),
                          )}
                          <EuiFlexItem grow={false} style={{ minWidth: 160 }}>
                            <EuiFieldText
                              compressed
                              placeholder={t.metaKnownAsAddPlaceholder}
                              value={draft}
                              onChange={(e) =>
                                setKnownAsDraft((prev) => ({
                                  ...prev,
                                  [personId]: e.target.value,
                                }))
                              }
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  addName();
                                }
                              }}
                            />
                          </EuiFlexItem>
                          <EuiFlexItem grow={false}>
                            <EuiButtonIcon
                              iconType="plusCircle"
                              aria-label={t.metaKnownAsAddAriaLabel}
                              onClick={addName}
                              disabled={!draft.trim()}
                            />
                          </EuiFlexItem>
                        </EuiFlexGroup>
                      </EuiPanel>
                      <EuiSpacer size="xs" />
                    </div>
                  );
                })}
                <EuiSpacer size="s" />
              </>
            )}
            {actorCandidatesDropped > 0 && (
              <>
                <EuiCallOut
                  color="warning"
                  size="s"
                  iconType="questionInCircle"
                  title={t.metaActorCandidatesWithheld.replace(
                    '{count}',
                    String(actorCandidatesDropped),
                  )}
                >
                  <p>{t.metaActorCandidatesWithheldHelp}</p>
                </EuiCallOut>
                <EuiSpacer size="s" />
              </>
            )}
            {actorCandidates.length > 0 && (
              <>
                <EuiCallOut
                  color="primary"
                  size="s"
                  title={t.metaActorCandidates}
                >
                  <ul>
                    {actorCandidates.map((candidate) => {
                      const alreadySelected = selectedActors.some(
                        (option) => option.value === candidate.matched_person_id,
                      );
                      return (
                        <li key={`${candidate.url}:${candidate.names.en}`}>
                          <EuiFlexGroup
                            alignItems="flexStart"
                            gutterSize="s"
                            responsive={false}
                          >
                            <EuiFlexItem>
                              <EuiText size="xs">
                                <p>
                                  <strong>{candidate.names.en}</strong>
                                  {candidate.character
                                    ? ` — ${candidate.character}`
                                    : ''}
                                </p>
                                {candidate.names.zh && (
                                  <p>
                                    {t.metaActorCandidateZh}: {candidate.names.zh}
                                  </p>
                                )}
                                {candidate.names.native && (
                                  <p>
                                    {t.metaActorCandidateNative} (
                                    {candidate.names.native.lang}):{' '}
                                    {candidate.names.native.name}
                                  </p>
                                )}
                                <p>
                                  <a
                                    href={candidate.url}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    {t.metaActorCandidateSource}
                                  </a>
                                  {' · '}
                                  {candidate.retrieved_at}
                                  {!candidate.matched_person_id && (
                                    <> · {t.metaActorCandidateUnresolved}</>
                                  )}
                                </p>
                              </EuiText>
                            </EuiFlexItem>
                            {candidate.matched_person_id ? (
                              <EuiFlexItem grow={false}>
                                <EuiButtonEmpty
                                  size="s"
                                  isDisabled={alreadySelected}
                                  onClick={() => addActorCandidate(candidate)}
                                >
                                  {alreadySelected
                                    ? t.metaActorCandidateAdded
                                    : t.metaActorCandidateAdd}
                                </EuiButtonEmpty>
                              </EuiFlexItem>
                            ) : (
                              <EuiFlexItem grow={false}>
                                <EuiButtonEmpty
                                  size="s"
                                  onClick={() => addUnresolvedCandidate(candidate)}
                                >
                                  {t.metaActorCandidateAddToCatalog}
                                </EuiButtonEmpty>
                              </EuiFlexItem>
                            )}
                          </EuiFlexGroup>
                          <EuiSpacer size="s" />
                        </li>
                      );
                    })}
                  </ul>
                </EuiCallOut>
                <EuiSpacer size="m" />
              </>
            )}
            {toolTrace.length > 0 && (
              <>
                <EuiAccordion
                  id="meta-suggest-tool-trace"
                  buttonContent={`${t.metaSuggestTraceTitle} (${toolTrace.length})`}
                >
                  <EuiSpacer size="s" />
                  <ul>
                    {toolTrace.map((entry, index) => (
                      <li key={`${entry.tool_id}:${index}`}>
                        <EuiText size="xs">
                          {entry.query && (
                            <p>
                              {t.metaSuggestTraceSearch}: {entry.query}
                            </p>
                          )}
                          {entry.url && (
                            <p>
                              {t.metaSuggestTraceRead}:{' '}
                              <a href={entry.url} target="_blank" rel="noreferrer">
                                {entry.url}
                              </a>
                            </p>
                          )}
                          {entry.question && (
                            <p>
                              {t.metaSuggestTraceQuestion}: {entry.question}
                            </p>
                          )}
                        </EuiText>
                        <EuiSpacer size="s" />
                      </li>
                    ))}
                  </ul>
                </EuiAccordion>
                <EuiSpacer size="m" />
              </>
            )}
            <EuiFormRow
              label={t.metaVideoType}
              helpText={evidenceHelp('video_type')}
              fullWidth
            >
              <EuiSelect
                options={typeOptions}
                value={videoType}
                onChange={(e) => {
                  clearSuggestionMark('video_type');
                  setVideoType(e.target.value);
                }}
                compressed
                fullWidth
              />
            </EuiFormRow>
            {renderPendingSuggestion('video_type')}
            <EuiFormRow
              label={t.metaLanguage}
              helpText={evidenceHelp('primary_language')}
              fullWidth
            >
              <EuiSelect
                options={langOptions}
                value={language}
                onChange={(e) => {
                  clearSuggestionMark('primary_language');
                  setLanguage(e.target.value);
                }}
                compressed
                fullWidth
              />
            </EuiFormRow>
            {renderPendingSuggestion('primary_language')}
            <EuiFormRow
              label={t.metaCountry}
              helpText={evidenceHelp('country')}
              fullWidth
            >
              <EuiSelect
                options={countryOptions}
                value={country}
                onChange={(e) => {
                  clearSuggestionMark('country');
                  setCountry(e.target.value);
                }}
                compressed
                fullWidth
              />
            </EuiFormRow>
            {renderPendingSuggestion('country')}
            <EuiFormRow
              label={t.metaTags}
              helpText={evidenceHelp('tags') ?? t.metaTagsHelp}
              fullWidth
            >
              <EuiFieldText
                value={tagsText}
                onChange={(e) => {
                  clearSuggestionMark('tags');
                  setTagsText(e.target.value);
                }}
                compressed
                fullWidth
              />
            </EuiFormRow>
            {renderPendingSuggestion('tags')}
            <EuiFormRow
              label={t.metaReferenceUrls}
              helpText={evidenceHelp('reference_urls') ?? t.metaReferenceUrlsHelp}
              fullWidth
            >
              <EuiComboBox
                noSuggestions
                selectedOptions={selectedReferenceUrls}
                onChange={(opts) => {
                  clearSuggestionMark('reference_urls');
                  setSelectedReferenceUrls(opts);
                }}
                onCreateOption={(searchValue) => {
                  const trimmed = searchValue.trim();
                  if (!trimmed) return false;
                  if (
                    selectedReferenceUrls.some(
                      (o) => String(o.value ?? o.label) === trimmed,
                    )
                  ) {
                    return false;
                  }
                  clearSuggestionMark('reference_urls');
                  setSelectedReferenceUrls((prev) => [
                    ...prev,
                    { label: trimmed, value: trimmed },
                  ]);
                }}
                isClearable
                compressed
                fullWidth
                placeholder="https://…"
              />
            </EuiFormRow>
            {renderPendingSuggestion('reference_urls')}
            <EuiText size="xs" color="subdued">
              <p>
                {t.metaRevision}: {dto?.meta_revision ?? 0}
              </p>
              <p>{t.metaSuggestHelp}</p>
            </EuiText>
          </EuiForm>
        )}
      </EuiFlyoutBody>
      <EuiFlyoutFooter>
        <EuiFlexGroup justifyContent="spaceBetween">
          <EuiFlexItem grow={false}>
            <EuiButtonEmpty onClick={onClose}>{t.cancelConfirm}</EuiButtonEmpty>
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <EuiFlexGroup gutterSize="s">
              {suggesting && (
                <EuiFlexItem grow={false}>
                  <EuiButtonEmpty onClick={cancelSuggest}>
                    {t.metaSuggestCancel}
                  </EuiButtonEmpty>
                </EuiFlexItem>
              )}
              <EuiFlexItem grow={false}>
                <EuiButton
                  onClick={() => void onSuggest()}
                  isLoading={suggesting}
                  isDisabled={loading || !dto || saving}
                >
                  {suggesting ? t.metaSuggesting : t.metaSuggest}
                </EuiButton>
              </EuiFlexItem>
              <EuiFlexItem grow={false}>
                <EuiButton
                  fill
                  onClick={() => void save()}
                  isLoading={saving}
                  isDisabled={loading || !dto}
                >
                  {t.metaSave}
                </EuiButton>
              </EuiFlexItem>
            </EuiFlexGroup>
          </EuiFlexItem>
        </EuiFlexGroup>
      </EuiFlyoutFooter>
      {knownAsRemoveTarget && (
        <EuiConfirmModal
          title={t.metaKnownAsRemoveConfirmTitle}
          onCancel={() => setKnownAsRemoveTarget(null)}
          onConfirm={() => {
            const target = knownAsRemoveTarget;
            setKnownAsRemoveTarget(null);
            const person = catalogs?.people.find(
              (p) => p.id === target.personId,
            );
            if (!person) return;
            void updatePersonKnownAs(
              target.personId,
              person.aliases.filter((a) => a !== target.name),
            );
          }}
          cancelButtonText={t.cancelConfirm}
          confirmButtonText={t.metaKnownAsRemoveAriaLabel}
          buttonColor="danger"
          defaultFocusedButton="cancel"
        >
          <p>{t.metaKnownAsRemoveConfirmBody}</p>
          <EuiText size="s">
            <strong>{knownAsRemoveTarget.name}</strong>
            {' — '}
            {knownAsRemoveTarget.personLabel}
          </EuiText>
        </EuiConfirmModal>
      )}
    </EuiFlyout>
  );
}
