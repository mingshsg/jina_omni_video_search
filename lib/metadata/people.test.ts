import { describe, expect, it, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  actorKeysForAlias,
  actorKeysForQuery,
  addPersonToCatalog,
  expandActorIds,
  findContainedAliases,
  loadPeopleCatalog,
  normalizeActorKeyToken,
  PersonCatalogError,
  resetPeopleCatalogCache,
  searchPeople,
  slugifyPersonId,
  sortedTokenActorKey,
  validatePeopleCatalog,
} from './people';
import { COUNTRY_OPTIONS, VIDEO_TYPES } from './catalogs';
import { normalizeTagKey, parseMetaPatchBody, MetaValidationError } from './validate';

describe('people catalog', () => {
  beforeAll(() => {
    loadPeopleCatalog(true);
  });

  it('loads curated people with multilingual aliases', () => {
    const catalog = loadPeopleCatalog();
    expect(catalog['person:lee-jung-jae']?.aliases).toEqual(
      expect.arrayContaining(['이정재', '李政宰', 'Lee Jung-jae']),
    );
  });

  it('builds squashed and sorted-token actor keys', () => {
    expect(normalizeActorKeyToken('Lee Jung-jae')).toBe('leejungjae');
    expect(sortedTokenActorKey('Jung-jae Lee')).toBe('jae|jung|lee');
    expect(actorKeysForAlias('Lee Jung-jae')).toEqual(
      expect.arrayContaining(['leejungjae', 'jae|jung|lee']),
    );
  });

  it('expands actor_ids into display + aliases + keys', () => {
    const expanded = expandActorIds(['person:lee-jung-jae'], 'zh');
    expect(expanded.actors).toEqual(['李政宰']);
    expect(expanded.actor_aliases).toEqual(
      expect.arrayContaining(['이정재', '李政宰']),
    );
    expect(expanded.actor_keys.length).toBeGreaterThan(0);
  });

  it('searches across scripts', () => {
    expect(searchPeople('이정재')[0]?.id).toBe('person:lee-jung-jae');
    expect(searchPeople('李政宰')[0]?.id).toBe('person:lee-jung-jae');
    expect(searchPeople('Jungjae')[0]?.id).toBe('person:lee-jung-jae');
  });

  it('finds contained aliases in name-plus-scene queries', () => {
    const matches = findContainedAliases('Audrey Hepburn running');
    expect(matches.map((m) => m.person_id)).toEqual(['person:audrey-hepburn']);
    expect(matches[0]!.alias.toLowerCase()).toBe('audrey hepburn');
    // Prefer the full name over the short "Hepburn" alias.
    expect(matches).toHaveLength(1);
  });

  it('does not treat Latin substrings inside longer words as aliases', () => {
    expect(findContainedAliases('Shepburnesque style')).toEqual([]);
  });

  it('derives actor keys from contained aliases for mixed queries', () => {
    const keys = actorKeysForQuery('Audrey Hepburn running');
    expect(keys).toEqual(
      expect.arrayContaining(actorKeysForAlias('Audrey Hepburn')),
    );
  });
});

describe('catalogs', () => {
  it('pins exactly 20 country/region options', () => {
    expect(COUNTRY_OPTIONS).toHaveLength(20);
    expect(COUNTRY_OPTIONS.map((c) => c.code)).toContain('US');
    expect(COUNTRY_OPTIONS.map((c) => c.code)).toContain('HK');
  });

  it('lists controlled video types', () => {
    expect(VIDEO_TYPES).toContain('trailer');
    expect(VIDEO_TYPES).toContain('movie');
  });
});

describe('meta patch validation', () => {
  beforeAll(() => {
    loadPeopleCatalog(true);
  });

  it('derives actors from actor_ids and rejects unknown ids', () => {
    const ok = parseMetaPatchBody({
      expected_revision: 0,
      actor_ids: ['person:audrey-hepburn'],
      country: 'us',
    });
    expect(ok.fields.actor_ids).toEqual(['person:audrey-hepburn']);
    expect(ok.fields.actors).toEqual(['Audrey Hepburn']);
    expect(ok.fields.country).toBe('US');

    expect(() =>
      parseMetaPatchBody({
        expected_revision: 0,
        actor_ids: ['person:nobody'],
      }),
    ).toThrow(MetaValidationError);
  });

  it('rejects empty patch and out-of-catalog country', () => {
    expect(() =>
      parseMetaPatchBody({ expected_revision: 0 }),
    ).toThrow(/At least one editable field/);
    expect(() =>
      parseMetaPatchBody({ expected_revision: 0, country: 'XX' }),
    ).toThrow(/Country\/region/);
  });

  it('round-trips every pinned primary_language including zh-Hans/zh-Hant', () => {
    for (const lang of [
      'en',
      'zh',
      'zh-Hans',
      'zh-Hant',
      'zh-hans',
      'ZH-HANT',
      'ja',
      'ko',
    ]) {
      const ok = parseMetaPatchBody({
        expected_revision: 0,
        primary_language: lang,
      });
      expect(typeof ok.fields.primary_language).toBe('string');
      expect(String(ok.fields.primary_language).toLowerCase()).toBe(
        lang.toLowerCase(),
      );
    }
    // Canonical spellings preserved for mixed-case tags
    expect(
      parseMetaPatchBody({
        expected_revision: 0,
        primary_language: 'zh-hans',
      }).fields.primary_language,
    ).toBe('zh-Hans');
    expect(
      parseMetaPatchBody({
        expected_revision: 0,
        primary_language: 'ZH-HANT',
      }).fields.primary_language,
    ).toBe('zh-Hant');
  });

  it('clears tags when only whitespace elements are provided', () => {
    const cleared = parseMetaPatchBody({
      expected_revision: 0,
      tags: [' ', '\t'],
    });
    expect(cleared.fields.tags).toBeNull();
    expect(cleared.fields.tags_key).toBeNull();
    expect(cleared.review?.tags).toBeUndefined();
  });

  it('records suggestion provenance via field_sources', () => {
    const ok = parseMetaPatchBody({
      expected_revision: 0,
      year: 2020,
      video_type: 'trailer',
      field_sources: { year: 'suggestion', video_type: 'manual' },
    });
    expect(ok.review?.year).toEqual({
      source: 'suggestion',
      confirmed: true,
    });
    expect(ok.review?.video_type).toEqual({
      source: 'manual',
      confirmed: true,
    });
  });

  it('stores bounded evidence/confidence for suggested fields', () => {
    const ok = parseMetaPatchBody({
      expected_revision: 0,
      description: 'Title clue: “Work”.',
      field_sources: { description: 'suggestion' },
      field_provenance: {
        description: {
          confidence: 0.35,
          evidence: 'Draft restates the title clue only',
          provider: 'external_web',
          source_url: 'https://en.wikipedia.org/wiki/Work',
          retrieved_at: '2026-09-23T00:00:00.000Z',
          request_id: '11111111-1111-4111-8111-111111111111',
        },
      },
    });
    expect(ok.review?.description).toEqual({
      source: 'suggestion',
      confirmed: true,
      confidence: 0.35,
      evidence: 'Draft restates the title clue only',
      provider: 'external_web',
      source_url: 'https://en.wikipedia.org/wiki/Work',
      retrieved_at: '2026-09-23T00:00:00.000Z',
      request_id: '11111111-1111-4111-8111-111111111111',
    });
  });

  it('defaults missing field_sources to manual (do not send unchanged fields)', () => {
    const ok = parseMetaPatchBody({
      expected_revision: 1,
      year: 1961,
      description: 'Title clue',
      field_sources: {},
    });
    expect(ok.review?.year?.source).toBe('manual');
    expect(ok.review?.description?.source).toBe('manual');
  });

  it('normalizes tag keys', () => {
    expect(normalizeTagKey('  Fashion  Week ')).toBe('fashion week');
  });
});

/**
 * `addPersonToCatalog` writes `config/people.json` for real (atomic
 * temp-file + rename). Every test in this block redirects `process.cwd()`
 * to a throwaway temp directory seeded with its own `config/people.json`
 * so the real catalog on disk is never touched — see AGENTS.md's note on
 * this exact risk.
 */
describe('addPersonToCatalog (isolated fs)', () => {
  let tmpDir: string;
  let cwdSpy: ReturnType<typeof vi.spyOn>;

  const seedCatalog = {
    'person:existing-actor': {
      display: { en: 'Existing Actor' },
      aliases: ['Existing Actor'],
    },
  };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'people-catalog-test-'));
    fs.mkdirSync(path.join(tmpDir, 'config'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'config', 'people.json'),
      JSON.stringify(seedCatalog, null, 2),
      'utf8',
    );
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
    resetPeopleCatalogCache();
  });

  afterEach(() => {
    cwdSpy.mockRestore();
    resetPeopleCatalogCache();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('adds a new person, persists it, and makes it immediately loadable', () => {
    const { id, entry } = addPersonToCatalog({ en: 'Jun Kwang-ryul' });
    expect(id).toBe('person:jun-kwang-ryul');
    expect(entry.display.en).toBe('Jun Kwang-ryul');

    const onDisk = JSON.parse(
      fs.readFileSync(path.join(tmpDir, 'config', 'people.json'), 'utf8'),
    );
    expect(onDisk[id]).toBeDefined();

    const reloaded = loadPeopleCatalog(true);
    expect(reloaded[id]?.aliases).toEqual(['Jun Kwang-ryul']);
  });

  it('folds zh and native names into the alias set', () => {
    const { entry } = addPersonToCatalog({
      en: 'Test Person',
      zh: '测试人物',
      native: { lang: 'ko', name: '테스트' },
    });
    expect(entry.aliases).toEqual(
      expect.arrayContaining(['Test Person', '测试人物', '테스트']),
    );
  });

  it('dedupes id-slug collisions with a numeric suffix when aliases differ', () => {
    const first = addPersonToCatalog({ en: 'Test Name' });
    const second = addPersonToCatalog({ en: 'Tëst Namé' });
    expect(first.id).toBe('person:test-name');
    expect(second.id).toBe('person:test-name-2');
  });

  it('rejects an alias that already belongs to another person', () => {
    try {
      addPersonToCatalog({ en: 'Existing Actor' });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(PersonCatalogError);
      expect((err as PersonCatalogError).code).toBe('conflict');
    }
  });

  it('rejects an empty or over-long English name', () => {
    expect(() => addPersonToCatalog({ en: '' })).toThrow(PersonCatalogError);
    expect(() => addPersonToCatalog({ en: '  ' })).toThrow(PersonCatalogError);
    expect(() => addPersonToCatalog({ en: 'a'.repeat(201) })).toThrow(
      PersonCatalogError,
    );
  });
});

describe('slugifyPersonId', () => {
  it('strips diacritics and kebab-cases an English display name', () => {
    expect(slugifyPersonId('Jun Kwang-ryul')).toBe('jun-kwang-ryul');
    expect(slugifyPersonId('Zoë Bell')).toBe('zoe-bell');
  });

  it('falls back to a generic slug for input with no ASCII letters', () => {
    expect(slugifyPersonId('宋康昊')).toBe('person');
  });
});

describe('validatePeopleCatalog', () => {
  it('throws on a duplicate alias owned by two different ids', () => {
    expect(() =>
      validatePeopleCatalog({
        'person:a': { display: { en: 'A' }, aliases: ['Shared'] },
        'person:b': { display: { en: 'B' }, aliases: ['shared'] },
      }),
    ).toThrow(/Ambiguous person alias/);
  });

  it('throws on an id missing the person: prefix', () => {
    expect(() =>
      validatePeopleCatalog({ bad: { display: { en: 'X' }, aliases: [] } }),
    ).toThrow(/must start with person:/);
  });

  it('throws on a non-object catalog', () => {
    expect(() => validatePeopleCatalog(null)).toThrow(/expected object map/);
    expect(() => validatePeopleCatalog([])).toThrow(/expected object map/);
  });
});
