'use client';

import {
  EuiButton,
  EuiButtonEmpty,
  EuiCallOut,
  EuiComboBox,
  type EuiComboBoxOptionOption,
  EuiFlyout,
  EuiFlyoutBody,
  EuiFlyoutFooter,
  EuiFlyoutHeader,
  EuiForm,
  EuiFormRow,
  EuiRadioGroup,
  EuiSelect,
  EuiSpacer,
  EuiText,
  EuiTitle,
} from '@elastic/eui';
import { useState } from 'react';
import { useLocale } from '@/lib/i18n/locale-context';

type SubtitleSource = 'auto' | 'existing_only' | 'force_asr';

export function DramaStartFlyout({
  videoId,
  title,
  onClose,
  onStarted,
}: {
  videoId: string;
  title?: string;
  onClose: () => void;
  onStarted: () => void;
}) {
  const { t, locale } = useLocale();
  const [modules, setModules] = useState<EuiComboBoxOptionOption[]>([]);
  const [languages, setLanguages] = useState<EuiComboBoxOptionOption[]>([]);
  const [subtitleSource, setSubtitleSource] = useState<SubtitleSource>('auto');
  const [sourceLanguage, setSourceLanguage] = useState<'en' | 'zh' | ''>('');
  const [clientError, setClientError] = useState<string | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const moduleOptions: EuiComboBoxOptionOption[] = [
    { label: t.dramaModuleSubtitles, value: 'subtitles' },
    { label: t.dramaModuleStructure, value: 'structure' },
    { label: t.dramaModuleDirectors, value: 'directors_script' },
    { label: t.dramaModuleKeyActors, value: 'key_actors' },
    { label: t.dramaModuleKeyScenes, value: 'key_scenes' },
  ];

  const languageOptions: EuiComboBoxOptionOption[] = [
    { label: 'zh', value: 'zh' },
    { label: 'en', value: 'en' },
    { label: 'ko', value: 'ko' },
    { label: 'th', value: 'th' },
  ];

  const selectedModules = modules.map((o) => String(o.value ?? o.label));
  const hasSubtitles = selectedModules.includes('subtitles');
  const bilingual = hasSubtitles && languages.some((o) => o.value === 'en') && languages.some((o) => o.value === 'zh');

  const subtitleSourceOptions = [
    { id: 'auto', label: t.dramaSubtitleSourceAuto },
    { id: 'existing_only', label: t.dramaSubtitleSourceExisting },
    { id: 'force_asr', label: t.dramaSubtitleSourceForceAsr },
  ];

  const start = async () => {
    setClientError(null);
    setApiError(null);
    if (selectedModules.length === 0) {
      setClientError(t.dramaNoModulesError);
      return;
    }
    if (
      selectedModules.includes('key_actors') &&
      !selectedModules.includes('directors_script')
    ) {
      setClientError(t.dramaNeedDirectorsForActors);
      return;
    }
    if (hasSubtitles && languages.length === 0) {
      setClientError(t.dramaNeedLanguageForSubtitles);
      return;
    }
    if (bilingual && subtitleSource !== 'existing_only' && !sourceLanguage) {
      setClientError(t.dramaSpokenLanguageRequired);
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/library/${encodeURIComponent(videoId)}/drama`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept-Language': locale,
          },
          body: JSON.stringify({
            languages: languages.map((o) => String(o.value ?? o.label)),
            modules: selectedModules,
            subtitle_source: subtitleSource,
            ...(bilingual && sourceLanguage ? { source_language: sourceLanguage } : {}),
            // P4: only `sampled` is offered; `full` is never selectable.
            director_coverage: 'sampled',
          }),
        },
      );
      const data = (await res.json()) as { error?: { message: string } };
      if (!res.ok) {
        throw new Error(data.error?.message ?? t.libraryError);
      }
      onStarted();
      onClose();
    } catch (err) {
      setApiError(err instanceof Error ? err.message : t.libraryError);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <EuiFlyout
      ownFocus
      onClose={onClose}
      size="s"
      aria-labelledby="drama-start-flyout"
    >
      <EuiFlyoutHeader hasBorder>
        <EuiTitle size="s">
          <h2 id="drama-start-flyout">{t.dramaStartTitle}</h2>
        </EuiTitle>
        <EuiText size="s" color="subdued">
          <p>{title || videoId}</p>
        </EuiText>
      </EuiFlyoutHeader>
      <EuiFlyoutBody>
        <EuiForm component="form" onSubmit={(e) => e.preventDefault()} fullWidth>
          <EuiFormRow label={t.dramaModulesLabel} helpText={t.dramaModulesHelp}>
            <EuiComboBox
              options={moduleOptions}
              selectedOptions={modules}
              onChange={setModules}
              aria-label={t.dramaModulesLabel}
            />
          </EuiFormRow>
          {hasSubtitles && (
            <>
              <EuiFormRow
                label={t.dramaLanguagesLabel}
                helpText={t.dramaLanguagesHelp}
              >
                <EuiComboBox
                  options={languageOptions}
                  selectedOptions={languages}
                  onChange={setLanguages}
                  aria-label={t.dramaLanguagesLabel}
                />
              </EuiFormRow>
              <EuiFormRow label={t.dramaSubtitleSource}>
                <EuiRadioGroup
                  options={subtitleSourceOptions}
                  idSelected={subtitleSource}
                  onChange={(id) => setSubtitleSource(id as SubtitleSource)}
                  name="drama-subtitle-source"
                />
              </EuiFormRow>
              {bilingual && (
                <EuiFormRow label={t.dramaSpokenLanguage} helpText={t.dramaSpokenLanguageHelp}>
                  <EuiSelect
                    options={[{ value: '', text: '—' }, { value: 'en', text: 'English' }, { value: 'zh', text: '中文' }]}
                    value={sourceLanguage}
                    onChange={(event) => setSourceLanguage(event.target.value as 'en' | 'zh' | '')}
                    aria-label={t.dramaSpokenLanguage}
                  />
                </EuiFormRow>
              )}
            </>
          )}
          <EuiFormRow label={t.dramaDirectorCoverage}>
            <EuiText size="s" color="subdued">
              <p>{t.dramaDirectorCoverageSampled}</p>
            </EuiText>
          </EuiFormRow>
        </EuiForm>
        {clientError && (
          <>
            <EuiSpacer size="s" />
            <EuiCallOut color="warning" size="s" title={clientError} />
          </>
        )}
        {apiError && (
          <>
            <EuiSpacer size="s" />
            <EuiCallOut color="danger" size="s" title={apiError} />
          </>
        )}
      </EuiFlyoutBody>
      <EuiFlyoutFooter>
        <EuiButtonEmpty onClick={onClose} disabled={submitting}>
          {t.cancelConfirm}
        </EuiButtonEmpty>
        <EuiButton fill onClick={() => void start()} isLoading={submitting}>
          {t.dramaStartAction}
        </EuiButton>
      </EuiFlyoutFooter>
    </EuiFlyout>
  );
}
