/**
 * Client-safe decision helpers for the shared catalogs responses (todo/40 R4).
 *
 * Both actor clients (`SearchFacets`, `EditMetadataFlyout`) consume the same
 * `GET /api/metadata/catalogs` body; keeping the "is the person catalog
 * usable?" rule here means the two components cannot drift apart and the rule
 * is unit-tested in the `lib/**` Vitest include (the components themselves are
 * not).
 */
import type { GroupAvailabilityStatus } from './group-availability-types';

export type PeopleStatusCarrier = {
  people_status?: 'ok' | 'unavailable';
};

/**
 * True when the actor catalog is known to be unavailable. An older server
 * response omits `people_status`; treat that as available so the two clients
 * stay backward compatible with a deployment that predates the field.
 */
export function peopleCatalogUnavailable(
  payload: PeopleStatusCarrier | null | undefined,
): boolean {
  return payload?.people_status === 'unavailable';
}

/** True when group enumeration is known to be unavailable. */
export function groupCatalogUnavailable(
  status: GroupAvailabilityStatus | undefined | null,
): boolean {
  return status === 'unavailable';
}
