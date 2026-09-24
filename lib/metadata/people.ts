import fs from 'node:fs';
import path from 'node:path';

export type PersonLocale = 'en' | 'zh';

export interface PersonNativeName {
  /** BCP-47-ish tag, e.g. 'ko', 'ja', 'th' — see catalogs.ts PRIMARY_LANGUAGES. */
  lang: string;
  /** Verbatim native-script name; never reordered/reconstructed. */
  name: string;
}

export interface PersonEntry {
  display: Partial<Record<PersonLocale, string>> & { en: string };
  /** Present only when the person's own-script name isn't already `display.zh`. */
  native?: PersonNativeName;
  aliases: string[];
}

export type PeopleCatalog = Record<string, PersonEntry>;

export interface PersonSummary {
  id: string;
  display: string;
  aliases: string[];
}

let cachedCatalog: PeopleCatalog | null = null;
let cachedAliasIndex: Map<string, string> | null = null;

/** Unicode NFKC → lowercase → strip punctuation/separators (plan §A1). */
export function normalizeActorKeyToken(raw: string): string {
  return raw
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{Z}\p{S}]+/gu, '');
}

/** Sorted-token key: absorbs name-order variance (`jae|jung|lee`). */
export function sortedTokenActorKey(raw: string): string {
  const tokens = raw
    .normalize('NFKC')
    .toLowerCase()
    .split(/[\p{P}\p{Z}\p{S}]+/u)
    .map((t) => t.trim())
    .filter(Boolean)
    .sort();
  return tokens.join('|');
}

/** Both fuzz keys for one alias (squashed + sorted-token). */
export function actorKeysForAlias(alias: string): string[] {
  const squashed = normalizeActorKeyToken(alias);
  const sorted = sortedTokenActorKey(alias);
  const keys = new Set<string>();
  if (squashed) keys.add(squashed);
  if (sorted) keys.add(sorted);
  return [...keys];
}

export function resolvePeopleCatalogPath(): string {
  const candidates = [
    path.join(process.cwd(), 'config', 'people.json'),
    path.join(process.cwd(), '..', 'config', 'people.json'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(
    'Person catalog missing: expected config/people.json relative to process.cwd()',
  );
}

export function loadPeopleCatalog(force = false): PeopleCatalog {
  if (cachedCatalog && !force) return cachedCatalog;
  const filePath = resolvePeopleCatalogPath();
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw) as PeopleCatalog;
  validatePeopleCatalog(parsed);
  cachedCatalog = parsed;
  cachedAliasIndex = null;
  return parsed;
}

/**
 * Structural + alias-uniqueness validation shared by the loader and the
 * runtime catalog-growth write path (`addPersonToCatalog`). Throws on the
 * first problem found; never mutates its input.
 */
export function validatePeopleCatalog(catalog: unknown): asserts catalog is PeopleCatalog {
  if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) {
    throw new Error('Invalid people catalog: expected object map');
  }
  const aliasOwners = new Map<string, string>();
  for (const [id, entry] of Object.entries(catalog as PeopleCatalog)) {
    if (!id.startsWith('person:')) {
      throw new Error(`Invalid person id (must start with person:): ${id}`);
    }
    if (!entry?.display?.en || !Array.isArray(entry.aliases)) {
      throw new Error(`Invalid person entry: ${id}`);
    }
    for (const alias of entry.aliases) {
      if (typeof alias !== 'string' || !alias.trim()) {
        throw new Error(`Invalid empty person alias: ${id}`);
      }
      const key = alias.normalize('NFKC').toLowerCase().trim();
      const owner = aliasOwners.get(key);
      if (owner && owner !== id) {
        throw new Error(
          `Ambiguous person alias "${alias}" belongs to ${owner} and ${id}`,
        );
      }
      aliasOwners.set(key, id);
    }
  }
}

/** Reset caches — used by `addPersonToCatalog` after a write, and by tests. */
export function resetPeopleCatalogCache(): void {
  cachedCatalog = null;
  cachedAliasIndex = null;
}

export function getPerson(id: string): PersonEntry | undefined {
  return loadPeopleCatalog()[id];
}

export function displayNameForPerson(
  id: string,
  locale: string = 'en',
): string {
  const entry = getPerson(id);
  if (!entry) return id;
  const loc: PersonLocale = locale.startsWith('zh') ? 'zh' : 'en';
  return entry.display[loc] ?? entry.display.en;
}

/**
 * Alias → person id index (lowercase NFKC of each alias).
 * Longest-match consumers should sort keys by length descending.
 */
export function getAliasIndex(): Map<string, string> {
  if (cachedAliasIndex) return cachedAliasIndex;
  const catalog = loadPeopleCatalog();
  const index = new Map<string, string>();
  for (const [id, entry] of Object.entries(catalog)) {
    for (const alias of entry.aliases) {
      const key = alias.normalize('NFKC').toLowerCase().trim();
      if (key) index.set(key, id);
    }
  }
  cachedAliasIndex = index;
  return index;
}

export interface ContainedAliasMatch {
  /** Alias text as it appears in the query (original casing). */
  alias: string;
  person_id: string;
  start: number;
  end: number;
}

/**
 * Longest-first, non-overlapping catalog alias matches inside a free-text query.
 * Latin spans require word boundaries so "art" does not hit inside "Hepburn".
 * Used by Phase 3 BM25 (name+scene) and Phase 3.5 dictionary parsing.
 */
export function findContainedAliases(query: string): ContainedAliasMatch[] {
  const hay = query.normalize('NFKC');
  if (!hay.trim()) return [];
  const hayLower = hay.toLowerCase();
  const aliases = [...getAliasIndex().entries()]
    .map(([aliasLower, personId]) => ({
      aliasLower,
      personId,
      len: aliasLower.length,
    }))
    .filter((a) => a.len > 0)
    .sort(
      (a, b) =>
        b.len - a.len || a.aliasLower.localeCompare(b.aliasLower),
    );

  const occupied = new Array<boolean>(hayLower.length).fill(false);
  const matches: ContainedAliasMatch[] = [];

  for (const { aliasLower, personId } of aliases) {
    let from = 0;
    while (from <= hayLower.length - aliasLower.length) {
      const idx = hayLower.indexOf(aliasLower, from);
      if (idx < 0) break;
      const end = idx + aliasLower.length;
      let overlap = false;
      for (let i = idx; i < end; i++) {
        if (occupied[i]) {
          overlap = true;
          break;
        }
      }
      if (!overlap && isAliasBoundaryOk(hayLower, idx, end)) {
        for (let i = idx; i < end; i++) occupied[i] = true;
        matches.push({
          alias: hay.slice(idx, end),
          person_id: personId,
          start: idx,
          end,
        });
        break; // one span per alias key
      }
      from = idx + 1;
    }
  }

  return matches.sort((a, b) => a.start - b.start);
}

function isAliasBoundaryOk(hayLower: string, start: number, end: number): boolean {
  const span = hayLower.slice(start, end);
  // Latin / digit aliases need word boundaries; CJK substrings may abut.
  if (!/[a-z0-9]/i.test(span)) return true;
  const before = start === 0 ? '' : hayLower[start - 1]!;
  const after = end >= hayLower.length ? '' : hayLower[end]!;
  const word = /[a-z0-9]/i;
  if (before && word.test(before)) return false;
  if (after && word.test(after)) return false;
  return true;
}

/** Actor-key terms derived from whole-query fuzz + contained catalog aliases. */
export function actorKeysForQuery(query: string): string[] {
  const keys = new Set<string>();
  for (const k of actorKeysForAlias(query)) keys.add(k);
  const squashed = normalizeActorKeyToken(query);
  if (squashed) keys.add(squashed);
  for (const match of findContainedAliases(query)) {
    for (const k of actorKeysForAlias(match.alias)) keys.add(k);
  }
  return [...keys];
}

export function listPeople(locale: string = 'en'): PersonSummary[] {
  const catalog = loadPeopleCatalog();
  return Object.entries(catalog)
    .map(([id, entry]) => ({
      id,
      display: displayNameForPerson(id, locale),
      aliases: [...entry.aliases],
    }))
    .sort((a, b) => a.display.localeCompare(b.display));
}

/** Autocomplete: substring match on display + aliases (case-insensitive). */
export function searchPeople(
  query: string,
  locale: string = 'en',
  limit = 20,
): PersonSummary[] {
  const q = query.normalize('NFKC').toLowerCase().trim();
  const all = listPeople(locale);
  if (!q) return all.slice(0, limit);
  const scored: Array<{ person: PersonSummary; score: number }> = [];
  for (const person of all) {
    const haystacks = [
      person.display,
      person.id,
      ...person.aliases,
    ].map((s) => s.normalize('NFKC').toLowerCase());
    let score = -1;
    for (const h of haystacks) {
      if (h === q) score = Math.max(score, 3);
      else if (h.startsWith(q)) score = Math.max(score, 2);
      else if (h.includes(q)) score = Math.max(score, 1);
    }
    if (score >= 0) scored.push({ person, score });
  }
  scored.sort(
    (a, b) =>
      b.score - a.score || a.person.display.localeCompare(b.person.display),
  );
  return scored.slice(0, limit).map((s) => s.person);
}

/**
 * Expand actor_ids → display names, alias bag, and fuzz keys for indexing.
 * Unknown ids throw (callers validate first for API 400).
 */
export function expandActorIds(
  actorIds: string[],
  locale: string = 'en',
): {
  actors: string[];
  actor_aliases: string[];
  actor_keys: string[];
} {
  const actors: string[] = [];
  const aliasSet = new Set<string>();
  const keySet = new Set<string>();
  for (const id of actorIds) {
    const entry = getPerson(id);
    if (!entry) {
      throw new Error(`Unknown actor id: ${id}`);
    }
    actors.push(displayNameForPerson(id, locale));
    for (const alias of entry.aliases) {
      aliasSet.add(alias);
      for (const key of actorKeysForAlias(alias)) {
        keySet.add(key);
      }
    }
  }
  return {
    actors,
    actor_aliases: [...aliasSet].sort((a, b) => a.localeCompare(b)),
    actor_keys: [...keySet].sort((a, b) => a.localeCompare(b)),
  };
}

const NEW_PERSON_NAME_MAX_LEN = 200;
/** "Known as" list bound — mirrors META_BOUNDS.tagsMax's order of magnitude. */
export const KNOWN_AS_MAX = 30;
export const KNOWN_AS_NAME_MAX_LEN = NEW_PERSON_NAME_MAX_LEN;

export class PersonCatalogError extends Error {
  readonly code: 'invalid' | 'conflict';

  constructor(code: PersonCatalogError['code'], message: string) {
    super(message);
    this.name = 'PersonCatalogError';
    this.code = code;
  }
}

export interface NewPersonInput {
  en: string;
  zh?: string | null;
  native?: { lang: string; name: string } | null;
}

/** ASCII-kebab slug from an English display name, e.g. "Jun Kwang-ryul" -> "jun-kwang-ryul". */
export function slugifyPersonId(en: string): string {
  const base = en
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'person';
}

function writePeopleCatalogAtomic(catalog: PeopleCatalog): void {
  const filePath = resolvePeopleCatalogPath();
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
  fs.renameSync(tmpPath, filePath);
}

/**
 * Grow the person catalog at runtime with one new entry, sourced from a
 * Suggest actor candidate that didn't match anyone on file. Persists to
 * `config/people.json` (atomic write: temp file + rename) and reloads the
 * in-process cache so the new id is immediately selectable.
 *
 * Not safe against concurrent writers on separate processes/replicas — this
 * app is single-instance in its current deployment shape (see AGENTS.md).
 */
export function addPersonToCatalog(input: NewPersonInput): {
  id: string;
  entry: PersonEntry;
} {
  const en = input.en.trim();
  if (!en || en.length > NEW_PERSON_NAME_MAX_LEN) {
    throw new PersonCatalogError(
      'invalid',
      `English name must be 1-${NEW_PERSON_NAME_MAX_LEN} characters`,
    );
  }
  const zh = input.zh?.trim() || undefined;
  const native =
    input.native?.name?.trim() && input.native?.lang?.trim()
      ? { lang: input.native.lang.trim(), name: input.native.name.trim() }
      : undefined;
  if (zh && zh.length > NEW_PERSON_NAME_MAX_LEN) {
    throw new PersonCatalogError(
      'invalid',
      `Chinese name must be ≤${NEW_PERSON_NAME_MAX_LEN} characters`,
    );
  }
  if (native && native.name.length > NEW_PERSON_NAME_MAX_LEN) {
    throw new PersonCatalogError(
      'invalid',
      `Native name must be ≤${NEW_PERSON_NAME_MAX_LEN} characters`,
    );
  }

  const current = loadPeopleCatalog(true);
  const baseSlug = slugifyPersonId(en);
  let id = `person:${baseSlug}`;
  let suffix = 2;
  while (current[id]) {
    id = `person:${baseSlug}-${suffix}`;
    suffix += 1;
  }

  const aliases = new Set<string>([en]);
  if (zh) aliases.add(zh);
  if (native) aliases.add(native.name);
  const entry: PersonEntry = {
    display: zh ? { en, zh } : { en },
    ...(native ? { native } : {}),
    aliases: [...aliases],
  };

  const next: PeopleCatalog = { ...current, [id]: entry };
  try {
    validatePeopleCatalog(next);
  } catch (err) {
    throw new PersonCatalogError(
      'conflict',
      err instanceof Error ? err.message : 'Catalog entry conflicts with an existing person',
    );
  }
  writePeopleCatalogAtomic(next);
  resetPeopleCatalogCache();
  loadPeopleCatalog(true);
  return { id, entry };
}

/**
 * Replace a person's full "known as" list (their entire `aliases` array —
 * the same field that seeds from `en`/`zh`/`native.name` at creation time
 * and is what `findContainedAliases`/search matching reads). This is the
 * only write path for growing a person's known names *after* creation —
 * `addPersonToCatalog` only ever seeds the initial three.
 *
 * Deliberately a full-list replace, not an append/remove pair: the caller
 * (the "Known as" chip list in the editor) already holds the current list
 * and diffs locally, so a replace keeps this function's contract simple and
 * matches the chip-list UI's natural save shape (compare-and-PATCH-whole-list,
 * the same pattern already used for `tags`/`reference_urls` in
 * `validate.ts`).
 *
 * Re-validates the *whole* catalog before writing (`validatePeopleCatalog`),
 * which is what turns a cross-person alias collision into a rejected write
 * (`PersonCatalogError('conflict', ...)`) instead of a silent
 * last-writer-wins overwrite in `getAliasIndex()` at read time — see
 * `reviews/hybrid-internet-suggest-code-review-2026-09-23.md` R5-06. This
 * only guards *new* writes; it does not audit aliases already on file.
 *
 * Not safe against concurrent writers on separate processes/replicas — this
 * is a read-modify-write of the whole catalog file. The atomic temp-file +
 * rename protects against a torn file, not against a lost update, exactly
 * as documented on `addPersonToCatalog` above.
 */
export function setPersonAliases(
  id: string,
  aliases: string[],
): { id: string; entry: PersonEntry } {
  const current = loadPeopleCatalog(true);
  const existing = current[id];
  if (!existing) {
    throw new PersonCatalogError('invalid', `Unknown person id: ${id}`);
  }

  const cleaned = [
    ...new Set(
      aliases
        .map((a) => a.normalize('NFKC').trim())
        .filter((a) => a.length > 0),
    ),
  ];
  if (cleaned.length === 0) {
    throw new PersonCatalogError(
      'invalid',
      'At least one known name is required',
    );
  }
  if (cleaned.length > KNOWN_AS_MAX) {
    throw new PersonCatalogError(
      'invalid',
      `At most ${KNOWN_AS_MAX} known names are allowed`,
    );
  }
  const overlong = cleaned.find((a) => a.length > KNOWN_AS_NAME_MAX_LEN);
  if (overlong) {
    throw new PersonCatalogError(
      'invalid',
      `Known name exceeds ${KNOWN_AS_NAME_MAX_LEN} characters`,
    );
  }

  const nextEntry: PersonEntry = { ...existing, aliases: cleaned };
  const next: PeopleCatalog = { ...current, [id]: nextEntry };
  try {
    validatePeopleCatalog(next);
  } catch (err) {
    throw new PersonCatalogError(
      'conflict',
      err instanceof Error
        ? err.message
        : 'Known name conflicts with another person',
    );
  }
  writePeopleCatalogAtomic(next);
  resetPeopleCatalogCache();
  loadPeopleCatalog(true);
  return { id, entry: nextEntry };
}

