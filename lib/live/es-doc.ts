import type { Client } from '@elastic/elasticsearch';
import { getEsClient } from '../es/client';
import {
  isVersionConflictError,
  VersionConflictError,
} from './concurrency';
import type { EsVersionMeta, VersionedDoc } from './types';

export type LiveEsClient = {
  get: (
    params: Parameters<Client['get']>[0],
  ) => ReturnType<Client['get']>;
  index: (
    params: Parameters<Client['index']>[0],
  ) => ReturnType<Client['index']>;
  update: (
    params: Parameters<Client['update']>[0],
  ) => ReturnType<Client['update']>;
  delete: (
    params: Parameters<Client['delete']>[0],
  ) => ReturnType<Client['delete']>;
  bulk: (
    params: Parameters<Client['bulk']>[0],
  ) => ReturnType<Client['bulk']>;
  /** Optional — used by A-20 age-delete against data streams / plain indices. */
  deleteByQuery?: (
    params: Parameters<Client['deleteByQuery']>[0],
  ) => ReturnType<Client['deleteByQuery']>;
  // Unbound method types so repository `this.client.*` calls typecheck under Next build.
  search: (
    params: Parameters<Client['search']>[0],
  ) => ReturnType<Client['search']>;
};

export function defaultLiveEsClient(): LiveEsClient {
  const client = getEsClient();
  return {
    get: (params) => client.get(params),
    index: (params) => client.index(params),
    update: (params) => client.update(params),
    delete: (params) => client.delete(params),
    bulk: (params) => client.bulk(params),
    deleteByQuery: (params) => client.deleteByQuery(params),
    search: (params) => client.search(params),
  };
}

function statusCode(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null || !('meta' in err)) {
    return undefined;
  }
  const meta = (err as { meta?: { statusCode?: number } }).meta;
  return typeof meta?.statusCode === 'number' ? meta.statusCode : undefined;
}

export async function getVersionedDoc<T>(
  client: LiveEsClient,
  index: string,
  id: string,
): Promise<VersionedDoc<T> | null> {
  try {
    const res = (await client.get({ index, id })) as {
      found?: boolean;
      _id: string;
      _source?: T;
      _seq_no?: number;
      _primary_term?: number;
    };
    if (!res.found || res._source === undefined) return null;
    if (res._seq_no === undefined || res._primary_term === undefined) {
      throw new Error(`Document ${index}/${id} missing seq_no/primary_term`);
    }
    return {
      id: res._id,
      source: res._source,
      _seq_no: res._seq_no,
      _primary_term: res._primary_term,
    };
  } catch (err) {
    if (statusCode(err) === 404) return null;
    throw err;
  }
}

export async function indexWithVersion<T extends object>(
  client: LiveEsClient,
  params: {
    index: string;
    id: string;
    document: T;
    opType?: 'index' | 'create';
    version?: EsVersionMeta;
    refresh?: boolean | 'wait_for';
  },
): Promise<EsVersionMeta> {
  try {
    const res = await client.index({
      index: params.index,
      id: params.id,
      document: params.document,
      op_type: params.opType ?? 'index',
      ...(params.version
        ? {
            if_seq_no: params.version._seq_no,
            if_primary_term: params.version._primary_term,
          }
        : {}),
      refresh: params.refresh ?? 'wait_for',
    });
    if (res._seq_no === undefined || res._primary_term === undefined) {
      throw new Error(`Index response for ${params.index}/${params.id} missing version`);
    }
    return { _seq_no: res._seq_no, _primary_term: res._primary_term };
  } catch (err) {
    if (isVersionConflictError(err) || statusCode(err) === 409) {
      throw new VersionConflictError(
        `version conflict writing ${params.index}/${params.id}`,
      );
    }
    throw err;
  }
}
