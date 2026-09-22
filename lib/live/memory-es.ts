import type { LiveEsClient } from './es-doc';
import { VersionConflictError } from './concurrency';

type StoredDoc = {
  source: Record<string, unknown>;
  _seq_no: number;
  _primary_term: number;
};

/**
 * Minimal in-memory Elasticsearch stand-in for repository unit tests.
 * Supports get/index with if_seq_no / if_primary_term / op_type=create.
 */
export function createMemoryLiveEsClient(): {
  client: LiveEsClient;
  store: Map<string, StoredDoc>;
} {
  const store = new Map<string, StoredDoc>();
  const key = (index: string, id: string) => `${index}::${id}`;

  const client = {
    async get<T>(params: { index: string; id: string }) {
      const hit = store.get(key(params.index, params.id));
      if (!hit) {
        const err = Object.assign(new Error('not_found'), {
          meta: { statusCode: 404 },
        });
        throw err;
      }
      return {
        _id: params.id,
        found: true,
        _source: hit.source as T,
        _seq_no: hit._seq_no,
        _primary_term: hit._primary_term,
      };
    },

    async index(params: {
      index: string;
      id?: string;
      document?: unknown;
      op_type?: string;
      if_seq_no?: number;
      if_primary_term?: number;
      refresh?: boolean | 'wait_for';
    }) {
      const id = params.id;
      if (!id) throw new Error('id required');
      const k = key(params.index, id);
      const existing = store.get(k);

      if (params.op_type === 'create' && existing) {
        throw Object.assign(new Error('version_conflict'), {
          meta: {
            statusCode: 409,
            body: { error: { type: 'version_conflict_engine_exception' } },
          },
        });
      }

      if (
        params.if_seq_no !== undefined ||
        params.if_primary_term !== undefined
      ) {
        if (
          !existing ||
          existing._seq_no !== params.if_seq_no ||
          existing._primary_term !== params.if_primary_term
        ) {
          throw new VersionConflictError('memory version conflict');
        }
      }

      const nextSeq = existing ? existing._seq_no + 1 : 0;
      const nextTerm = existing?._primary_term ?? 1;
      store.set(k, {
        source: { ...(params.document as Record<string, unknown>) },
        _seq_no: nextSeq,
        _primary_term: nextTerm,
      });
      return {
        _id: id,
        _seq_no: nextSeq,
        _primary_term: nextTerm,
        result: existing ? 'updated' : 'created',
      };
    },

    async update() {
      throw new Error('not implemented in memory client');
    },

    async search(params: {
      index: string;
      size?: number;
      seq_no_primary_term?: boolean;
      search_after?: unknown[];
      query?: Record<string, unknown>;
      sort?: Array<Record<string, 'asc' | 'desc' | unknown>>;
    }) {
      void params.seq_no_primary_term;
      const size = params.size ?? 100;

      const coerceSortable = (raw: unknown): number | string => {
        if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
        if (typeof raw === 'string') {
          const parsed = Date.parse(raw);
          if (Number.isFinite(parsed)) return parsed;
          return raw;
        }
        return String(raw ?? '');
      };

      const matchClause = (
        clause: Record<string, unknown> | undefined,
        doc: StoredDoc,
        id: string,
      ): boolean => {
        if (!clause) return true;
        if (clause.match_all) return true;
        if (clause.ids) {
          const values = (clause.ids as { values?: unknown[] }).values ?? [];
          return values.map(String).includes(id);
        }
        if (clause.term) {
          for (const [k, v] of Object.entries(
            clause.term as Record<string, unknown>,
          )) {
            if (String(doc.source[k] ?? '') !== String(v)) return false;
          }
          return true;
        }
        if (clause.exists) {
          const field = (clause.exists as { field?: string }).field;
          if (!field) return false;
          const v = doc.source[field];
          return v !== undefined && v !== null && v !== '';
        }
        if (clause.range) {
          for (const [field, spec] of Object.entries(
            clause.range as Record<string, Record<string, unknown>>,
          )) {
            const raw = doc.source[field];
            let n =
              typeof raw === 'number' ? raw : Number(raw);
            if (!Number.isFinite(n) && typeof raw === 'string') {
              n = Date.parse(raw);
            }
            const coerceBound = (
              b: unknown,
            ): number | undefined => {
              if (b === undefined || b === null) return undefined;
              if (typeof b === 'number') return b;
              const parsed = Date.parse(String(b));
              return Number.isFinite(parsed) ? parsed : Number(b);
            };
            const gt = coerceBound(spec.gt);
            const gte = coerceBound(spec.gte);
            const lt = coerceBound(spec.lt);
            const lte = coerceBound(spec.lte);
            if (!Number.isFinite(n)) return false;
            if (gt !== undefined && !(n > gt)) return false;
            if (gte !== undefined && !(n >= gte)) return false;
            if (lt !== undefined && !(n < lt)) return false;
            if (lte !== undefined && !(n <= lte)) return false;
          }
          return true;
        }
        if (clause.bool) {
          const b = clause.bool as {
            filter?: Array<Record<string, unknown>>;
            must?: Array<Record<string, unknown>>;
            must_not?: Array<Record<string, unknown>>;
            should?: Array<Record<string, unknown>>;
            minimum_should_match?: number;
          };
          for (const f of b.filter ?? []) {
            if (!matchClause(f, doc, id)) return false;
          }
          for (const f of b.must ?? []) {
            if (!matchClause(f, doc, id)) return false;
          }
          for (const f of b.must_not ?? []) {
            if (matchClause(f, doc, id)) return false;
          }
          if (b.should?.length) {
            const min = b.minimum_should_match ?? 1;
            let matched = 0;
            for (const f of b.should) {
              if (matchClause(f, doc, id)) matched += 1;
            }
            if (matched < min) return false;
          }
          return true;
        }
        void id;
        return true;
      };

      const hits: Array<{
        _id: string;
        _index: string;
        _source: Record<string, unknown>;
        _seq_no: number;
        _primary_term: number;
        sort: unknown[];
      }> = [];
      for (const [k, doc] of store) {
        if (!k.startsWith(`${params.index}::`)) continue;
        const id = k.slice(params.index.length + 2);
        if (!matchClause(params.query, doc, id)) continue;

        const sortVals: unknown[] = [];
        for (const s of params.sort ?? []) {
          const field = Object.keys(s)[0];
          if (!field) continue;
          if (field === '_id') sortVals.push(id);
          else sortVals.push(doc.source[field] ?? null);
        }
        hits.push({
          _id: id,
          _index: params.index,
          _source: doc.source,
          _seq_no: doc._seq_no,
          _primary_term: doc._primary_term,
          sort: sortVals.length ? sortVals : [id],
        });
      }

      if (params.sort?.length) {
        hits.sort((a, b) => {
          for (let i = 0; i < (params.sort?.length ?? 0); i++) {
            const spec = params.sort![i]!;
            const field = Object.keys(spec)[0]!;
            const dir = spec[field];
            const descending =
              dir === 'desc' ||
              (typeof dir === 'object' &&
                dir !== null &&
                (dir as { order?: string }).order === 'desc');
            const av = coerceSortable(
              field === '_id' ? a._id : a._source[field],
            );
            const bv = coerceSortable(
              field === '_id' ? b._id : b._source[field],
            );
            let cmp = 0;
            if (typeof av === 'number' && typeof bv === 'number') {
              cmp = av - bv;
            } else {
              cmp = String(av).localeCompare(String(bv));
            }
            if (cmp !== 0) return descending ? -cmp : cmp;
          }
          return 0;
        });
      }

      let start = 0;
      if (params.search_after?.length) {
        const after = params.search_after;
        start = hits.findIndex((h) => {
          for (let i = 0; i < after.length; i++) {
            const av = coerceSortable(h.sort[i]);
            const bv = coerceSortable(after[i]);
            let cmp = 0;
            if (typeof av === 'number' && typeof bv === 'number') {
              cmp = av - bv;
            } else {
              cmp = String(av).localeCompare(String(bv));
            }
            if (cmp > 0) return true;
            if (cmp < 0) return false;
          }
          return false; // equal → keep looking for strictly greater
        });
        if (start < 0) start = hits.length;
      }

      return { hits: { hits: hits.slice(start, start + size) } };
    },

    async bulk(params: {
      refresh?: boolean | 'wait_for';
      operations?: unknown[];
    }) {
      const ops = params.operations ?? [];
      const items: Array<Record<string, unknown>> = [];
      let errors = false;
      for (let i = 0; i < ops.length; i += 2) {
        const meta = ops[i] as { create?: { _index: string; _id: string } };
        const doc = ops[i + 1];
        const create = meta?.create;
        if (!create) {
          errors = true;
          items.push({
            create: { status: 400, error: { reason: 'unsupported op' } },
          });
          continue;
        }
        const k = key(create._index, create._id);
        if (store.has(k)) {
          errors = true;
          items.push({
            create: {
              _id: create._id,
              status: 409,
              error: { type: 'version_conflict_engine_exception' },
            },
          });
          continue;
        }
        store.set(k, {
          source: { ...(doc as Record<string, unknown>) },
          _seq_no: 0,
          _primary_term: 1,
        });
        items.push({
          create: { _id: create._id, status: 201, result: 'created' },
        });
      }
      return { errors, items };
    },

    async delete(params: { index: string; id: string }) {
      const k = key(params.index, params.id);
      const existed = store.delete(k);
      return { result: existed ? 'deleted' : 'not_found' };
    },

    async deleteByQuery(params: {
      index: string;
      query?: {
        ids?: { values?: string[] };
        match_all?: Record<string, never>;
        term?: Record<string, string | number>;
        bool?: {
          filter?: Array<{
            term?: Record<string, string | number>;
            range?: Record<
              string,
              { gt?: unknown; gte?: unknown; lt?: unknown; lte?: unknown }
            >;
          }>;
        };
      };
      refresh?: boolean | 'wait_for';
    }) {
      const ids = new Set(params.query?.ids?.values ?? []);
      let deleted = 0;
      for (const [k] of [...store.entries()]) {
        if (!k.startsWith(`${params.index}::`)) continue;
        const id = k.slice(params.index.length + 2);
        if (ids.size > 0 && !ids.has(id)) continue;
        store.delete(k);
        deleted += 1;
      }
      return { deleted };
    },
  } as unknown as LiveEsClient;

  return { client, store };
}
