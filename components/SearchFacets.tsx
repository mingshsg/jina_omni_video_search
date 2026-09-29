'use client';

import {
  EuiComboBox,
  type EuiComboBoxOptionOption,
  EuiFieldNumber,
  EuiFieldText,
  EuiFlexGroup,
  EuiFlexItem,
  EuiFormRow,
  EuiIconTip,
  EuiSelect,
} from '@elastic/eui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale } from '@/lib/i18n/locale-context';
import {
  EMPTY_FACETS,
  facetsToApiFilters,
  type SearchFacetState,
} from '@/lib/metadata/facets-ui';
import { peopleCatalogUnavailable } from '@/lib/metadata/catalogs-status';

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
  people: Array<{ id: string; display: string }>;
  /** todo/40 R4 — `unavailable` means the empty `people` is a failure. */
  people_status?: 'ok' | 'unavailable';
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
  // todo/40 R4: a person-catalog failure must be visible, not a silently empty
  // actor list. `people_status: 'unavailable'` is the explicit signal.
  const [actorsUnavailable, setActorsUnavailable] = useState(false);

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
          setActorsUnavailable(peopleCatalogUnavailable(data));
        } else {
          setActorsUnavailable(true);
        }
      } catch {
        setActorsUnavailable(true);
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
        if (res.ok && !peopleCatalogUnavailable(data)) {
          setActorOptions(
            data.people.map((p) => ({ label: p.display, value: p.id })),
          );
        }
      } catch {
        /* autocomplete is best-effort; the explicit notice already shows */
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
        <EuiFormRow
          label={
            <>
              {t.metaActors}{' '}
              {actorsUnavailable && (
                <EuiIconTip
                  type="warning"
                  color="warning"
                  content={t.metaActorsUnavailable}
                  position="top"
                  aria-label={t.metaActorsUnavailable}
                />
              )}
            </>
          }
        >
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
