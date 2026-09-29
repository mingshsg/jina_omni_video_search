'use client';

import {
  EuiComboBox,
  type EuiComboBoxOptionOption,
  EuiFieldNumber,
  EuiFieldText,
  EuiFlexGroup,
  EuiFlexItem,
  EuiFormRow,
  EuiSelect,
} from '@elastic/eui';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale } from '@/lib/i18n/locale-context';
import {
  EMPTY_FACETS,
  facetsToApiFilters,
  type SearchFacetState,
} from '@/lib/metadata/facets-ui';

const CreatableGroupCombo = dynamic(
  () =>
    import('@/components/CreatableGroupCombo').then(
      (m) => m.CreatableGroupCombo,
    ),
  { ssr: false },
);

export {
  EMPTY_FACETS,
  facetsToApiFilters,
  type SearchFacetState,
  type FacetsToApiResult,
} from '@/lib/metadata/facets-ui';

type Catalogs = {
  video_types: string[];
  primary_languages: string[];
  countries: Array<{ code: string; label: string }>;
  groups: Array<{ id: string; label: string }>;
  people: Array<{ id: string; display: string }>;
};

type Props = {
  value: SearchFacetState;
  onChange: (next: SearchFacetState) => void;
};

export function SearchFacets({ value, onChange }: Props) {
  const { t, locale } = useLocale();
  const [catalogs, setCatalogs] = useState<Catalogs | null>(null);
  const [actorOptions, setActorOptions] = useState<EuiComboBoxOptionOption[]>(
    [],
  );
  const [groupOptions, setGroupOptions] = useState<EuiComboBoxOptionOption[]>(
    [],
  );

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/metadata/catalogs?locale=${locale}`);
        const data = (await res.json()) as Catalogs;
        if (res.ok) {
          setCatalogs(data);
          setActorOptions(
            data.people.map((p) => ({ label: p.display, value: p.id })),
          );
          setGroupOptions(
            (data.groups ?? []).map((g) => ({
              label: g.label,
              value: g.id,
            })),
          );
        }
      } catch {
        /* ignore */
      }
    })();
  }, [locale]);

  const onActorSearch = useCallback(
    async (q: string) => {
      try {
        const res = await fetch(
          `/api/metadata/catalogs?locale=${locale}&q=${encodeURIComponent(q)}`,
        );
        const data = (await res.json()) as Catalogs;
        if (res.ok) {
          setActorOptions(
            data.people.map((p) => ({ label: p.display, value: p.id })),
          );
        }
      } catch {
        /* ignore */
      }
    },
    [locale],
  );

  const empty = useMemo(
    () => [{ value: '', text: t.metaEmptyOption }],
    [t.metaEmptyOption],
  );

  if (!catalogs) return null;

  return (
    <EuiFlexGroup gutterSize="s" wrap>
      <EuiFlexItem grow={false} style={{ minWidth: 100 }}>
        <EuiFormRow label={t.facetYearFrom}>
          <EuiFieldNumber
            compressed
            value={value.year_from}
            onChange={(e) =>
              onChange({ ...value, year_from: e.target.value })
            }
            placeholder="YYYY"
          />
        </EuiFormRow>
      </EuiFlexItem>
      <EuiFlexItem grow={false} style={{ minWidth: 100 }}>
        <EuiFormRow label={t.facetYearTo}>
          <EuiFieldNumber
            compressed
            value={value.year_to}
            onChange={(e) => onChange({ ...value, year_to: e.target.value })}
            placeholder="YYYY"
          />
        </EuiFormRow>
      </EuiFlexItem>
      <EuiFlexItem grow={false} style={{ minWidth: 160 }}>
        <EuiFormRow label={t.metaCountry}>
          <EuiSelect
            compressed
            options={[
              ...empty,
              ...catalogs.countries.map((c) => ({
                value: c.code,
                text: c.label,
              })),
            ]}
            value={value.country}
            onChange={(e) => onChange({ ...value, country: e.target.value })}
          />
        </EuiFormRow>
      </EuiFlexItem>
      <EuiFlexItem grow={false} style={{ minWidth: 160 }}>
        <EuiFormRow label={t.metaGroup} helpText={t.metaGroupHelp}>
          <CreatableGroupCombo
            compressed
            placeholder={t.metaGroup}
            options={groupOptions}
            selectedOptions={
              value.group_id
                ? [
                    {
                      label:
                        groupOptions.find(
                          (o) => String(o.value) === value.group_id,
                        )?.label ?? value.group_id,
                      value: value.group_id,
                    },
                  ]
                : []
            }
            onChange={(opts) => {
              const next = opts[0];
              onChange({
                ...value,
                group_id: next ? String(next.value ?? next.label) : '',
              });
            }}
            onCreateOption={(searchValue) => {
              const normalized = searchValue.trim().replace(/\s+/g, ' ');
              if (!normalized || normalized.length > 64) return false;
              const opt = { label: normalized, value: normalized };
              setGroupOptions((prev) =>
                prev.some((o) => String(o.value) === normalized)
                  ? prev
                  : [...prev, opt],
              );
              onChange({ ...value, group_id: normalized });
              return true;
            }}
            aria-label={t.metaGroup}
          />
        </EuiFormRow>
      </EuiFlexItem>
      <EuiFlexItem grow={false} style={{ minWidth: 140 }}>
        <EuiFormRow label={t.metaVideoType}>
          <EuiSelect
            compressed
            options={[
              ...empty,
              ...catalogs.video_types.map((v) => ({ value: v, text: v })),
            ]}
            value={value.video_type}
            onChange={(e) =>
              onChange({ ...value, video_type: e.target.value })
            }
          />
        </EuiFormRow>
      </EuiFlexItem>
      <EuiFlexItem grow={false} style={{ minWidth: 120 }}>
        <EuiFormRow label={t.metaLanguage}>
          <EuiSelect
            compressed
            options={[
              ...empty,
              ...catalogs.primary_languages.map((v) => ({
                value: v,
                text: v,
              })),
            ]}
            value={value.primary_language}
            onChange={(e) =>
              onChange({ ...value, primary_language: e.target.value })
            }
          />
        </EuiFormRow>
      </EuiFlexItem>
      <EuiFlexItem grow={2} style={{ minWidth: 200 }}>
        <EuiFormRow label={t.metaActors}>
          <EuiComboBox
            compressed
            options={actorOptions}
            selectedOptions={value.actor_ids}
            onChange={(opts) => onChange({ ...value, actor_ids: opts })}
            onSearchChange={(q) => void onActorSearch(q)}
            isClearable
          />
        </EuiFormRow>
      </EuiFlexItem>
      <EuiFlexItem grow={1} style={{ minWidth: 140 }}>
        <EuiFormRow label={t.metaTags} helpText={t.metaTagsHelp}>
          <EuiFieldText
            compressed
            value={value.tags}
            onChange={(e) => onChange({ ...value, tags: e.target.value })}
          />
        </EuiFormRow>
      </EuiFlexItem>
    </EuiFlexGroup>
  );
}
