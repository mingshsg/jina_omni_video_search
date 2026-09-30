import { titleFromFilename } from './media-name';

/**
 * Derive a display title from a URL's final path segment. URL.pathname is
 * percent encoded for non-ASCII filenames; decode only the segment after
 * splitting, so an encoded slash cannot change which segment we select.
 * Malformed escapes retain the original segment instead of failing ingest.
 */
export function titleFromUrlPath(sourceOriginPath: string): string {
  let pathname: string;
  try {
    pathname = new URL(sourceOriginPath).pathname;
  } catch {
    return '';
  }
  const segment = pathname.split('/').filter(Boolean).pop();
  if (!segment) return '';
  let decoded = segment;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    // Keep the recognizable raw name when the URL contains invalid escapes.
  }
  // An encoded slash belongs to the filename, not a new path component.
  return titleFromFilename(decoded.replace(/[/\\]/g, '-'));
}
