'use client';

import {
  EuiButtonEmpty,
  EuiDescriptionList,
  EuiFlyout,
  EuiFlyoutBody,
  EuiFlyoutHeader,
  EuiSpacer,
  EuiText,
  EuiTitle,
} from '@elastic/eui';
import { useLocale } from '@/lib/i18n/locale-context';

export type SearchExplainPayload = {
  /** Exact JSON body sent to POST /api/search */
  request: Record<string, unknown>;
  /** Response `meta` from the search API */
  meta: Record<string, unknown>;
};

type Props = {
  data: SearchExplainPayload;
  onClose: () => void;
};

function summarize(
  data: SearchExplainPayload,
  labels: {
    none: string;
    hybridOn: string;
    hybridOff: string;
    filtersNone: string;
  },
): Array<{ title: string; description: string }> {
  const req = data.request;
  const meta = data.meta;
  const hybrid = meta.hybrid as { use_text?: boolean; parse_query?: boolean } | null;
  const filters = meta.filters as Record<string, unknown> | null;
  const filterStats = meta.filter as {
    eligible_assets?: number;
    filters_applied?: boolean;
  } | null;
  const branch = meta.branch as Record<string, unknown> | null;
  const parse = meta.parse as Record<string, unknown> | null;

  const filterKeys =
    filters && typeof filters === 'object' ? Object.keys(filters) : [];
  const hasFilters = filterKeys.length > 0;

  const rows: Array<{ title: string; description: string }> = [
    {
      title: 'query',
      description: String(req.query ?? ''),
    },
    {
      title: 'mode',
      description: hybrid?.use_text ? labels.hybridOn : labels.hybridOff,
    },
    {
      title: 'modality / sort_by',
      description: `${String(meta.modality ?? req.modality)} / ${String(meta.sort_by ?? req.sort_by)}`,
    },
    {
      title: 'variant_id',
      description: String(meta.variant_id ?? req.variant_id ?? '—'),
    },
    {
      title: 'filters',
      description: hasFilters
        ? JSON.stringify(filters)
        : labels.filtersNone,
    },
    {
      title: 'eligible_assets',
      description:
        filterStats?.eligible_assets != null
          ? String(filterStats.eligible_assets)
          : labels.none,
    },
    {
      title: 'text_channel',
      description: String(meta.text_channel_status ?? 'disabled'),
    },
    {
      title: 'ranking_strategy',
      description: String(meta.ranking_strategy ?? labels.none),
    },
  ];

  if (parse && parse.parser && parse.parser !== 'disabled') {
    rows.push({
      title: 'parse',
      description: `parser=${String(parse.parser)}; vector_query=${JSON.stringify(parse.vector_query)}; free_text=${JSON.stringify(parse.free_text)}`,
    });
  }

  if (branch) {
    const parts = [
      branch.lexical_assets != null
        ? `lexical_assets=${branch.lexical_assets}`
        : null,
      branch.lexical_chunks != null
        ? `lexical_chunks=${branch.lexical_chunks}`
        : null,
      branch.semantic_assets != null
        ? `semantic_assets=${branch.semantic_assets}`
        : null,
      branch.es_http_requests != null
        ? `es_http=${branch.es_http_requests}`
        : null,
      branch.embed_ms != null ? `embed_ms=${branch.embed_ms}` : null,
      branch.bm25_ms != null ? `bm25_ms=${branch.bm25_ms}` : null,
      branch.knn_global_ms != null
        ? `knn_global_ms=${branch.knn_global_ms}`
        : null,
      meta.took_ms != null ? `took_ms=${meta.took_ms}` : null,
    ].filter(Boolean);
    if (parts.length) {
      rows.push({ title: 'branch', description: parts.join(' · ') });
    }
  }

  const queryDsl = meta.query_dsl as
    | {
        status?: string;
        bm25_query?: string;
        vector_query?: string;
        reason?: string;
      }
    | null
    | undefined;
  if (queryDsl && typeof queryDsl === 'object') {
    rows.push({
      title: 'query_dsl',
      description: [
        `status=${String(queryDsl.status ?? '—')}`,
        queryDsl.reason ? `reason=${queryDsl.reason}` : null,
        queryDsl.bm25_query != null
          ? `bm25=${JSON.stringify(queryDsl.bm25_query)}`
          : null,
        queryDsl.vector_query != null
          ? `vector=${JSON.stringify(queryDsl.vector_query)}`
          : null,
      ]
        .filter(Boolean)
        .join('; '),
    });
  }

  return rows;
}

/** Flyout showing the last search request + response meta (executed query). */
export function SearchQueryExplainFlyout({ data, onClose }: Props) {
  const { t } = useLocale();
  const rows = summarize(data, {
    none: '—',
    hybridOn: t.queryExplainHybridOn,
    hybridOff: t.queryExplainHybridOff,
    filtersNone: t.queryExplainFiltersNone,
  });

  return (
    <EuiFlyout ownFocus onClose={onClose} size="m" aria-labelledby="query-explain">
      <EuiFlyoutHeader hasBorder>
        <EuiTitle size="s">
          <h2 id="query-explain">{t.queryExplainTitle}</h2>
        </EuiTitle>
        <EuiText size="s" color="subdued">
          <p>{t.queryExplainHelp}</p>
        </EuiText>
      </EuiFlyoutHeader>
      <EuiFlyoutBody>
        <EuiDescriptionList
          compressed
          type="column"
          listItems={rows}
          titleProps={{ style: { width: '28%' } }}
        />
        <EuiSpacer size="m" />
        <EuiText size="xs" color="subdued">
          <p>{t.queryExplainRaw}</p>
        </EuiText>
        <EuiSpacer size="s" />
        <EuiText size="s">
          <pre
            style={{
              whiteSpace: 'pre-wrap',
              margin: 0,
              maxHeight: 420,
              overflow: 'auto',
              fontSize: 12,
            }}
          >
            {JSON.stringify(
              { request: data.request, meta: data.meta },
              null,
              2,
            )}
          </pre>
        </EuiText>
        <EuiSpacer size="m" />
        <EuiButtonEmpty flush="left" onClick={onClose}>
          {t.cancelConfirm}
        </EuiButtonEmpty>
      </EuiFlyoutBody>
    </EuiFlyout>
  );
}
