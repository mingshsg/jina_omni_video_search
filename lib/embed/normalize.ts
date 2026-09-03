import type { NormalizedBy } from '../ingest/variant';

/** L2-normalize a vector in place; returns the same array reference. */
export function l2NormalizeInPlace(vec: number[]): number[] {
  let sumSq = 0;
  for (const x of vec) sumSq += x * x;
  const norm = Math.sqrt(sumSq);
  if (norm === 0 || !Number.isFinite(norm)) return vec;
  for (let i = 0; i < vec.length; i++) vec[i] /= norm;
  return vec;
}

/** L2-normalize a copy of the vector. */
export function l2Normalize(vec: number[]): number[] {
  return l2NormalizeInPlace([...vec]);
}

/** Apply normalization policy — provider-owned vectors pass through unchanged. */
export function ensureNormalized(
  vec: number[],
  normalizedBy: NormalizedBy,
): number[] {
  if (normalizedBy === 'provider') return vec;
  return l2Normalize(vec);
}

/** Cosine similarity for same-length vectors (assumes L2-normalized). */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return NaN;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i]! * b[i]!;
  return dot;
}
