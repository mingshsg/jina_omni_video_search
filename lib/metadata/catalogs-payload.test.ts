import { describe, expect, it } from 'vitest';
import { buildCatalogsPayload } from './catalogs-payload';

const baseGroups = {
  entries: [
    { id: 'trailer', label: 'trailer' },
    { id: 'demo', label: 'demo' },
  ],
  status: 'ok' as const,
  total_groups: 2,
  truncated: false,
};

function build(
  overrides: Partial<Parameters<typeof buildCatalogsPayload>[0]> = {},
) {
  return buildCatalogsPayload({
    videoTypes: ['trailer', 'movie'],
    primaryLanguages: ['en'],
    countries: [{ code: 'US', label: 'US — United States' }],
    groups: baseGroups,
    loadPeople: () => [{ id: 'person:a', display: 'A', aliases: ['A'] }],
    ...overrides,
  });
}

describe('buildCatalogsPayload (G3)', () => {
  it('returns pinned catalogs and groups on the healthy path', () => {
    const payload = build();
    expect(payload.people_status).toBe('ok');
    expect(payload.people).toHaveLength(1);
    expect(payload.groups_status).toBe('ok');
    expect(payload.groups.map((g) => g.id)).toEqual(['trailer', 'demo']);
    expect(payload.groups_error).toBeUndefined();
  });

  it('keeps groups and pinned catalogs when the person catalog fails', () => {
    const logs: string[] = [];
    const payload = build({
      loadPeople: () => {
        throw new Error('config/people.json missing at /srv/config/people.json');
      },
      log: (message) => logs.push(message),
    });
    // People degrade, but the shared route still succeeds with groups.
    expect(payload.people).toEqual([]);
    expect(payload.people_status).toBe('unavailable');
    // R4: only a fixed public code — never the raw exception text or a path.
    expect(payload.people_error).toBe('PEOPLE_CATALOG_UNAVAILABLE');
    expect(payload.people_error).not.toContain('people.json');
    expect(payload.groups_status).toBe('ok');
    expect(payload.groups).toHaveLength(2);
    expect(payload.video_types).toContain('trailer');
    // The detail is available to the server log only, and is redacted.
    expect(logs.join(' ')).toContain('people.json');
  });

  it('redacts a credential in the person-catalog log detail', () => {
    const logs: string[] = [];
    const payload = build({
      loadPeople: () => {
        throw new Error('Authorization: ApiKey abc.def');
      },
      log: (message) => logs.push(message),
    });
    expect(payload.people_error).toBe('PEOPLE_CATALOG_UNAVAILABLE');
    expect(logs.join(' ')).toContain('[redacted]');
    expect(logs.join(' ')).not.toContain('abc.def');
  });

  it('surfaces a group-enumeration failure independently of the people catalog', () => {
    const payload = build({
      groups: {
        entries: [
          { id: 'trailer', label: 'trailer' },
          { id: 'demo', label: 'demo' },
        ],
        status: 'unavailable',
        total_groups: 0,
        truncated: false,
        error: 'ES down',
      },
    });
    expect(payload.groups_status).toBe('unavailable');
    // R4: the raw "ES down" detail is not copied into the response.
    expect(payload.groups_error).toBe('GROUP_CATALOG_UNAVAILABLE');
    // Starter suggestions still list so All/new groups stay usable.
    expect(payload.groups.map((g) => g.id)).toEqual(['trailer', 'demo']);
    expect(payload.people_status).toBe('ok');
  });

  it('reports a truncated group catalog as partial', () => {
    const payload = build({
      groups: {
        entries: [{ id: 'a', label: 'a' }],
        status: 'partial',
        total_groups: 500,
        truncated: true,
      },
    });
    expect(payload.groups_status).toBe('partial');
    expect(payload.groups_truncated).toBe(true);
    expect(payload.groups_total).toBe(500);
  });
});
