'use client';

import {
  EuiComboBox,
  type EuiComboBoxOptionOption,
  EuiFormRow,
} from '@elastic/eui';
import { useEffect, useMemo, useState } from 'react';
import { useLocale } from '@/lib/i18n/locale-context';
import { selectedSearchGroupIds } from '@/lib/metadata/group-filter-ui';

type GroupEntry = { id: string; label: string };

export function SearchGroupFilter({
  selectedIds,
  onChange,
}: {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const { t, locale } = useLocale();
  const [groups, setGroups] = useState<GroupEntry[]>([]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const res = await fetch(`/api/metadata/catalogs?locale=${locale}`);
        const data = (await res.json()) as { groups?: GroupEntry[] };
        if (active && res.ok) setGroups(data.groups ?? []);
      } catch {
        // All remains usable if the catalog is unavailable.
      }
    })();
    return () => { active = false; };
  }, [locale]);

  const options = useMemo<EuiComboBoxOptionOption[]>(() => [
    { label: t.groupFilterAll, value: '' },
    ...groups.map((group) => ({ label: group.label, value: group.id })),
  ], [groups, t.groupFilterAll]);
  const selectedOptions = selectedIds.map((id) => ({
    label: groups.find((group) => group.id === id)?.label ?? id,
    value: id,
  }));

  return (
    <EuiFormRow label={t.groupFilterLabel} fullWidth>
      <EuiComboBox
        fullWidth
        placeholder={t.groupFilterAll}
        options={options}
        selectedOptions={selectedOptions}
        onChange={(next) => onChange(selectedSearchGroupIds(next))}
        isClearable
        aria-label={t.groupFilterLabel}
      />
    </EuiFormRow>
  );
}
