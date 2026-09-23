/**
 * Minimal labeled parse set for over-trigger evaluation (Phase 3.6).
 * Metric: wrongly applied facet / total cases — not accuracy.
 */
export type ParseEvalExpected = {
  actor_ids?: string[] | null;
  country?: string[] | null;
  video_type?: string[] | null;
  year_from?: number | null;
  year_to?: number | null;
  /** When true, any non-empty extracted facet is an over-trigger. */
  expect_no_facets?: boolean;
};

export type ParseEvalCase = {
  id: string;
  query: string;
  expected: ParseEvalExpected;
};

export const PARSE_EVAL_CASES: ParseEvalCase[] = [
  { id: 'exact-alias', query: 'Audrey Hepburn', expected: { actor_ids: ['person:audrey-hepburn'] } },
  { id: 'name-scene', query: 'Audrey Hepburn running', expected: { actor_ids: ['person:audrey-hepburn'] } },
  { id: 'ko-alias', query: '이정재', expected: { actor_ids: ['person:lee-jung-jae'] } },
  { id: 'zh-alias', query: '李政宰', expected: { actor_ids: ['person:lee-jung-jae'] } },
  { id: 'pure-scene', query: 'person running through rain', expected: { expect_no_facets: true } },
  { id: 'store-window', query: 'in a store window', expected: { expect_no_facets: true } },
  { id: 'korean-trailer', query: 'Korean trailer', expected: { country: ['KR'], video_type: ['trailer'] } },
  { id: 'decade', query: '1960s fashion', expected: { year_from: 1960, year_to: 1969 } },
  { id: 'year-only', query: 'film from 1961', expected: { year_from: 1961, year_to: 1961 } },
  { id: 'us-movie', query: 'American movie', expected: { country: ['US'], video_type: ['movie'] } },
  { id: 'jp-doc', query: 'Japanese documentary', expected: { country: ['JP'], video_type: ['documentary'] } },
  { id: 'interview-scene', query: 'street interview at night', expected: { video_type: ['interview'] } },
  { id: 'gong-yoo', query: 'Gong Yoo', expected: { actor_ids: ['person:gong-yoo'] } },
  { id: 'song-kang-ho', query: '송강호', expected: { actor_ids: ['person:song-kang-ho'] } },
  { id: 'zhang-ziyi', query: '章子怡', expected: { actor_ids: ['person:zhang-ziyi'] } },
  { id: 'hk-region', query: 'Hong Kong cinema', expected: { country: ['HK'] } },
  { id: 'cn-name', query: '中国电影', expected: { country: ['CN'], video_type: ['movie'] } },
  { id: 'before-year', query: 'before 1970 western', expected: { year_to: 1969 } },
  { id: 'after-year', query: 'after 2000 thriller', expected: { year_from: 2001 } },
  { id: 'noise-art', query: 'abstract art installation', expected: { expect_no_facets: true } },
  { id: 'noise-weather', query: 'heavy rain on asphalt', expected: { expect_no_facets: true } },
  { id: 'hepburn-interview', query: 'Audrey Hepburn interview', expected: { actor_ids: ['person:audrey-hepburn'], video_type: ['interview'] } },
  { id: 'lee-trailer', query: 'Lee Jung-jae trailer', expected: { actor_ids: ['person:lee-jung-jae'], video_type: ['trailer'] } },
  { id: 'false-friend-paris', query: 'paris skyline at dusk', expected: { expect_no_facets: true } },
  { id: 'sports-clip', query: 'sports highlight reel', expected: { video_type: ['sports'] } },
];

function facetOverTriggered(
  got: { actor_ids?: string[]; country?: string[]; video_type?: string[]; year_from?: number; year_to?: number },
  expected: ParseEvalExpected,
): boolean {
  if (expected.expect_no_facets) {
    return Boolean(
      got.actor_ids?.length ||
        got.country?.length ||
        got.video_type?.length ||
        got.year_from != null ||
        got.year_to != null,
    );
  }
  // Over-trigger: extracted a facet family that expected left empty/null.
  if ((!expected.actor_ids || expected.actor_ids.length === 0) && got.actor_ids?.length) {
    return true;
  }
  if ((!expected.country || expected.country.length === 0) && got.country?.length) {
    return true;
  }
  if ((!expected.video_type || expected.video_type.length === 0) && got.video_type?.length) {
    return true;
  }
  if (expected.year_from == null && expected.year_to == null && (got.year_from != null || got.year_to != null)) {
    return true;
  }
  return false;
}

/** Compute over-trigger rate for a batch of dictionary parse results. */
export function overTriggerRate(
  rows: Array<{ expected: ParseEvalExpected; extracted: ParseEvalExpected }>,
): { rate: number; over: number; total: number } {
  let over = 0;
  for (const row of rows) {
    if (facetOverTriggered(row.extracted as never, row.expected)) over += 1;
  }
  return { rate: rows.length ? over / rows.length : 0, over, total: rows.length };
}
