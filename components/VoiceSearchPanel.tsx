'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { EuiButton, EuiButtonEmpty, EuiButtonGroup, EuiCallOut, EuiFilePicker, EuiFlexGroup, EuiFlexItem, EuiFormRow, EuiPanel, EuiSelect, EuiSpacer, EuiText, EuiTitle } from '@elastic/eui';
import { useLocale } from '@/lib/i18n/locale-context';
import { voiceMessages } from '@/lib/i18n/voice';
import { VoiceRecorder, type RecorderState } from '@/lib/voice/recorder';
import { VOICE_UPLOAD_MAX, type VoiceCapabilities, type VoiceLanguage, type VoiceMode, type VoiceMoments, type VoiceResponse } from '@/lib/voice/types';
import type { SearchModality } from '@/lib/es/search-core';
import { buildVoiceFormData } from '@/lib/voice/ui-request';

export function VoiceSearchPanel(props: {
  variantId: string; videoId: string; size: number; filters: unknown; scopeKey: string;
  mode: VoiceMode; target: SearchModality | null; onModeChange: (mode: VoiceMode) => void;
  onStart: () => number;
  onMoments: (result: VoiceMoments, token: number) => void;
  onTranscript: (text: string, token: number) => void;
  onClose: () => void;
}) {
  const { locale } = useLocale();
  const t = voiceMessages[locale];
  const { mode, target } = props;
  const [language, setLanguage] = useState<VoiceLanguage>('auto');
  const [capabilities, setCapabilities] = useState<VoiceCapabilities | null>(null);
  const [clip, setClip] = useState<Blob | null>(null);
  const [preview, setPreview] = useState('');
  const [state, setState] = useState<RecorderState>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const recorderRef = useRef<VoiceRecorder | null>(null);
  const mounted = useRef(true);
  const invalidate = useCallback(() => { sequence.current++; abortRef.current?.abort(); abortRef.current = null; setBusy(false); }, []);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    void fetch('/api/search/voice/capabilities', { signal: controller.signal, cache: 'no-store' })
      .then(async (res) => { if (!res.ok) throw new Error('Unavailable'); return res.json() as Promise<VoiceCapabilities>; })
      .then((data) => { if (mounted.current) setCapabilities(data); })
      .catch(() => { if (!controller.signal.aborted) setError(t.unavailable); });
    return () => { mounted.current = false; controller.abort(); sequence.current++; abortRef.current?.abort(); recorderRef.current?.dispose(); };
  }, [t.unavailable]);
  useEffect(() => {
    invalidate(); recorderRef.current?.dispose(); setState('idle');
  // Changing any parent query controls invalidates the pending upload/result.
  }, [props.scopeKey, invalidate]);
  useEffect(() => {
    if (!clip) { setPreview(''); return; }
    const url = URL.createObjectURL(clip); setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [clip]);

  const start = () => {
    invalidate(); setClip(null); setError(null);
    recorderRef.current?.dispose();
    recorderRef.current = new VoiceRecorder({
      state: (next, ms) => { if (mounted.current) { setState(next); setElapsed(ms); } },
      clip: (next) => { if (mounted.current) setClip(next); },
      error: (reason) => { if (mounted.current) setError(reason === 'too_large' ? t.tooLarge : t.captureError); },
    });
    void recorderRef.current.start(mode);
  };
  const submit = async () => {
    if (!clip) return;
    if (mode === 'sound_sample' && (!props.variantId || props.filters === undefined)) { setError(t.invalidFilters); return; }
    let form: FormData;
    if (mode === 'spoken_request') form = buildVoiceFormData(clip, { mode, language });
    else {
      if (!target || !capabilities?.sound_sample.targets.includes(target)) { setError(t.targetUnavailable); return; }
      form = buildVoiceFormData(clip, { mode, target, variantId: props.variantId, size: props.size, videoId: props.videoId, filters: props.filters });
    }
    invalidate(); setError(null); setBusy(true);
    const current = sequence.current;
    const token = props.onStart();
    const controller = new AbortController(); abortRef.current = controller;
    const timeout = setTimeout(() => controller.abort(), 35000);
    try {
      const res = await fetch('/api/search/voice', { method: 'POST', body: form, signal: controller.signal });
      const data: VoiceResponse & { error?: { message: string } } = await res.json();
      if (current !== sequence.current || !mounted.current) return;
      if (!res.ok) throw new Error(data.error?.message ?? t.failed);
      if (data.kind === 'moments') props.onMoments(data, token);
      else if (data.kind === 'transcript' && typeof data.transcript === 'string') props.onTranscript(data.transcript, token);
      else throw new Error(t.failed);
    } catch (err) {
      if (current === sequence.current && mounted.current) setError(err instanceof Error && !controller.signal.aborted ? err.message : t.failed);
    } finally {
      clearTimeout(timeout);
      if (current === sequence.current && mounted.current) { setBusy(false); abortRef.current = null; }
    }
  };
  const available = Boolean(capabilities?.[mode].available);
  const targetAvailable = mode === 'spoken_request' || Boolean(target && capabilities?.sound_sample.targets.includes(target));
  const capturing = state === 'recording' || state === 'requesting_permission';
  return <EuiPanel paddingSize="m" hasBorder>
    <EuiFlexGroup justifyContent="spaceBetween" alignItems="center">
      <EuiFlexItem><EuiTitle size="xs"><h2>{t.title}</h2></EuiTitle></EuiFlexItem>
      <EuiFlexItem grow={false}><EuiButtonEmpty onClick={() => { invalidate(); recorderRef.current?.dispose(); props.onClose(); }}>{t.cancel}</EuiButtonEmpty></EuiFlexItem>
    </EuiFlexGroup>
    <EuiSpacer size="s" />
    <EuiButtonGroup legend={t.title} idSelected={mode} options={[{ id: 'sound_sample', label: t.sample }, { id: 'spoken_request', label: t.spoken }]}
      onChange={(id) => { invalidate(); recorderRef.current?.dispose(); setState('idle'); setError(null); props.onModeChange(id as VoiceMode); }} />
    <EuiSpacer size="s" />
    <EuiText size="s"><p>{mode === 'sound_sample' ? t.sampleHint : t.spokenHint}</p><p>{t.limits}</p></EuiText>
    {capabilities && !available && <><EuiSpacer size="s" /><EuiCallOut size="s" color="warning" title={capabilities.enabled ? t.unavailable : t.disabled} /></>}
    {available && !targetAvailable && <><EuiSpacer size="s" /><EuiCallOut size="s" color="warning" title={t.targetUnavailable} /></>}
    {available && <><EuiSpacer size="s" /><EuiText size="xs"><p>{t.destination} {capabilities?.[mode].destination}.</p></EuiText></>}
    <EuiSpacer size="s" />
    {mode === 'spoken_request' && <EuiFormRow label={t.language}><EuiSelect value={language} options={(capabilities?.spoken_request.languages ?? ['auto']).map((value) => ({ value, text: value === 'auto' ? t.auto : value }))}
        onChange={(e) => { invalidate(); setLanguage(e.target.value as VoiceLanguage); }} /></EuiFormRow>}
    <EuiSpacer size="m" />
    <EuiFlexGroup alignItems="center" gutterSize="s">
      <EuiFlexItem grow={false}><EuiButton disabled={!available || busy || state === 'requesting_permission'} onClick={state === 'recording' ? () => recorderRef.current?.stop() : start}>
        {state === 'recording' ? t.stop : clip ? t.retry : t.record}</EuiButton></EuiFlexItem>
      <EuiFlexItem><EuiText size="s"><span role="status" aria-live="polite">{state === 'requesting_permission' ? t.waiting : state === 'recording' ? `${t.recording} ${(elapsed / 1000).toFixed(1)}s` : busy ? t.processing : ''}</span></EuiText></EuiFlexItem>
    </EuiFlexGroup>
    <EuiSpacer size="s" />
    <EuiFormRow label={t.upload}><EuiFilePicker initialPromptText={t.upload} accept="audio/*,.webm,.ogg,.mp4,.m4a,.wav,.mp3,.flac" disabled={busy || capturing || !available}
      onChange={(files) => { const file = files?.[0]; invalidate(); recorderRef.current?.dispose();
        if (!file) { setClip(null); setState('idle'); setError(null); return; }
        setState('preview');
        if (file.size > VOICE_UPLOAD_MAX) { setError(t.tooLarge); setClip(null); } else { setError(null); setClip(file); } }} /></EuiFormRow>
    {preview && <><EuiSpacer size="s" /><audio controls src={preview} aria-label={t.preview} /></>}
    {error && <><EuiSpacer size="s" /><EuiCallOut color="danger" size="s" title={error} /></>}
    <EuiSpacer size="s" />
    <EuiButton fill data-voice-target={mode === 'sound_sample' ? target ?? '' : undefined} isLoading={busy} disabled={!available || !targetAvailable || !clip || capturing || (mode === 'sound_sample' && (!props.variantId || props.filters === undefined))} onClick={() => void submit()}>
      {mode === 'sound_sample' ? t.search : t.transcribe}</EuiButton>
  </EuiPanel>;
}
