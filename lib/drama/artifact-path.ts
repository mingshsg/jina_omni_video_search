/** Portable, path-free artifact identity; legacy roots may differ across hosts. */
export function dramaArtifactRelativePath(raw: string | undefined, videoId: string, runId: string): string | undefined {
  if (!raw) return undefined;
  const parts = raw.split(/[\\/]/).filter(Boolean);
  if (parts.some((part) => part === '.' || part === '..')) return undefined;
  const absolute = raw.startsWith('/') || /^[A-Za-z]:[\\/]/.test(raw);
  // Match the entire video/run anchor, never just a coincidentally matching run ID.
  const marker = parts.findIndex((part, i) => part === 'media' && parts[i + 1] === videoId && parts[i + 2] === 'drama' && parts[i + 3] === runId);
  const relative = absolute ? (marker < 0 ? [] : parts.slice(marker + 4)) : parts;
  return relative.length >= 2 && relative.every((part) => /^[\w.-]+$/.test(part)) ? relative.join('/') : undefined;
}
