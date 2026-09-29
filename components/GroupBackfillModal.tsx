'use client';

import dynamic from 'next/dynamic';
import {
  EuiCallOut,
  type EuiComboBoxOptionOption,
  EuiConfirmModal,
  EuiFormRow,
  EuiSpacer,
} from '@elastic/eui';
import { useCallback, useEffect, useState } from 'react';
import { useLocale } from '@/lib/i18n/locale-context';

const CreatableGroupCombo = dynamic(
  () =>
    import('@/components/CreatableGroupCombo').then(
      (module) => module.CreatableGroupCombo,
    ),
  { ssr: false },
);

export function GroupBackfillModal({
  videoId,
  title,
  suggestedGroup,
  onClose,
  onSaved,
  onConflict,
}: {
  videoId: string;
  title: string;
  suggestedGroup?: 'trailer' | 'demo';
  onClose: () => void;
  onSaved: (groupId: string) => void;
  onConflict: () => void;
}) {
  const { t, locale } = useLocale();
  const [options, setOptions] = useState<EuiComboBoxOptionOption[]>([]);
  const [selected, setSelected] = useState<EuiComboBoxOptionOption[]>(
    suggestedGroup ? [{ label: suggestedGroup, value: suggestedGroup }] : [],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const res = await fetch(`/api/metadata/catalogs?locale=${locale}`);
        const data = (await res.json()) as {
          groups?: Array<{ id: string; label: string }>;
        };
        if (active && res.ok && data.groups) {
          setOptions(data.groups.map((g) => ({ label: g.label, value: g.id })));
        }
      } catch {
        // New group entry remains available when the catalog is unavailable.
      }
    })();
    return () => { active = false; };
  }, [locale]);

  const onCreateOption = useCallback((raw: string) => {
    const value = raw.normalize('NFKC').trim().replace(/\s+/g, ' ');
    if (!value || value.length > 64) return false;
    const option = { label: value, value };
    setOptions((previous) =>
      previous.some((item) => String(item.value ?? item.label) === value)
        ? previous
        : [...previous, option],
    );
    setSelected([option]);
    return true;
  }, []);

  const groupId = selected[0]
    ? String(selected[0].value ?? selected[0].label)
    : '';

  const submit = async () => {
    if (!groupId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/library/${encodeURIComponent(videoId)}/group/backfill`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept-Language': locale,
          },
          body: JSON.stringify({ group_id: groupId }),
        },
      );
      if (!res.ok) {
        if (res.status === 409) onConflict();
        throw new Error(res.status === 409
          ? t.backfillGroupChanged
          : t.libraryError);
      }
      const data = (await res.json()) as { group_id: string };
      onSaved(data.group_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.libraryError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <EuiConfirmModal
      title={t.actionBackfillGroup}
      onCancel={() => { if (!busy) onClose(); }}
      onConfirm={() => void submit()}
      cancelButtonText={t.cancelConfirm}
      confirmButtonText={t.actionBackfillGroup}
      confirmButtonDisabled={!groupId || busy}
      defaultFocusedButton="cancel"
      isLoading={busy}
    >
      <p>{t.backfillGroupConfirm.replace('{title}', title)}</p>
      <EuiSpacer size="m" />
      <EuiFormRow label={t.metaGroup} helpText={t.groupHelp} fullWidth>
        <CreatableGroupCombo
          placeholder={t.metaGroup}
          options={options}
          selectedOptions={selected}
          onChange={setSelected}
          onCreateOption={onCreateOption}
          isDisabled={busy}
          fullWidth
          aria-label={t.metaGroup}
        />
      </EuiFormRow>
      {error && (
        <>
          <EuiSpacer size="s" />
          <EuiCallOut color="danger" size="s" title={error} />
        </>
      )}
    </EuiConfirmModal>
  );
}
