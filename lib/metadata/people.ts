import fs from 'node:fs';
import path from 'node:path';

export type PersonLocale = 'en' | 'zh' | 'ko' | 'ja';

export interface PersonEntry {
  display: Partial<Record<PersonLocale, string>> & { en: string };
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
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid people catalog: expected object map');
  }
  const aliasOwners = new Map<string, string>();
  for (const [id, entry] of Object.entries(parsed)) {
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
  cachedCatalog = parsed;
  cachedAliasIndex = null;
  return parsed;
}

/** Reset caches — tests only. */
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
  const loc = locale.startsWith('zh')
    ? 'zh'
    : locale.startsWith('ko')
      ? 'ko'
      : locale.startsWith('ja')
        ? 'ja'
      : 'en';
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
