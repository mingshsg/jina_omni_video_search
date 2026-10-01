'use client';

import {
  EuiBadge,
  EuiButton,
  EuiButtonEmpty,
  EuiCallOut,
  EuiFlexGroup,
  EuiFlexItem,
  EuiFlyout,
  EuiFlyoutBody,
  EuiFlyoutHeader,
  EuiFormRow,
  EuiSelect,
  EuiSpacer,
  EuiText,
  EuiTitle,
} from '@elastic/eui';
import { useCallback, useEffect, useState } from 'react';
import { useLocale } from '@/lib/i18n/locale-context';
import type { DramaResultsDto, DramaSummaryDto } from '@/lib/drama/safe-dto';
import { DRAMA_ACTIVE_STATUSES } from '@/lib/ingest/drama-options';

type SubtitleSource = 'auto' | 'existing_only' | 'force_asr';

function dramaColor(
  status: string,
): 'default' | 'primary' | 'success' | 'warning' | 'danger' {
  switch (status) {
    case 'succeeded':
      return 'success';
    case 'partial':
      return 'warning';
    case 'failed':
      return 'danger';
    case 'pending':
    case 'running':
      return 'primary';
    default:
      return 'default';
  }
}

export function DramaResultsFlyout({
  videoId,
  jobId,
  drama,
  onClose,
  onRetryStarted,
}: {
  videoId: string;
  jobId?: string;
  drama: DramaSummaryDto;
  onClose: () => void;
  onRetryStarted?: () => void;
}) {
  const { t, locale } = useLocale();
  const [detail, setDetail] = useState<DramaResultsDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [retrySource, setRetrySource] = useState<SubtitleSource>(
    drama.subtitle_source === 'existing_only' || drama.subtitle_source === 'force_asr'
      ? drama.subtitle_source : 'auto',
  );
  const [retryLanguage, setRetryLanguage] = useState<'en' | 'zh' | ''>(
    drama.source_language === 'en' || drama.source_language === 'zh'
      ? drama.source_language : '',
  );

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/library/${encodeURIComponent(videoId)}`, {
        headers: { 'Accept-Language': locale },
      });
      const data = (await res.json()) as {
        drama?: DramaResultsDto;
        error?: { message: string };
      };
      if (!res.ok) throw new Error(data.error?.message ?? t.libraryError);
      setDetail(data.drama ?? null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.libraryError);
    }
  }, [videoId, locale, t.libraryError]);

  const retry = useCallback(async () => {
    if (!jobId || retrying) return;
    const current = detail ?? drama;
    const hasSubtitles = current.modules?.includes('subtitles') ?? false;
    const hasBilingualSubtitles = hasSubtitles &&
      current.languages?.includes('en') && current.languages?.includes('zh');
    if (hasBilingualSubtitles && retrySource !== 'existing_only' && !retryLanguage) {
      setError(t.dramaSpokenLanguageRequired);
      return;
    }
    setRetrying(true);
    setError(null);
    try {
      const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/retry`, {
        method: 'POST',
        headers: {
          'Accept-Language': locale,
          ...(hasSubtitles ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(hasSubtitles ? { body: JSON.stringify({
          subtitle_source: retrySource,
          ...(retryLanguage ? { source_language: retryLanguage } : {}),
        }) } : {}),
      });
      const data = (await res.json()) as { error?: { message: string } };
      if (!res.ok) throw new Error(data.error?.message ?? t.libraryError);
      // The runner is asynchronous; show the accepted state immediately and
      // keep polling rather than leaving the stale failure on screen.
      setDetail((current) => ({
        ...(current ?? drama), status: 'pending', error: undefined,
        subtitle_source: retrySource,
        ...(retryLanguage ? { source_language: retryLanguage } : {}),
      }));
      onRetryStarted?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.libraryError);
    } finally {
      setRetrying(false);
    }
  }, [jobId, retrying, locale, t.libraryError, t.dramaSpokenLanguageRequired,
    drama, detail, retrySource, retryLanguage, onRetryStarted]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (
      !(DRAMA_ACTIVE_STATUSES as readonly string[]).includes(
        (detail ?? drama).status,
      )
    )
      return;
    const timer = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(timer);
  }, [detail, drama, load]);

  const sources = detail?.earlier_run_sources;
  const earlierRunNote = (runId: string | undefined) =>
    runId ? (
      <EuiText size="xs" color="subdued">
        <p>{t.dramaResultFromEarlierRun.replace('{run}', runId)}</p>
      </EuiText>
    ) : null;
  const subtitleSource = (lang: string) =>
    sources?.subtitles?.[lang as keyof NonNullable<typeof sources.subtitles>];

  const dto = detail ?? drama;
  const hasDetail = Boolean(
    detail &&
      ((detail.synopsis_zh || detail.synopsis_en) ||
        (detail.structure && detail.structure.length > 0) ||
        (detail.key_scenes && detail.key_scenes.length > 0) ||
        (detail.key_actors && detail.key_actors.length > 0) ||
        detail.script_urls?.zh || detail.script_urls?.en ||
        detail.subtitle_count != null),
  );

  return (
    <EuiFlyout
      ownFocus
      onClose={onClose}
      size="m"
      aria-labelledby="drama-results-flyout"
    >
      <EuiFlyoutHeader hasBorder>
        <EuiFlexGroup alignItems="center" gutterSize="s" responsive={false}>
          <EuiFlexItem>
            <EuiTitle size="s">
              <h2 id="drama-results-flyout">{t.dramaViewResults}</h2>
            </EuiTitle>
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <EuiBadge color={dramaColor(dto.status)}>{dto.status}</EuiBadge>
          </EuiFlexItem>
        </EuiFlexGroup>
      </EuiFlyoutHeader>
      <EuiFlyoutBody>
        {error && (
          <>
            <EuiCallOut color="danger" size="s" title={error} />
            <EuiSpacer size="m" />
          </>
        )}
        {dto.synopsis_status === 'provisional' && (
          <>
            <EuiCallOut
              color="warning"
              size="s"
              iconType="alert"
              title={t.dramaProvisionalNote}
            />
            <EuiSpacer size="m" />
          </>
        )}

        <EuiTitle size="xxs">
          <h3>{t.dramaResultOverview}</h3>
        </EuiTitle>
        <EuiButtonEmpty size="s" onClick={() => void load()}>
          {t.refresh}
        </EuiButtonEmpty>
        {jobId && ['failed', 'partial'].includes(dto.status) && (
          <>
            {dto.modules?.includes('subtitles') && (
              <>
                <EuiSpacer size="s" />
                <EuiFormRow label={t.dramaSubtitleSource}>
                  <EuiSelect
                    options={[
                      { value: 'auto', text: t.dramaSubtitleSourceAuto },
                      { value: 'existing_only', text: t.dramaSubtitleSourceExisting },
                      { value: 'force_asr', text: t.dramaSubtitleSourceForceAsr },
                    ]}
                    value={retrySource}
                    onChange={(event) => setRetrySource(event.target.value as SubtitleSource)}
                  />
                </EuiFormRow>
                {dto.languages?.includes('en') && dto.languages?.includes('zh') && (
                  <EuiFormRow label={t.dramaSpokenLanguage} helpText={t.dramaSpokenLanguageHelp}>
                    <EuiSelect
                      options={[{ value: '', text: '—' }, { value: 'en', text: 'English' }, { value: 'zh', text: '中文' }]}
                      value={retryLanguage}
                      onChange={(event) => setRetryLanguage(event.target.value as 'en' | 'zh' | '')}
                    />
                  </EuiFormRow>
                )}
                {dto.error?.includes('No timed English or Chinese') &&
                  retrySource === 'existing_only' && (
                    <EuiCallOut color="warning" size="s" title={t.dramaRetryNoExistingSubtitle} />
                  )}
                <EuiSpacer size="s" />
              </>
            )}
            <EuiButton size="s" isLoading={retrying} onClick={() => void retry()}>
              {t.dramaRetryLabel}
            </EuiButton>
          </>
        )}
        <EuiSpacer size="s" />
        <EuiText size="s">
          <p>
            {t.dramaStatusLabel}: <strong>{dto.status}</strong>
          </p>
          {dto.run_id && (
            <p>
              {t.dramaResultRunId}: <code>{dto.run_id}</code>
            </p>
          )}
          <p>
            {t.dramaModulesLabel}: {(dto.modules ?? []).join(', ') || '—'}
            {(dto.modules_done?.length ?? 0) > 0 &&
              ` · done: ${dto.modules_done!.join(', ')}`}
          </p>
          <p>
            {t.dramaLanguagesLabel}: {(dto.languages ?? []).join(', ') || '—'}
          </p>
          {dto.subtitle_source && <p>{t.dramaSubtitleSource}: {dto.subtitle_source}</p>}
          {dto.source_language && <p>{t.dramaSpokenLanguage}: {dto.source_language}</p>}
          {dto.director_coverage && <p>{t.dramaDirectorCoverage}: {dto.director_coverage}</p>}
          {dto.synopsis_status && (
            <p>
              {t.dramaSynopsisStatus}: <strong>{dto.synopsis_status}</strong>
            </p>
          )}
          {dto.error && (
            <p style={{ color: '#BD271E' }}>{dto.error}</p>
          )}
        </EuiText>

        {detail?.previous_runs && detail.previous_runs.length > 0 && (
          <>
            <EuiSpacer size="m" />
            <EuiTitle size="xxs">
              <h3>{t.dramaResultPreviousRuns}</h3>
            </EuiTitle>
            <EuiSpacer size="s" />
            <ul>
              {detail.previous_runs.map((run) => (
                <li key={run.run_id}>
                  <EuiText size="s">
                    <code>{run.run_id}</code> · {run.status} · {(run.modules ?? []).join(', ')}
                  </EuiText>
                </li>
              ))}
            </ul>
          </>
        )}

        {detail && hasDetail && (
          <>
            {(detail.synopsis_zh || detail.synopsis_en) && (
              <>
                <EuiSpacer size="m" />
                <EuiTitle size="xxs">
                  <h3>{t.dramaResultSynopsis}</h3>
                </EuiTitle>
                {earlierRunNote(sources?.synopsis)}
                <EuiSpacer size="s" />
                {detail.synopsis_zh && (
                  <EuiText size="s">
                    <p>zh: {detail.synopsis_zh}</p>
                  </EuiText>
                )}
                {detail.synopsis_en && (
                  <EuiText size="s">
                    <p>en: {detail.synopsis_en}</p>
                  </EuiText>
                )}
              </>
            )}

            {detail.script_urls && (detail.script_urls.zh || detail.script_urls.en) && (
              <>
                <EuiSpacer size="m" />
                <EuiTitle size="xxs"><h3>{t.dramaModuleDirectors}</h3></EuiTitle>
                <EuiText size="s">
                  {detail.script_urls.zh && <p><a href={detail.script_urls.zh} target="_blank" rel="noopener noreferrer">zh script</a></p>}
                </EuiText>
                {detail.script_urls.zh && earlierRunNote(sources?.script_zh)}
                <EuiText size="s">
                  {detail.script_urls.en && <p><a href={detail.script_urls.en} target="_blank" rel="noopener noreferrer">en script</a></p>}
                </EuiText>
                {detail.script_urls.en && earlierRunNote(sources?.script_en)}
              </>
            )}

            {detail.structure && detail.structure.length > 0 && (
              <>
                <EuiSpacer size="m" />
                <EuiTitle size="xxs">
                  <h3>{t.dramaResultStructure}</h3>
                </EuiTitle>
                {earlierRunNote(sources?.structure)}
                <EuiSpacer size="s" />
                <ul>
                  {detail.structure.map((s, i) => (
                    <li key={i}>
                      <EuiText size="s">
                        <strong>{s.kind}</strong> · {s.start_ms}–{s.end_ms} ms
                        {s.source ? ` · ${s.source}` : ''}
                      </EuiText>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {detail.key_scenes && detail.key_scenes.length > 0 && (
              <>
                <EuiSpacer size="m" />
                <EuiTitle size="xxs">
                  <h3>{t.dramaResultKeyScenes}</h3>
                </EuiTitle>
                {earlierRunNote(sources?.key_scenes)}
                <EuiSpacer size="s" />
                <ul>
                  {detail.key_scenes.map((s, i) => (
                    <li key={i}>
                      <EuiText size="s">
                        {s.start_ms}–{s.end_ms} ms
                        {s.summary_zh ? ` · zh: ${s.summary_zh}` : ''}
                        {s.summary_en ? ` · en: ${s.summary_en}` : ''}
                        {s.thumb_url && <a href={s.thumb_url} target="_blank" rel="noopener noreferrer"> · thumbnail</a>}
                      </EuiText>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {detail.key_actors && detail.key_actors.length > 0 && (
              <>
                <EuiSpacer size="m" />
                <EuiTitle size="xxs">
                  <h3>{t.dramaResultKeyActors}</h3>
                </EuiTitle>
                {earlierRunNote(sources?.key_actors)}
                <EuiSpacer size="s" />
                <ul>
                  {detail.key_actors.map((a, i) => (
                    <li key={i}>
                      <EuiText size="s">
                        {a.role_zh}
                        {a.role_en ? ` · ${a.role_en}` : ''}
                        {!a.verified ? ' · (unverified)' : ''}
                        {a.thumb_url && <a href={a.thumb_url} target="_blank" rel="noopener noreferrer"> · face card</a>}
                      </EuiText>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {detail.subtitle_count != null && (
              <>
                <EuiSpacer size="m" />
                <EuiText size="s">
                  {t.dramaResultSubtitles}: {detail.subtitle_count}
                  {Object.entries(detail.subtitle_urls ?? {}).map(([lang, url]) => (
                    <p key={lang}>
                      <a href={url} target="_blank" rel="noopener noreferrer">
                        {t.dramaResultViewSubtitle.replace('{lang}', lang.toUpperCase())}
                      </a>
                      {subtitleSource(lang) && (
                        <EuiText size="xs" color="subdued" component="span">
                          {' · '}
                          {t.dramaResultFromEarlierRun.replace('{run}', subtitleSource(lang)!)}
                        </EuiText>
                      )}
                    </p>
                  ))}
                </EuiText>
              </>
            )}
          </>
        )}

        {detail && !hasDetail && (
          <>
            <EuiSpacer size="m" />
            <EuiText size="s" color="subdued">
              <p>{t.dramaResultNoDetail}</p>
            </EuiText>
          </>
        )}

        {!detail && !error && (
          <>
            <EuiSpacer size="m" />
            <EuiText size="s" color="subdued">
              <p>{t.dramaResultLoading}</p>
            </EuiText>
          </>
        )}
      </EuiFlyoutBody>
    </EuiFlyout>
  );
}
