/**
 * Optional web enrichment for local Suggest drafts (plan/04).
 *
 * Product path (only path that matters):
 *   Library web Suggest → POST /api/.../meta/suggest → Agent Builder converse
 *   → agent tools jina.search_web / jina.read_url
 *
 * Cursor IDE does not participate. Direct Jina REST is optional/dev only.
 */
import type { AppConfig } from '../config';
import { getConfig } from '../config';
import {
  COUNTRY_CODE_SET,
  META_BOUNDS,
  VIDEO_TYPE_SET,
  canonicalizePrimaryLanguage,
} from './catalogs';
import {
  AgentBuilderError,
  converseSuggestAgent,
  isAgentBuilderSuggestConfigured,
  isRenderableTraceUrl,
  type AgentBuilderFieldDraft,
  type AgentBuilderSuggestPayload,
  type AgentToolTraceEntry,
} from './agent-builder-suggest';
import {
  isJinaWebConfigured,
  jinaReadUrl,
  jinaSearchWeb,
  JinaWebError,
  type JinaSearchHit,
} from './jina-web';
import type { LocalSuggestResult, SuggestFieldDraft } from './suggest-local';
import { getAliasIndex } from './people';

/** Domains we may pass to Reader for work-level facts (allowlist — plan §3). */
export const SUGGEST_WEB_ALLOWLIST = [
  'wikipedia.org',
  'en.wikipedia.org',
  'zh.wikipedia.org',
  'ja.wikipedia.org',
  'ko.wikipedia.org',
  'wikidata.org',
  'www.wikidata.org',
  'imdb.com',
  'www.imdb.com',
  'themoviedb.org',
  'www.themoviedb.org',
] as const;

/**
 * Extra lower-trust domains permitted only for actor name-completion lookups
 * (plan/06). Actor candidates are still gated behind exact-alias catalog
 * resolution before they become save-able, so the added source risk here is
 * acceptable.
 */
export const SUGGEST_WEB_NAME_ALLOWLIST = [
  ...SUGGEST_WEB_ALLOWLIST,
  'baike.baidu.com',
  'movie.douban.com',
  'mydramalist.com',
  'hancinema.net',
  'asianwiki.com',
] as const;

export interface SuggestWebCandidate {
  provider: 'jina' | 'agent_builder';
  title: string;
  url: string;
  snippet: string;
  allowlisted: boolean;
}

export interface SuggestWebMeta {
  used: boolean;
  status: 'ok' | 'ambiguous' | 'empty' | 'unavailable' | 'skipped';
  reason?: string;
  candidates: SuggestWebCandidate[];
  reads: Array<{ url: string; title: string }>;
  elapsed_ms: number;
  agent_id?: string;
  actor_candidates?: SuggestWebActorCandidate[];
  /**
   * Count of agent-proposed cast members dropped because their source URL
   * was missing or off the name allowlist (todo/32 R1). Non-zero means the
   * agent *did* find cast that is deliberately not shown — the UI must say
   * so rather than render an empty list.
   */
  actor_candidates_dropped?: number;
  /**
   * Best-effort trace of the agent's own search_web/read_url tool calls
   * (query/question/url per call), for UI transparency into how a
   * suggestion was researched. Empty when unavailable (e.g. local/jina-rest
   * providers, which have no equivalent multi-step trace).
   */
  tool_trace?: AgentToolTraceEntry[];
}

export interface SuggestWebActorCandidate {
  names: {
    en: string;
    zh: string | null;
    /** Actor's own native-script name; verbatim, never reordered. */
    native: { lang: string; name: string } | null;
  };
  character: string | null;
  url: string;
  evidence: string;
  retrieved_at: string;
  /** Exact alias resolution only; unresolved candidates are never saved. */
  matched_person_id: string | null;
}

export interface NormalizedActorCandidates {
  candidates: SuggestWebActorCandidate[];
  /**
   * Agent-proposed actors discarded because their source URL is missing or
   * not on the name allowlist.
   *
   * Bug fix (todo/32 R1): this drop used to be completely silent — the same
   * defect class as todo/30 S6, which was fixed for all seven scalar fields
   * but left in place here. The gate itself is deliberately *kept*: actor
   * candidates feed catalog growth, and aliases reach the search hot path
   * via `findContainedAliases`, so a bad actor name has a much wider blast
   * radius than a bad `country`. What was wrong was discarding research
   * without telling the operator anything happened. Counting them lets the
   * UI say "N cast candidates were found but not shown because their source
   * wasn't trusted" instead of rendering an empty list that is
   * indistinguishable from "the agent found no cast at all".
   */
  dropped_uncited: number;
}

export function normalizeAgentActorCandidates(
  actors: AgentBuilderSuggestPayload['actors'],
  max = 8,
  retrievedAt = new Date().toISOString(),
): NormalizedActorCandidates {
  const aliasIndex = getAliasIndex();
  let droppedUncited = 0;
  const candidates = (actors ?? [])
    .flatMap((actor) => {
      const en = actor.names?.en?.normalize('NFKC').trim() ?? '';
      // No English name at all is malformed agent output, not a policy
      // drop — nothing the operator could act on, so it is not counted.
      if (!en) return [];
      const url = String(actor.url ?? '');
      if (!isNameAllowlistedUrl(url)) {
        droppedUncited += 1;
        return [];
      }
      const zh = actor.names?.zh?.normalize('NFKC').trim() || null;
      const nativeRaw = actor.names?.native;
      const nativeName =
        nativeRaw && typeof nativeRaw.name === 'string'
          ? nativeRaw.name.normalize('NFKC').trim()
          : '';
      const native =
        nativeRaw && typeof nativeRaw.lang === 'string' && nativeName
          ? { lang: nativeRaw.lang, name: nativeName }
          : null;
      const names = { en, zh, native };
      const matchedIds = new Set<string>();
      for (const name of [names.en, names.zh, names.native?.name]) {
        if (!name) continue;
        const id = aliasIndex.get(name.toLowerCase());
        if (id) matchedIds.add(id);
      }
      return [
        {
          names,
          character: actor.character?.normalize('NFKC').trim() || null,
          url,
          evidence: String(actor.evidence ?? '').slice(0, 280),
          retrieved_at: retrievedAt,
          matched_person_id:
            matchedIds.size === 1 ? [...matchedIds][0]! : null,
        },
      ];
    })
    .slice(0, Math.max(0, max));
  return { candidates, dropped_uncited: droppedUncited };
}

export interface EnrichedSuggestResult extends LocalSuggestResult {
  provider: 'local' | 'local+agent' | 'local+jina';
  web?: SuggestWebMeta;
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function isAllowlistedUrl(url: string): boolean {
  return isUrlAllowlisted(url, SUGGEST_WEB_ALLOWLIST);
}

/** Same check, but against the wider name-completion-only allowlist. */
export function isNameAllowlistedUrl(url: string): boolean {
  return isUrlAllowlisted(url, SUGGEST_WEB_NAME_ALLOWLIST);
}

function isUrlAllowlisted(url: string, list: readonly string[]): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase();
  return list.some((d) => host === d || host.endsWith(`.${d}`));
}

export type SuggestProgressStage = 'researching' | 'validating';

/** Local title-clue prose must not crowd out grounded work drafts. */
function isLocalTitleProseDraft(
  draft: SuggestFieldDraft<string> | undefined,
): boolean {
  return draft?.source === 'local_title';
}

function stripLocalTitleProse(
  suggestions: LocalSuggestResult['suggestions'],
): void {
  if (isLocalTitleProseDraft(suggestions.description)) {
    delete suggestions.description;
  }
  if (isLocalTitleProseDraft(suggestions.abstract)) {
    delete suggestions.abstract;
  }
}

function isFileLevelVideoType(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    (value === 'trailer' ||
      value === 'interview' ||
      value === 'ad' ||
      value === 'ugc' ||
      value === 'news' ||
      value === 'sports')
  );
}

/**
 * Every URL the agent surfaced anywhere in its payload — per-field
 * citations, candidate hits, and actor sources — deduped, safety-checked,
 * and capped. Deliberately *not* filtered by the domain allowlist: this is
 * "what did the agent consult", for the operator to review before saving as
 * `meta.reference_urls`, not a per-fact trust claim (todo/30 S6).
 */
function collectReferenceUrls(payload: AgentBuilderSuggestPayload): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (url: unknown): void => {
    if (out.length >= META_BOUNDS.referenceUrlsMax) return;
    if (typeof url !== 'string' || !url) return;
    const trimmed = url.trim();
    if (!trimmed || !isRenderableTraceUrl(trimmed) || seen.has(trimmed)) return;
    seen.add(trimmed);
    out.push(trimmed);
  };
  const fields = payload.fields;
  if (fields) {
    add(fields.year?.url);
    add(fields.country?.url);
    add(fields.primary_language?.url);
    add(fields.video_type?.url);
    add(fields.description?.url);
    add(fields.abstract?.url);
    add(fields.tags?.url);
  }
  for (const candidate of payload.candidates ?? []) {
    add(candidate?.url);
  }
  for (const actor of payload.actors ?? []) {
    add(actor?.url);
  }
  return out.slice(0, META_BOUNDS.referenceUrlsMax);
}

/**
 * Prefer an agent draft over a weaker local_title draft for the same field.
 * external_web always wins over local_title when the agent value is present.
 */
export function shouldPreferAgentField(params: {
  local?: SuggestFieldDraft;
  agentConfidence: number;
}): boolean {
  const { local, agentConfidence } = params;
  if (!local) return true;
  if (local.source === 'local_title') return true;
  if (local.source === 'external_web') {
    return agentConfidence >= (local.confidence ?? 0);
  }
  // media_tag / caller_hint keep precedence over web for language.
  if (local.source === 'media_tag' || local.source === 'caller_hint') {
    return false;
  }
  return agentConfidence > (local.confidence ?? 0);
}

export function applyAgentPayloadToLocal(params: {
  local: LocalSuggestResult;
  payload: AgentBuilderSuggestPayload;
  maxReads: number;
  retrievedAt?: string;
  agentId?: string;
  elapsedMs?: number;
  toolTrace?: AgentToolTraceEntry[];
}): EnrichedSuggestResult {
  const {
    local,
    payload,
    maxReads,
    retrievedAt = new Date().toISOString(),
    agentId,
    elapsedMs = 0,
    toolTrace,
  } = params;
  const suggestions = { ...local.suggestions };
  // Bug fix (todo/30 S2): `candidates` used to be built unconditionally, so
  // an explicitly `ambiguous` agent answer ("I could not disambiguate; here
  // are three films") still shipped a populated candidate list. The client
  // then auto-applied candidates[0] as a confident work_title with a
  // fabricated 0.7 confidence — an abstention rendered as an answer. Gate
  // candidates/reads the same way actorCandidates and field suggestions
  // already are, on `payload.status === 'ok'`.
  const candidates: SuggestWebCandidate[] =
    payload.status === 'ok'
      ? (payload.candidates ?? [])
          .filter((candidate) => candidate.url && isAllowlistedUrl(candidate.url))
          .slice(0, 3)
          .map((candidate) => ({
            provider: 'agent_builder' as const,
            title: String(candidate.title ?? '').slice(0, 300),
            url: String(candidate.url),
            snippet: String(candidate.reason ?? '').slice(0, 280),
            allowlisted: true,
          }))
      : [];
  const reads = candidates.slice(0, maxReads).map((candidate) => ({
    url: candidate.url,
    title: candidate.title,
  }));

  let actorCandidates: SuggestWebActorCandidate[] = [];
  let actorCandidatesDropped = 0;
  if (payload.status === 'ok') {
    const normalizedActors = normalizeAgentActorCandidates(
      payload.actors,
      8,
      retrievedAt,
    );
    actorCandidates = normalizedActors.candidates;
    actorCandidatesDropped = normalizedActors.dropped_uncited;

    const readField = (
      field: AgentBuilderFieldDraft | undefined,
    ): { value: unknown; url: string | null; evidence: string; cited: boolean } | null => {
      if (!field) return null;
      const rawUrl = typeof field.url === 'string' && field.url ? field.url : null;
      return {
        value: field.value,
        url: rawUrl,
        evidence: String(field.evidence ?? '').slice(0, 280),
        // Bug fix (todo/30 S6): this used to *gate* the whole fact — no
        // allowlisted URL meant the value was silently dropped, even though
        // the zod schema in agent-builder-suggest.ts always treated `url`
        // as optional. Product direction (方案 A): still apply the fact,
        // just trust it less and label it distinctly (see
        // `discountForCitation` / the `[agent, uncited]` evidence prefix
        // below) rather than discard real agent output.
        cited: !!rawUrl && isAllowlistedUrl(rawUrl),
      };
    };

    /**
     * Confidence penalty applied when a field has no allowlisted citation.
     * Keeps relative field ordering (year still trusted more than tags)
     * while making uncited facts visibly lower-confidence in the editor.
     */
    const discountForCitation = (base: number, wasCited: boolean): number =>
      wasCited ? base : Math.max(0.3, Math.round((base - 0.15) * 100) / 100);

    /** Only pass through source_url when it satisfies the stricter https-only
     * provenance schema used at Save time (validate.ts fieldProvenanceSchema)
     * — an http-only or otherwise-unciteable URL is still shown in evidence
     * text, just not carried as a clickable "source" link. */
    const citableSourceUrl = (url: string | null): string | undefined =>
      url && url.startsWith('https://') ? url : undefined;

    const year = readField(payload.fields?.year);
    if (
      typeof year?.value === 'number' &&
      year.value >= META_BOUNDS.yearMin &&
      year.value <= META_BOUNDS.yearMax &&
      shouldPreferAgentField({
        local: suggestions.year,
        agentConfidence: discountForCitation(0.7, year.cited),
      })
    ) {
      suggestions.year = {
        value: year.value,
        confidence: discountForCitation(0.7, year.cited),
        source: 'external_web',
        evidence: `[agent${year.cited ? '' : ', uncited'}] ${year.evidence || `year ${year.value}`}`,
        source_url: citableSourceUrl(year.url),
        retrieved_at: retrievedAt,
      };
    }

    const country = readField(payload.fields?.country);
    if (
      typeof country?.value === 'string' &&
      COUNTRY_CODE_SET.has(country.value.trim().toUpperCase()) &&
      shouldPreferAgentField({
        local: suggestions.country,
        agentConfidence: discountForCitation(0.65, country.cited),
      })
    ) {
      suggestions.country = {
        value: country.value.trim().toUpperCase(),
        confidence: discountForCitation(0.65, country.cited),
        source: 'external_web',
        evidence: `[agent${country.cited ? '' : ', uncited'}] ${country.evidence || 'work production country'}`,
        source_url: citableSourceUrl(country.url),
        retrieved_at: retrievedAt,
      };
    }

    const language = readField(payload.fields?.primary_language);
    if (typeof language?.value === 'string') {
      const canonical = canonicalizePrimaryLanguage(String(language.value));
      if (
        canonical &&
        shouldPreferAgentField({
          local: suggestions.primary_language,
          agentConfidence: discountForCitation(0.65, language.cited),
        })
      ) {
        suggestions.primary_language = {
          value: canonical,
          confidence: discountForCitation(0.65, language.cited),
          source: 'external_web',
          evidence: `[agent${language.cited ? '' : ', uncited'}] ${language.evidence || 'work original language'}`,
          source_url: citableSourceUrl(language.url),
          retrieved_at: retrievedAt,
        };
      }
    }

    // Prefer file-level local title clues (trailer/interview) over work kind.
    const videoType = readField(payload.fields?.video_type);
    const localType = suggestions.video_type;
    const keepLocalFileType = isFileLevelVideoType(localType?.value);
    if (
      !keepLocalFileType &&
      typeof videoType?.value === 'string' &&
      VIDEO_TYPE_SET.has(String(videoType.value).trim()) &&
      shouldPreferAgentField({
        local: localType,
        agentConfidence: discountForCitation(0.6, videoType.cited),
      })
    ) {
      suggestions.video_type = {
        value: String(videoType.value).trim(),
        confidence: discountForCitation(0.6, videoType.cited),
        source: 'external_web',
        evidence: `[agent${videoType.cited ? '' : ', uncited'}] ${videoType.evidence || 'sourced video type'}`,
        source_url: citableSourceUrl(videoType.url),
        retrieved_at: retrievedAt,
      };
    }

    const description = readField(payload.fields?.description);
    if (
      typeof description?.value === 'string' &&
      description.value.trim() &&
      shouldPreferAgentField({
        local: suggestions.description,
        agentConfidence: discountForCitation(0.65, description.cited),
      })
    ) {
      suggestions.description = {
        value: description.value.trim().slice(0, META_BOUNDS.descriptionMax),
        confidence: discountForCitation(0.65, description.cited),
        source: 'external_web',
        evidence: `[agent${description.cited ? '' : ', uncited'}] ${description.evidence || 'grounded work description'}`,
        source_url: citableSourceUrl(description.url),
        retrieved_at: retrievedAt,
      };
    }

    const abstract = readField(payload.fields?.abstract);
    if (
      typeof abstract?.value === 'string' &&
      abstract.value.trim() &&
      shouldPreferAgentField({
        local: suggestions.abstract,
        agentConfidence: discountForCitation(0.65, abstract.cited),
      })
    ) {
      suggestions.abstract = {
        value: abstract.value.trim().slice(0, META_BOUNDS.abstractMax),
        confidence: discountForCitation(0.65, abstract.cited),
        source: 'external_web',
        evidence: `[agent${abstract.cited ? '' : ', uncited'}] ${abstract.evidence || 'grounded work abstract'}`,
        source_url: citableSourceUrl(abstract.url),
        retrieved_at: retrievedAt,
      };
    }

    const tags = readField(payload.fields?.tags);
    if (Array.isArray(tags?.value)) {
      const bounded = tags.value
        .map((tag) => String(tag).normalize('NFKC').trim())
        .filter((tag) => tag.length > 0 && tag.length <= META_BOUNDS.tagMaxLen)
        .slice(0, META_BOUNDS.tagsMax);
      if (
        bounded.length > 0 &&
        shouldPreferAgentField({
          local: suggestions.tags,
          agentConfidence: discountForCitation(0.55, tags.cited),
        })
      ) {
        suggestions.tags = {
          value: bounded,
          confidence: discountForCitation(0.55, tags.cited),
          source: 'external_web',
          evidence: `[agent${tags.cited ? '' : ', uncited'}] ${tags.evidence || 'sourced genre keywords'}`,
          source_url: citableSourceUrl(tags.url),
          retrieved_at: retrievedAt,
        };
      }
    }

    // Bug fix (todo/30 S6, part 2): surface every URL the agent touched —
    // cited or not, field-level or candidate/actor-level — as a durable
    // `reference_urls` suggestion. This is deliberately independent of the
    // per-field citation gate above: even an uncited fact, or a citation
    // that didn't pass the (narrow) domain allowlist, is still a page the
    // operator likely wants recorded as "what we consulted" so they can
    // spot-check it before saving.
    const referenceUrls = collectReferenceUrls(payload);
    if (referenceUrls.length > 0) {
      suggestions.reference_urls = {
        value: referenceUrls,
        confidence: 0.5,
        source: 'external_web',
        evidence: '[agent] pages consulted while researching this title',
        retrieved_at: retrievedAt,
      };
    }

    // Agent identified a work: never leave residual Title-clue prose.
    stripLocalTitleProse(suggestions);
  } else {

    // Research ran but abstained/failed structured fill — do not surface
    // local Title-clue description/abstract as if they were researched.
    stripLocalTitleProse(suggestions);
  }

  return {
    ...local,
    suggestions,
    provider: 'local+agent',
    web: {
      used: true,
      status: payload.status,
      reason: payload.notes,
      candidates,
      reads,
      elapsed_ms: elapsedMs,
      agent_id: agentId,
      actor_candidates: actorCandidates,
      actor_candidates_dropped: actorCandidatesDropped,
      tool_trace: toolTrace,
    },
  };
}

/** Prefer Wikipedia / IMDb / TMDB hits that look like the work title. */
export function pickReadableCandidates(
  hits: JinaSearchHit[],
  workTitle: string,
  max: number,
): JinaSearchHit[] {
  const key = workTitle.normalize('NFKC').toLowerCase();
  const scored = hits
    .filter((h) => isAllowlistedUrl(h.url))
    .map((h) => {
      const t = h.title.normalize('NFKC').toLowerCase();
      let score = 0;
      if (t.includes(key) || key.includes(t.slice(0, Math.min(t.length, 40)))) {
        score += 3;
      }
      const host = hostnameOf(h.url) ?? '';
      if (host.includes('wikipedia')) score += 2;
      if (host.includes('imdb') || host.includes('themoviedb')) score += 1;
      return { hit: h, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);

  const out: JinaSearchHit[] = [];
  const seen = new Set<string>();
  for (const row of scored) {
    if (out.length >= max) break;
    if (seen.has(row.hit.url)) continue;
    seen.add(row.hit.url);
    out.push(row.hit);
  }
  return out;
}

const YEAR_IN_TEXT_RE = /\b((?:19|20)\d{2})\b/g;

export function extractConsensusYear(
  texts: string[],
): { year: number; evidence: string } | null {
  const counts = new Map<number, number>();
  for (const text of texts) {
    const found = new Set<number>();
    for (const m of text.matchAll(YEAR_IN_TEXT_RE)) {
      const y = Number(m[1]);
      if (y >= META_BOUNDS.yearMin && y <= META_BOUNDS.yearMax) found.add(y);
    }
    for (const y of found) counts.set(y, (counts.get(y) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (ranked.length === 0) return null;
  const [year, n] = ranked[0]!;
  if (ranked.length > 1 && n === ranked[1]![1]) return null;
  return {
    year,
    evidence: `Web sources agree on year ${year} (${n} page(s))`,
  };
}

function skipped(
  local: LocalSuggestResult,
  reason: string,
  elapsed_ms = 0,
): EnrichedSuggestResult {
  return {
    ...local,
    provider: 'local',
    web: {
      used: false,
      status: 'skipped',
      reason,
      candidates: [],
      reads: [],
      elapsed_ms,
    },
  };
}

async function enrichViaAgentBuilder(params: {
  local: LocalSuggestResult;
  cfg: AppConfig;
  work: string;
  t0: number;
  signal?: AbortSignal;
  onProgress?: (stage: SuggestProgressStage) => void;
}): Promise<EnrichedSuggestResult> {
  const { local, cfg, work, t0, signal, onProgress } = params;
  let toolTrace: AgentToolTraceEntry[] | undefined;
  try {
    onProgress?.('researching');
    const payload = await converseSuggestAgent({
      rawTitle: local.title_clues.normalized || work,
      workTitle: work,
      yearHint: local.suggestions.year?.value ?? null,
      videoTypeHint: local.suggestions.video_type?.value ?? null,
      cfg,
      signal,
      onTrace: (trace) => {
        toolTrace = trace;
      },
    });
    onProgress?.('validating');
    return applyAgentPayloadToLocal({
      local,
      payload,
      maxReads: cfg.SUGGEST_WEB_MAX_READS,
      retrievedAt: new Date().toISOString(),
      agentId: cfg.SUGGEST_AGENT_ID.trim() || undefined,
      elapsedMs: Math.round(performance.now() - t0),
      toolTrace,
    });
  } catch (err) {
    const reason =
      err instanceof AgentBuilderError ? err.code : 'transport';
    // Bug fix (todo/30 S1): this failure used to be swallowed entirely — no
    // server log, and the client never read `web.status`/`web.reason`, so an
    // outage was indistinguishable from a real (if empty) result. Log here;
    // the client-side surface fix is in EditMetadataFlyout.tsx.
    console.error(
      JSON.stringify({
        ok: false,
        area: 'suggest_web',
        phase: 'agent_builder_enrichment_failed',
        reason,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    const suggestions = { ...local.suggestions };
    stripLocalTitleProse(suggestions);
    return {
      ...local,
      suggestions,
      provider: 'local',
      web: {
        used: false,
        status: 'unavailable',
        reason,
        candidates: [],
        reads: [],
        elapsed_ms: Math.round(performance.now() - t0),
        agent_id: cfg.SUGGEST_AGENT_ID.trim() || undefined,
      },
    };
  }
}

/** Dev/optional direct REST path — not the product path. */
async function enrichViaJinaRest(params: {
  local: LocalSuggestResult;
  cfg: AppConfig;
  work: string;
  t0: number;
  signal?: AbortSignal;
  onProgress?: (stage: SuggestProgressStage) => void;
}): Promise<EnrichedSuggestResult> {
  const { local, cfg, work, t0, signal, onProgress } = params;
  try {
    onProgress?.('researching');
    const query = `"${work}" (film OR movie OR 电影 OR 映画 OR 영화)`;
    const hits = await jinaSearchWeb({
      query,
      num: 5,
      cfg,
      timeoutMs: cfg.SUGGEST_WEB_TIMEOUT_MS,
      signal,
    });
    const candidates: SuggestWebCandidate[] = hits
      .filter((hit) => isAllowlistedUrl(hit.url))
      .slice(0, 8)
      .map((hit) => ({
        provider: 'jina' as const,
        title: hit.title,
        url: hit.url,
        snippet: hit.description.slice(0, 280),
        allowlisted: true,
      }));
    const readable = pickReadableCandidates(
      hits,
      work,
      cfg.SUGGEST_WEB_MAX_READS,
    );

    if (readable.length === 0) {
      return {
        ...local,
        provider: 'local+jina',
        web: {
          used: true,
          status: candidates.some((c) => c.allowlisted) ? 'ambiguous' : 'empty',
          reason: 'no_allowlisted_match',
          candidates,
          reads: [],
          elapsed_ms: Math.round(performance.now() - t0),
        },
      };
    }

    const reads: Array<{ url: string; title: string; content: string }> = [];
    for (const hit of readable) {
      try {
        const page = await jinaReadUrl({
          url: hit.url,
          question: `What is the original release year of "${work}"? Quote the year and work title only.`,
          cfg,
          timeoutMs: cfg.SUGGEST_WEB_TIMEOUT_MS,
          signal,
        });
        if (!isAllowlistedUrl(page.url)) continue;
        reads.push({
          url: page.url,
          title: page.title,
          content: page.content.slice(0, 4000),
        });
      } catch {
        // skip
      }
    }

    const suggestions = { ...local.suggestions };
    const retrievedAt = new Date().toISOString();
    onProgress?.('validating');
    if (!suggestions.year && reads.length > 0) {
      const consensus = extractConsensusYear(reads.map((r) => r.content));
      if (consensus) {
        const draft: SuggestFieldDraft<number> = {
          value: consensus.year,
          confidence: 0.55,
          source: 'external_web',
          evidence: `[jina-rest] ${consensus.evidence}; sources: ${reads
            .map((r) => r.url)
            .join(', ')}`,
          source_url: reads[0]!.url,
          retrieved_at: retrievedAt,
        };
        suggestions.year = draft;
      }
    }
    if (suggestions.description && reads[0]) {
      suggestions.description = {
        ...suggestions.description,
        evidence: `${suggestions.description.evidence} · work page: ${reads[0].url}`,
      };
    }

    return {
      ...local,
      suggestions,
      provider: 'local+jina',
      web: {
        used: true,
        status: reads.length > 0 ? 'ok' : 'empty',
        candidates,
        reads: reads.map((r) => ({ url: r.url, title: r.title })),
        elapsed_ms: Math.round(performance.now() - t0),
      },
    };
  } catch (err) {
    const reason = err instanceof JinaWebError ? err.code : 'transport';
    return {
      ...local,
      provider: 'local',
      web: {
        used: false,
        status: 'unavailable',
        reason,
        candidates: [],
        reads: [],
        elapsed_ms: Math.round(performance.now() - t0),
      },
    };
  }
}

/**
 * Enrich local Suggest via Agent Builder (product) or optional Jina REST.
 */
export async function enrichSuggestionsWithWeb(params: {
  local: LocalSuggestResult;
  cfg?: AppConfig;
  signal?: AbortSignal;
  onProgress?: (stage: SuggestProgressStage) => void;
}): Promise<EnrichedSuggestResult> {
  const cfg = params.cfg ?? getConfig();
  const local = params.local;
  const t0 = performance.now();

  const work = local.title_clues.work_title?.trim();
  if (!work || local.title_clues.abstained) {
    return skipped(local, 'no_work_title', Math.round(performance.now() - t0));
  }

  if (cfg.SUGGEST_WEB_PROVIDER === 'agent_builder') {
    if (!isAgentBuilderSuggestConfigured(cfg)) {
      return skipped(local, 'agent_builder_not_configured');
    }
    return enrichViaAgentBuilder({
      local,
      cfg,
      work,
      t0,
      signal: params.signal,
      onProgress: params.onProgress,
    });
  }

  if (cfg.SUGGEST_WEB_PROVIDER === 'jina') {
    if (!isJinaWebConfigured(cfg)) {
      return skipped(local, 'jina_rest_not_configured');
    }
    return enrichViaJinaRest({
      local,
      cfg,
      work,
      t0,
      signal: params.signal,
      onProgress: params.onProgress,
    });
  }

  return skipped(local, 'provider_off');
}
