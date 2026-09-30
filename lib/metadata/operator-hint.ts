/**
 * Ephemeral operator hint for the metadata Suggest run (todo/41 E).
 *
 * The operator may type a short free-text note in the Edit metadata panel
 * (e.g. `剧名：甄嬛传`, `用中文输出`). Scope is `search_and_output`:
 *
 * - `workTitle`   — the work's title, mapped onto the *existing* agent
 *                   `work_title` input so retrieval is steered without
 *                   widening the deployed skill's contract.
 * - `locale`      — an output-language override merged into the request
 *                   locale, which drives description/abstract language.
 *
 * This module is pure and never persists anything: the hint is a per-run
 * parameter, not an asset field, and must not be written to `meta`.
 *
 * Security posture (AGENTS.md invariant #4, todo/41 E): the text is the
 * operator's own legitimate steer, but it is still handled as untrusted data.
 * It is length-bounded and control characters/line breaks are collapsed, and
 * it is only ever passed into the agent as a JSON-quoted *value* of a labelled
 * input line (`work_title`) — never concatenated into the instruction text
 * itself — so `ignore previous instructions` remains a string to research
 * rather than an instruction to obey. The hint also cannot widen the source
 * policy: allowlisting is applied to retrieved URLs, downstream of here.
 */

/**
 * Hard cap on the raw hint, applied before anything else so no upstream code
 * path can be handed an unbounded operator string.
 */
export const OPERATOR_HINT_MAX_LENGTH = 200;

/** Cap on the extracted title; mirrors a realistic work title length. */
export const OPERATOR_HINT_TITLE_MAX_LENGTH = 120;

export interface OperatorHintResolution {
  /** Work title to steer retrieval with; `null` when the hint carried none. */
  workTitle: string | null;
  /** Output language to merge into the request locale; `null` for no override. */
  locale: 'en' | 'zh' | null;
  /** One-line machine-readable summary for logs (no raw hint echoed back). */
  notes: string[];
}

/** `剧名：甄嬛传` / `title: Empresses` / `片名 = 后宫·甄嬛传` … */
const LABELLED_TITLE_RE =
  /(?:剧名|片名|作品名?|名称|title)\s*[:：=＝-]\s*([^\n]{1,200})/i;

/** `剧名是甄嬛传` / `title is Empresses` — label without punctuation. */
const TITLE_IS_RE =
  /(?:剧名|片名|作品名?|名称|title)\s*(?:是|为|is)\s*([^\n]{1,200})/i;

/** A clause separator ends the title (`剧名：甄嬛传，用中文输出`). */
const CLAUSE_SEPARATOR_RE = /[，,。;；\n]/;

/** Sentence-final punctuation: a hint ending this way is an instruction. */
const TRAILING_PUNCTUATION_RE = /[。，、；：,.!?;…]$/;

/** Chinese-output request (`用中文输出`, `以简体中文回复`, `Chinese`). */
const ZH_OUTPUT_RE =
  /chinese|用中文|以中文|中文输出|中文回复|输出中文|简体中文|用汉语|汉语输出/i;

/** English-output request (`用英文输出`, `write in English`). */
const EN_OUTPUT_RE =
  /english|用英文|以英文|英文输出|英文回复|输出英文|用英语|英语输出/i;

export function normalizeOperatorHint(raw: string | null | undefined): string {
  if (typeof raw !== 'string') return '';
  return raw
    .normalize('NFKC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, OPERATOR_HINT_MAX_LENGTH);
}

function cleanTitleCandidate(candidate: string): string {
  let value = candidate.trim();
  const cut = value.search(CLAUSE_SEPARATOR_RE);
  if (cut > 0) value = value.slice(0, cut);
  return value
    .replace(/^["'“”『《]+/, '')
    .replace(/["'“”』》]+$/, '')
    .trim()
    .slice(0, OPERATOR_HINT_TITLE_MAX_LENGTH);
}

/**
 * Extract the work title a hint names. Only a *labelled* name, or a hint that
 * is nothing but a short bare title, counts — free prose is never mined for a
 * title, so an operator note cannot become a fabricated work identity.
 */
function extractWorkTitle(hint: string): string | null {
  const labelled = hint.match(LABELLED_TITLE_RE) ?? hint.match(TITLE_IS_RE);
  if (labelled?.[1]) {
    return cleanTitleCandidate(labelled[1]) || null;
  }

  // Unlabelled: accept only a short, punctuation-free run that does not read
  // as an instruction (`用中文输出` must not become a searched title).
  if (TRAILING_PUNCTUATION_RE.test(hint)) return null;
  if (ZH_OUTPUT_RE.test(hint) || EN_OUTPUT_RE.test(hint)) return null;
  const bare = cleanTitleCandidate(hint);
  if (!bare || bare.length > OPERATOR_HINT_TITLE_MAX_LENGTH) return null;
  if (bare.split(' ').length > 8) return null;
  return bare;
}

/**
 * Resolve the requested output language. A hint that names both languages
 * (`用中文，不要英文` also matches the English pattern) is ambiguous, so it
 * yields no override rather than guessing — the notes record the abstention.
 */
function extractLocale(hint: string, notes: string[]): 'en' | 'zh' | null {
  const wantsZh = ZH_OUTPUT_RE.test(hint);
  const wantsEn = EN_OUTPUT_RE.test(hint);
  if (wantsEn && !wantsZh) return 'en';
  if (wantsZh && !wantsEn) return 'zh';
  if (wantsZh && wantsEn) {
    notes.push('locale:ambiguous');
    return null;
  }
  return null;
}

/**
 * Resolve one operator hint into the existing Suggest parameters.
 * Never throws; an unparsable hint simply yields no overrides.
 */
export function resolveOperatorHint(
  raw: string | null | undefined,
): OperatorHintResolution {
  const hint = normalizeOperatorHint(raw);
  if (!hint) return { workTitle: null, locale: null, notes: [] };

  const workTitle = extractWorkTitle(hint);
  const notes: string[] = [];
  if (workTitle) notes.push('work_title');
  const locale = extractLocale(hint, notes);
  if (locale) notes.push(`locale:${locale}`);
  return { workTitle, locale, notes };
}
