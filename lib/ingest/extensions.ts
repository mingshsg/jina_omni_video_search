/** Whitelisted video container extensions (lowercase, with leading dot). */
export const ALLOWED_VIDEO_EXTENSIONS = new Set([
  '.mp4',
  '.mov',
  '.mkv',
  '.webm',
  '.avi',
  '.m4v',
  '.mpeg',
  '.mpg',
  '.wmv',
  '.flv',
  '.ts',
  '.m2ts',
]);

export function extensionOf(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? filename;
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return '';
  return base.slice(dot).toLowerCase();
}

export function isAllowedVideoExtension(filename: string): boolean {
  const ext = extensionOf(filename);
  return ext.length > 0 && ALLOWED_VIDEO_EXTENSIONS.has(ext);
}
