/**
 * Display-only projection of `meta.work_title` for the library list.
 *
 * Kept as a pure, dependency-free function so the client component
 * (`app/library/page.tsx`) and the Vitest suite can both use it — Vitest only
 * includes `lib/**` and `worker/**` (see `vitest.config.ts`), so the tested
 * logic must not live in the component.
 *
 * `work_title` is the actual production title (English, optional Chinese, and
 * optional native script); the ingest-owned `title` — a filename — stays the
 * primary cell value and is not replaced by these lines.
 */
import type { WorkTitle } from './validate';

/**
 * One line per available title variant, stable order: `en`, `zh`, then
 * `native.name (native.lang)`. Missing/blank variants are omitted, so an
 * absent `work_title` yields `[]` and callers can skip the tooltip entirely.
 *
 * Field access is defensive on purpose: the value comes from an Elasticsearch
 * `_source` document typed at compile time, not validated at read time, so a
 * legacy or hand-written document may not match `WorkTitle`.
 */
export function workTitleTooltipLines(
  workTitle: WorkTitle | null | undefined,
): string[] {
  if (!workTitle || typeof workTitle !== 'object') return [];
  const lines: string[] = [];

  const en = typeof workTitle.en === 'string' ? workTitle.en.trim() : '';
  if (en) lines.push(en);

  const zh = typeof workTitle.zh === 'string' ? workTitle.zh.trim() : '';
  if (zh) lines.push(zh);

  const native = workTitle.native;
  if (native && typeof native === 'object') {
    const name = typeof native.name === 'string' ? native.name.trim() : '';
    const lang = typeof native.lang === 'string' ? native.lang.trim() : '';
    if (name) lines.push(lang ? `${name} (${lang})` : name);
  }

  return lines;
}
