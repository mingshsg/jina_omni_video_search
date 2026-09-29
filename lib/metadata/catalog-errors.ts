/**
 * Fixed public error codes + a sanitizer for catalog enumeration failures
 * (todo/40 R4). Pure module — no server imports — so both server routes and
 * client-consumed payload builders/types can share the same literals without
 * dragging the Elasticsearch client into a client bundle.
 *
 * Hard invariant 4 (AGENTS.md): an API response must never carry a raw
 * exception message, a file path, or a credential. Enumeration helpers return
 * one of these fixed codes; the sanitized detail goes to a server-side log
 * callback instead.
 */

/** `GET /api/metadata/catalogs` — person catalog could not be loaded. */
export const PEOPLE_CATALOG_UNAVAILABLE = 'PEOPLE_CATALOG_UNAVAILABLE';
/** `GET /api/metadata/catalogs` — group terms aggregation failed. */
export const GROUP_CATALOG_UNAVAILABLE = 'GROUP_CATALOG_UNAVAILABLE';
/** `GET /api/metadata/group-availability` — enumeration failed. */
export const GROUP_AVAILABILITY_UNAVAILABLE = 'GROUP_AVAILABILITY_UNAVAILABLE';

export type CatalogErrorCode =
  | typeof PEOPLE_CATALOG_UNAVAILABLE
  | typeof GROUP_CATALOG_UNAVAILABLE
  | typeof GROUP_AVAILABILITY_UNAVAILABLE;

/**
 * Strip credentials from an internal error message before it is logged.
 * This is *only* for server-side logging — the sanitized text is never placed
 * in a response body.
 */
export function sanitizeCatalogError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.replace(/ApiKey\s+\S+/gi, 'ApiKey [redacted]');
}
