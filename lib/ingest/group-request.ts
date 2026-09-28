/**
 * Optional ingest-time `group_id` — seeds `meta.group_id` on first asset
 * create so search can hard-filter by group. Free-form names allowed.
 */
import { z } from 'zod';
import { META_BOUNDS, normalizeGroupId } from '../metadata/catalogs';
import { IngestError } from './errors';

/** Shared Zod field for JSON ingest bodies (url/local/folder). */
export const ingestGroupIdField = {
  group_id: z.string().min(1).max(META_BOUNDS.groupIdMaxLen).optional(),
};

/** Validate a free-form group name; empty/absent → undefined (no seed). */
export function resolveIngestGroupId(
  raw: string | null | undefined,
): string | undefined {
  if (raw == null) return undefined;
  const id = normalizeGroupId(raw);
  if (!id) return undefined;
  if (id.length > META_BOUNDS.groupIdMaxLen) {
    throw new IngestError('INGEST_INVALID_GROUP');
  }
  return id;
}

/** Read `group_id` from multipart FormData. */
export function parseGroupIdFromFormData(
  form: FormData,
): string | undefined {
  const raw = form.get('group_id');
  if (typeof raw !== 'string') return undefined;
  return resolveIngestGroupId(raw);
}
