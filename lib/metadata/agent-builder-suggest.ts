/**
 * Kibana Agent Builder converse client for Suggest enrichment.
 * Uses the operator-configured agent that already has Jina MCP tools
 * (search_web / read_url). No JINA_API_KEY needed in the app process.
 */
import type { AppConfig } from '../config';
import { getConfig } from '../config';
import { canonicalizePrimaryLanguage } from './catalogs';
import { z } from 'zod';

export class AgentBuilderError extends Error {
  readonly code: 'disabled' | 'timeout' | 'http' | 'malformed';

  constructor(code: AgentBuilderError['code'], message: string) {
    super(message);
    this.name = 'AgentBuilderError';
    this.code = code;
  }
}

export interface AgentBuilderFieldDraft {
  value: number | string | string[] | null;
  url?: string | null;
  evidence?: string;
}

/**
 * One tool call the agent made while answering a converse request —
 * surfaced for UI/debugging transparency ("what did it actually search for
 * and read, with what question"). Best-effort: derived from the converse
 * response's `steps` array, which is not part of any documented/stable
 * Agent Builder contract, so parsing is defensive and never throws.
 */
export interface AgentToolTraceEntry {
  tool_id: string;
  /** search_web's query, when present. */
  query?: string;
  /** read_url's scoping question, when present. */
  question?: string;
  /** read_url's target page, when present. */
  url?: string;
}

export interface AgentBuilderSuggestPayload {
  status: 'ok' | 'ambiguous' | 'empty' | 'unavailable';
  candidates?: Array<{
    title?: string;
    url?: string;
    year?: number | null;
    reason?: string;
  }>;
  fields?: {
    year?: AgentBuilderFieldDraft;
    country?: AgentBuilderFieldDraft;
    primary_language?: AgentBuilderFieldDraft;
    video_type?: AgentBuilderFieldDraft;
    description?: AgentBuilderFieldDraft;
    abstract?: AgentBuilderFieldDraft;
    tags?: AgentBuilderFieldDraft;
  };
  actors?: Array<{
    names?: {
      en?: string;
      zh?: string | null;
      /** Actor's own native-script name, only when distinct from en/zh. */
      native?: { lang?: string; name?: string } | null;
    };
    character?: string | null;
    url?: string;
    evidence?: string;
  }>;
  notes?: string;
}

const boundedString = (max: number) => z.string().trim().min(1).max(max);

const agentFieldSchema = z
  .object({
    value: z.union([z.number().int(), z.string().trim().max(480)]),
    url: z.string().trim().max(2048).optional(),
    evidence: z.string().trim().max(500).optional(),
  })
  .strict();

/**
 * `description` alone grew from a 1-2 sentence logline (≤480) to a real
 * 4-7 sentence plot synopsis (≤1600) — see reference/agent-builder/
 * skill-grounded_title_lookup.md "Field rules". Every other field (year,
 * country, primary_language, video_type, abstract) stays on the tighter
 * agentFieldSchema bound; only description needs the room.
 */
const agentDescriptionFieldSchema = z
  .object({
    value: z.string().trim().max(1600),
    url: z.string().trim().max(2048).optional(),
    evidence: z.string().trim().max(500).optional(),
  })
  .strict();

const agentTagsFieldSchema = z
  .object({
    value: z.array(z.string().trim().min(1).max(64)).max(8),
    url: z.string().trim().max(2048).optional(),
    evidence: z.string().trim().max(500).optional(),
  })
  .strict();

const AGENT_FIELD_KEYS = [
  'year',
  'country',
  'primary_language',
  'video_type',
  'description',
  'abstract',
  'tags',
] as const;

const agentSuggestPayloadSchema = z
  .object({
    status: z.enum(['ok', 'ambiguous', 'empty', 'unavailable']),
    candidates: z
      .array(
        z
          .object({
            title: z.string().trim().max(300).optional(),
            url: z.string().trim().max(2048).optional(),
            year: z.number().int().optional(),
            reason: z.string().trim().max(280).optional(),
          })
          .strict(),
      )
      .max(3)
      .optional(),
    fields: z
      .object({
        year: agentFieldSchema.optional(),
        country: agentFieldSchema.optional(),
        primary_language: agentFieldSchema.optional(),
        video_type: agentFieldSchema.optional(),
        description: agentDescriptionFieldSchema.optional(),
        abstract: agentFieldSchema.optional(),
        tags: agentTagsFieldSchema.optional(),
      })
      .strict()
      .optional(),
    actors: z
      .array(
        z
          .object({
            names: z
              .object({
                en: boundedString(160).optional(),
                zh: boundedString(160).optional(),
                native: z
                  .object({
                    lang: boundedString(20),
                    name: boundedString(160),
                  })
                  .strict()
                  .optional(),
              })
              .strict()
              .optional(),
            character: boundedString(160).optional(),
            url: z.string().trim().max(2048).optional(),
            evidence: z.string().trim().max(500).optional(),
          })
          .strict(),
      )
      .max(8)
      .optional(),
    notes: z.string().trim().max(500).optional(),
  })
  .strict()
  .superRefine((payload, ctx) => {
    if (payload.status === 'ok') return;
    for (const key of AGENT_FIELD_KEYS) {
      const field = payload.fields?.[key];
      if (!field) continue;
      const hasValue =
        field.value != null &&
        !(Array.isArray(field.value) && field.value.length === 0);
      if (hasValue || field.url) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['fields', key],
          message: `non-ok status must not return a ${key} proposal`,
        });
      }
    }
    if ((payload.actors?.length ?? 0) > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['actors'],
        message: 'non-ok status must not return actor proposals',
      });
    }
  });

function kibanaBaseUrl(cfg: AppConfig): string {
  const explicit = cfg.KIBANA_URL.trim().replace(/\/$/, '');
  if (explicit) return explicit;
  // Common Cloud pattern: *.es.*.gcp.elastic-cloud.com → *.kb.*.gcp.elastic-cloud.com
  const es = cfg.ELASTICSEARCH_URL.trim().replace(/\/$/, '');
  if (es.includes('.es.')) {
    return es.replace('.es.', '.kb.');
  }
  return '';
}

function kibanaAuthHeader(cfg: AppConfig): string {
  const key = cfg.KIBANA_API_KEY.trim() || cfg.ELASTICSEARCH_API_KEY.trim();
  if (!key) {
    throw new AgentBuilderError('disabled', 'No Kibana/ES API key configured');
  }
  return `ApiKey ${key}`;
}

export function isAgentBuilderSuggestConfigured(cfg?: AppConfig): boolean {
  const c = cfg ?? getConfig();
  if (c.SUGGEST_WEB_PROVIDER !== 'agent_builder') return false;
  if (!c.SUGGEST_AGENT_ID.trim()) return false;
  return Boolean(kibanaBaseUrl(c));
}

/** Drop null / undefined keys recursively so agents that still emit nulls parse. */
export function stripNullKeys(value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  if (Array.isArray(value)) {
    return value
      .map((item) => stripNullKeys(item))
      .filter((item) => item !== undefined);
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const next = stripNullKeys(child);
      if (next === undefined) continue;
      out[key] = next;
    }
    return out;
  }
  return value;
}

function tryParseJson(text: string): unknown | undefined {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Find balanced `{ ... }` slices and return the first that parses as an object. */
function extractBalancedJsonObjects(text: string): unknown[] {
  const found: unknown[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '{') continue;
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let j = i; j < text.length; j++) {
      const ch = text[j]!;
      if (inString) {
        if (escape) {
          escape = false;
        } else if (ch === '\\') {
          escape = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          const slice = text.slice(i, j + 1);
          const parsed = tryParseJson(slice);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            found.push(parsed);
          }
          break;
        }
      }
    }
  }
  return found;
}

/**
 * Extract the Suggest JSON object from an agent message.
 * Handles plain JSON, fenced code, prose wrappers, and nested tool-result text.
 */
export function extractAgentJson(message: string): unknown {
  const trimmed = message.trim();
  if (!trimmed) {
    throw new AgentBuilderError('malformed', 'Agent reply was empty');
  }

  const direct = tryParseJson(trimmed);
  if (direct && typeof direct === 'object' && !Array.isArray(direct)) {
    return direct;
  }

  const fenceRe = /```(?:json)?\s*([\s\S]*?)```/gi;
  const fencedBodies: string[] = [];
  for (const match of trimmed.matchAll(fenceRe)) {
    const body = match[1]?.trim();
    if (body) fencedBodies.push(body);
  }
  // Prefer the last fenced block (final answer after tool chatter).
  for (const body of [...fencedBodies].reverse()) {
    const parsed = tryParseJson(body);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
    const nested = extractBalancedJsonObjects(body);
    const withStatus = nested.find(
      (obj) =>
        typeof obj === 'object' &&
        obj !== null &&
        'status' in (obj as Record<string, unknown>),
    );
    if (withStatus) return withStatus;
    if (nested[0]) return nested[0];
  }

  const candidates = extractBalancedJsonObjects(trimmed);
  const withStatus = candidates.find(
    (obj) =>
      typeof obj === 'object' &&
      obj !== null &&
      'status' in (obj as Record<string, unknown>),
  );
  if (withStatus) return withStatus;
  if (candidates[0]) return candidates[0];

  throw new AgentBuilderError('malformed', 'Agent reply had no JSON object');
}

function coerceYear(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string') {
    const m = value.trim().match(/^(?:19|20)\d{2}$/);
    if (m) return Number(m[0]);
  }
  return undefined;
}

function coerceTagsValue(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    return value.map((tag) => String(tag).trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    const parts = value
      .split(/[,;|/]/)
      .map((part) => part.trim())
      .filter(Boolean);
    return parts.length > 0 ? parts : undefined;
  }
  return undefined;
}

const KNOWN_TOP_KEYS = new Set([
  'status',
  'candidates',
  'fields',
  'actors',
  'notes',
]);

const KNOWN_FIELD_KEYS = new Set<string>(AGENT_FIELD_KEYS);

/**
 * Normalize messy agent JSON into the bounded schema shape before Zod.
 * Strips nulls, unknown keys, empty field stubs, and coerces common types.
 */
export function sanitizeAgentSuggestRaw(raw: unknown): unknown {
  const stripped = stripNullKeys(raw);
  if (!stripped || typeof stripped !== 'object' || Array.isArray(stripped)) {
    return stripped;
  }
  const src = stripped as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const key of Object.keys(src)) {
    if (!KNOWN_TOP_KEYS.has(key)) continue;
    out[key] = src[key];
  }

  if (Array.isArray(out.candidates)) {
    out.candidates = (out.candidates as unknown[])
      .filter((c) => c && typeof c === 'object' && !Array.isArray(c))
      .slice(0, 3)
      .map((c) => {
        const row = { ...(c as Record<string, unknown>) };
        const year = coerceYear(row.year);
        if (year !== undefined) row.year = year;
        else delete row.year;
        for (const k of Object.keys(row)) {
          if (!['title', 'url', 'year', 'reason'].includes(k)) delete row[k];
        }
        return row;
      });
  }

  if (out.fields && typeof out.fields === 'object' && !Array.isArray(out.fields)) {
    const fieldsIn = out.fields as Record<string, unknown>;
    const fieldsOut: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(fieldsIn)) {
      if (!KNOWN_FIELD_KEYS.has(key)) continue;
      if (!val || typeof val !== 'object' || Array.isArray(val)) continue;
      const field = { ...(val as Record<string, unknown>) };
      if (key === 'year') {
        const year = coerceYear(field.value);
        if (year === undefined) continue;
        field.value = year;
      } else if (key === 'tags') {
        const tags = coerceTagsValue(field.value);
        if (!tags || tags.length === 0) continue;
        field.value = tags.slice(0, 8);
      } else if (field.value == null || field.value === '') {
        continue;
      }
      // Drop no-value stubs (null already stripped; empty value skipped above).
      if (typeof field.url === 'string' && !field.url.trim()) delete field.url;
      if (typeof field.evidence === 'string' && !field.evidence.trim()) {
        delete field.evidence;
      }
      for (const k of Object.keys(field)) {
        if (!['value', 'url', 'evidence'].includes(k)) delete field[k];
      }
      fieldsOut[key] = field;
    }
    out.fields = fieldsOut;
  }

  if (Array.isArray(out.actors)) {
    out.actors = (out.actors as unknown[])
      .filter((a) => a && typeof a === 'object' && !Array.isArray(a))
      .slice(0, 8)
      .map((a) => {
        const actor = { ...(a as Record<string, unknown>) };
        if (actor.names && typeof actor.names === 'object' && !Array.isArray(actor.names)) {
          const namesIn = actor.names as Record<string, unknown>;
          const namesOut: Record<string, unknown> = {};
          for (const lang of ['en', 'zh'] as const) {
            const v = namesIn[lang];
            if (typeof v === 'string' && v.trim()) namesOut[lang] = v.trim();
          }
          const nativeIn = namesIn.native;
          if (nativeIn && typeof nativeIn === 'object' && !Array.isArray(nativeIn)) {
            const langRaw = (nativeIn as Record<string, unknown>).lang;
            const nameRaw = (nativeIn as Record<string, unknown>).name;
            const canonicalLang =
              typeof langRaw === 'string' ? canonicalizePrimaryLanguage(langRaw) : null;
            const nativeName =
              typeof nameRaw === 'string' ? nameRaw.normalize('NFKC').trim() : '';
            if (canonicalLang && canonicalLang !== 'other' && nativeName) {
              namesOut.native = { lang: canonicalLang, name: nativeName };
            }
          }
          // Drop native when it just duplicates en/zh — it adds no information.
          const native = namesOut.native as { lang: string; name: string } | undefined;
          if (
            native &&
            (native.name === namesOut.en || native.name === namesOut.zh)
          ) {
            delete namesOut.native;
          }
          actor.names = namesOut;
        }
        if (typeof actor.character === 'string' && !actor.character.trim()) {
          delete actor.character;
        }
        for (const k of Object.keys(actor)) {
          if (!['names', 'character', 'url', 'evidence'].includes(k)) {
            delete actor[k];
          }
        }
        return actor;
      })
      .filter((a) => {
        const names = (a as Record<string, unknown>).names as
          | Record<string, unknown>
          | undefined;
        return Boolean(names && typeof names.en === 'string' && names.en.trim());
      });
  }

  if (typeof out.notes === 'string' && !out.notes.trim()) delete out.notes;

  return out;
}

export function parseAgentSuggestPayload(raw: unknown): AgentBuilderSuggestPayload {
  const sanitized = sanitizeAgentSuggestRaw(raw);
  const parsed = agentSuggestPayloadSchema.safeParse(sanitized);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new AgentBuilderError(
      'malformed',
      `Agent JSON failed validation${issue ? `: ${issue.path.join('.')} ${issue.message}` : ''}`,
    );
  }
  return parsed.data as AgentBuilderSuggestPayload;
}

/** Pull assistant text from a Kibana Agent Builder converse response body. */
export function extractConverseMessage(body: unknown): string {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new AgentBuilderError('malformed', 'Converse response was not an object');
  }
  const root = body as Record<string, unknown>;
  const response = root.response;

  if (typeof response === 'string' && response.trim()) return response;

  if (response && typeof response === 'object' && !Array.isArray(response)) {
    const resp = response as Record<string, unknown>;
    if (typeof resp.message === 'string' && resp.message.trim()) {
      return resp.message;
    }
    if (typeof resp.content === 'string' && resp.content.trim()) {
      return resp.content;
    }
  }

  // Fallback: scan steps for a final assistant message-like string containing JSON.
  const steps = root.steps;
  if (Array.isArray(steps)) {
    for (let i = steps.length - 1; i >= 0; i--) {
      const step = steps[i];
      if (!step || typeof step !== 'object') continue;
      const s = step as Record<string, unknown>;
      for (const key of ['message', 'content', 'text', 'output'] as const) {
        const v = s[key];
        if (typeof v === 'string' && v.includes('{') && v.includes('}')) {
          return v;
        }
      }
      const results = s.results;
      if (Array.isArray(results)) {
        for (const r of results) {
          if (!r || typeof r !== 'object') continue;
          const data = (r as Record<string, unknown>).data;
          if (data && typeof data === 'object') {
            const content = (data as Record<string, unknown>).content;
            if (
              typeof content === 'string' &&
              content.includes('"status"') &&
              content.includes('{')
            ) {
              return content;
            }
          }
        }
      }
    }
  }

  throw new AgentBuilderError('malformed', 'Converse response missing message');
}

/**
 * Best-effort extraction of tool_call steps from a converse response body.
 * Never throws — an empty array just means no trace is available (e.g. the
 * response shape changed, or there simply were no tool calls).
 */
export function extractToolTrace(body: unknown): AgentToolTraceEntry[] {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return [];
  const steps = (body as Record<string, unknown>).steps;
  if (!Array.isArray(steps)) return [];
  const trace: AgentToolTraceEntry[] = [];
  for (const step of steps) {
    if (!step || typeof step !== 'object') continue;
    const s = step as Record<string, unknown>;
    if (s.type !== 'tool_call') continue;
    const toolId = s.tool_id;
    if (typeof toolId !== 'string' || toolId === 'load_skill') continue;
    const rawParams = s.params;
    const p =
      rawParams && typeof rawParams === 'object' ? (rawParams as Record<string, unknown>) : {};
    const entry: AgentToolTraceEntry = { tool_id: toolId };
    if (typeof p.query === 'string') entry.query = p.query;
    if (typeof p.question === 'string') entry.question = p.question;
    if (typeof p.url === 'string') entry.url = p.url;
    trace.push(entry);
  }
  return trace;
}

/**
 * One-shot converse with the metadata research agent.
 * Expects the agent to return the grounded_title_lookup JSON schema.
 */
export async function converseSuggestAgent(params: {
  rawTitle: string;
  workTitle?: string;
  yearHint?: number | null;
  videoTypeHint?: string | null;
  cfg?: AppConfig;
  signal?: AbortSignal;
  /** Best-effort callback with the tool-call trace, for UI/debug display. */
  onTrace?: (trace: AgentToolTraceEntry[]) => void;
}): Promise<AgentBuilderSuggestPayload> {
  const cfg = params.cfg ?? getConfig();
  if (!isAgentBuilderSuggestConfigured(cfg)) {
    throw new AgentBuilderError('disabled', 'Agent Builder Suggest is not configured');
  }

  const base = kibanaBaseUrl(cfg);
  const agentId = cfg.SUGGEST_AGENT_ID.trim();
  const connectorId = cfg.SUGGEST_AGENT_CONNECTOR_ID.trim();
  const timeoutMs = cfg.SUGGEST_WEB_TIMEOUT_MS;

  const input = [
    'grounded_title_lookup',
    `raw_title: ${JSON.stringify(params.rawTitle)}`,
    params.workTitle ? `work_title: ${JSON.stringify(params.workTitle)}` : null,
    params.yearHint != null ? `year_hint: ${params.yearHint}` : null,
    params.videoTypeHint
      ? `video_type_hint: ${JSON.stringify(params.videoTypeHint)}`
      : null,
    'Return ONLY the compact JSON object defined by the skill. Omit unknown keys; never emit null.',
  ]
    .filter(Boolean)
    .join('\n');

  const ac = new AbortController();
  const abortFromCaller = () => ac.abort();
  if (params.signal?.aborted) ac.abort();
  params.signal?.addEventListener('abort', abortFromCaller, { once: true });
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const converseBody: Record<string, unknown> = {
      agent_id: agentId,
      input,
      access_control: { access_mode: 'private' },
    };
    // Per-request model override (Agent Builder converse). Empty → project default.
    if (connectorId) {
      converseBody.connector_id = connectorId;
    }
    const res = await fetch(`${base}/api/agent_builder/converse`, {
      method: 'POST',
      signal: ac.signal,
      headers: {
        Authorization: kibanaAuthHeader(cfg),
        'kbn-xsrf': 'true',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(converseBody),
    });
    if (!res.ok) {
      throw new AgentBuilderError('http', `Kibana converse HTTP ${res.status}`);
    }
    const responseText = await res.text();
    if (responseText.length > 100_000) {
      throw new AgentBuilderError('malformed', 'Converse response exceeded 100 KB');
    }
    let body: unknown;
    try {
      body = JSON.parse(responseText);
    } catch {
      throw new AgentBuilderError('malformed', 'Converse response was not JSON');
    }
    if (params.onTrace) {
      try {
        params.onTrace(extractToolTrace(body));
      } catch {
        // Trace is best-effort UI/debug sugar — never let it fail the request.
      }
    }
    const message = extractConverseMessage(body);
    return parseAgentSuggestPayload(extractAgentJson(message));
  } catch (err) {
    if (err instanceof AgentBuilderError) throw err;
    if (
      (err instanceof DOMException && err.name === 'AbortError') ||
      (err instanceof Error && err.name === 'AbortError')
    ) {
      throw new AgentBuilderError('timeout', 'Agent Builder converse timed out');
    }
    throw new AgentBuilderError(
      'http',
      err instanceof Error ? err.message : 'Agent Builder converse failed',
    );
  } finally {
    clearTimeout(timer);
    params.signal?.removeEventListener('abort', abortFromCaller);
  }
}
