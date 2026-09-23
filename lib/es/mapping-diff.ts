/**
 * Recursive mapping compare for idempotent `putMapping` upgrades.
 * Adds missing properties; fails on incompatible existing types/analyzers/copy_to.
 */

export type MappingConflict = {
  path: string;
  reason: string;
  existing: unknown;
  desired: unknown;
};

export type MappingDiffResult = {
  /** Dotted paths that already match the desired definition. */
  alreadyPresent: string[];
  /** Nested property tree suitable for `indices.putMapping({ properties })`. */
  toPut: Record<string, unknown>;
  /** Dotted paths that will be added by toPut. */
  addedPaths: string[];
  /** Incompatible existing fields that require a reindex. */
  conflicts: MappingConflict[];
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Comparable scalar keys on a field mapping (ignore irrelevant nesting). */
const SCALAR_KEYS = [
  'type',
  'analyzer',
  'search_analyzer',
  'normalizer',
  'index',
  'dims',
  'similarity',
  'ignore_above',
] as const;

function copyToNormalized(value: unknown): string[] {
  if (value == null) return [];
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string').sort();
  }
  return [];
}

function scalarMismatch(
  path: string,
  existing: Record<string, unknown>,
  desired: Record<string, unknown>,
): MappingConflict | null {
  for (const key of SCALAR_KEYS) {
    if (!(key in desired)) continue;
    if (!(key in existing)) {
      // Elasticsearch often omits `type: "object"` on getMapping when the
      // field already has nested `properties` — treat that as compatible.
      if (
        key === 'type' &&
        desired.type === 'object' &&
        isPlainObject(existing.properties)
      ) {
        continue;
      }
      // Adding a scalar setting to an existing field usually needs reindex.
      return {
        path: `${path}.${key}`,
        reason: `cannot add '${key}' to an existing field without reindex`,
        existing: existing[key],
        desired: desired[key],
      };
    }
    if (JSON.stringify(existing[key]) !== JSON.stringify(desired[key])) {
      return {
        path: `${path}.${key}`,
        reason: `'${key}' differs`,
        existing: existing[key],
        desired: desired[key],
      };
    }
  }

  if ('copy_to' in desired) {
    const want = copyToNormalized(desired.copy_to);
    const have = copyToNormalized(existing.copy_to);
    if (JSON.stringify(want) !== JSON.stringify(have)) {
      return {
        path: `${path}.copy_to`,
        reason: 'copy_to differs',
        existing: existing.copy_to,
        desired: desired.copy_to,
      };
    }
  }

  return null;
}

/**
 * Diff `desired` against `existing` (both are `properties` maps).
 * Returns a nested `toPut` containing only missing branches.
 */
export function diffMappingProperties(
  desired: Record<string, unknown>,
  existing: Record<string, unknown> | undefined,
  prefix = '',
): MappingDiffResult {
  const alreadyPresent: string[] = [];
  const addedPaths: string[] = [];
  const conflicts: MappingConflict[] = [];
  const toPut: Record<string, unknown> = {};

  for (const [name, desiredField] of Object.entries(desired)) {
    const path = prefix ? `${prefix}.${name}` : name;
    if (!isPlainObject(desiredField)) {
      conflicts.push({
        path,
        reason: 'desired field must be an object',
        existing: existing?.[name],
        desired: desiredField,
      });
      continue;
    }

    const existingField = existing?.[name];

    if (existingField === undefined) {
      toPut[name] = desiredField;
      addedPaths.push(path);
      continue;
    }

    if (!isPlainObject(existingField)) {
      conflicts.push({
        path,
        reason: 'existing field is not an object mapping',
        existing: existingField,
        desired: desiredField,
      });
      continue;
    }

    const mismatch = scalarMismatch(path, existingField, desiredField);
    if (mismatch) {
      conflicts.push(mismatch);
      continue;
    }

    // Recurse into nested `properties` and multi-fields `fields`.
    const childBuckets: Array<'properties' | 'fields'> = [
      'properties',
      'fields',
    ];
    let childAdded = false;
    const mergedChild: Record<string, unknown> = { ...desiredField };

    for (const bucket of childBuckets) {
      const desiredChildren = desiredField[bucket];
      if (!isPlainObject(desiredChildren)) {
        delete mergedChild[bucket];
        continue;
      }
      const existingChildren = isPlainObject(existingField[bucket])
        ? (existingField[bucket] as Record<string, unknown>)
        : undefined;

      if (existingChildren === undefined && Object.keys(desiredChildren).length > 0) {
        // Parent exists but child bucket is missing entirely — add it.
        // Changing an existing field's `fields`/`properties` via putMapping
        // is allowed for *new* children under object/text.
        const childDiff = diffMappingProperties(
          desiredChildren,
          undefined,
          `${path}.${bucket}`,
        );
        conflicts.push(...childDiff.conflicts);
        if (Object.keys(childDiff.toPut).length > 0) {
          mergedChild[bucket] = childDiff.toPut;
          addedPaths.push(...childDiff.addedPaths);
          childAdded = true;
        }
        alreadyPresent.push(...childDiff.alreadyPresent);
        continue;
      }

      const childDiff = diffMappingProperties(
        desiredChildren,
        existingChildren,
        `${path}.${bucket}`,
      );
      conflicts.push(...childDiff.conflicts);
      alreadyPresent.push(...childDiff.alreadyPresent);
      if (Object.keys(childDiff.toPut).length > 0) {
        mergedChild[bucket] = childDiff.toPut;
        addedPaths.push(...childDiff.addedPaths);
        childAdded = true;
      } else {
        delete mergedChild[bucket];
      }
    }

    if (childAdded) {
      // putMapping for nested object: only send the object wrapper + new children
      const putField: Record<string, unknown> = {};
      if (desiredField.type) putField.type = desiredField.type;
      if (mergedChild.properties) putField.properties = mergedChild.properties;
      if (mergedChild.fields) putField.fields = mergedChild.fields;
      toPut[name] = putField;
    } else if (conflicts.every((c) => !c.path.startsWith(path))) {
      alreadyPresent.push(path);
    }
  }

  return { alreadyPresent, toPut, addedPaths, conflicts };
}

export class MappingUpgradeConflictError extends Error {
  readonly code = 'MAPPING_UPGRADE_CONFLICT';
  readonly conflicts: MappingConflict[];

  constructor(conflicts: MappingConflict[]) {
    const summary = conflicts
      .slice(0, 5)
      .map((c) => `${c.path}: ${c.reason}`)
      .join('; ');
    super(
      `Mapping upgrade blocked (${conflicts.length} conflict(s)): ${summary}`,
    );
    this.name = 'MappingUpgradeConflictError';
    this.conflicts = conflicts;
  }
}
