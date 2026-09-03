import type { IngestErrorCode } from '../ingest/errors';

export const ingestErrorsEn: Record<IngestErrorCode, string> = {
  INGEST_URL_INVALID: 'The URL is not valid.',
  INGEST_URL_INVALID_SCHEME: 'Only http and https URLs are allowed.',
  INGEST_URL_CREDENTIALS: 'URLs with embedded credentials are not allowed.',
  INGEST_URL_SSRF_BLOCKED: 'This URL points to a blocked or private address.',
  INGEST_URL_REDIRECT_LIMIT: 'Too many redirects while fetching the URL.',
  INGEST_URL_TIMEOUT: 'The download timed out.',
  INGEST_URL_SIZE_EXCEEDED: 'The remote file exceeds the maximum allowed size.',
  INGEST_URL_DOWNLOAD_FAILED: 'Could not download the remote file.',
  INGEST_LOCAL_NOT_CONFIGURED: 'Local path import is not configured on this server.',
  INGEST_LOCAL_NOT_ABSOLUTE: 'Local path must be absolute.',
  INGEST_LOCAL_TRAVERSAL: 'The path is outside the allowed import directory.',
  INGEST_LOCAL_NOT_FOUND: 'The file does not exist.',
  INGEST_LOCAL_NOT_FILE: 'The path must refer to a regular file.',
  INGEST_LOCAL_NOT_DIR: 'The path must refer to a directory.',
  INGEST_LOCAL_EXTENSION: 'This file type is not allowed.',
  INGEST_LOCAL_SIZE_EXCEEDED: 'The file exceeds the maximum allowed size.',
  INGEST_UPLOAD_NO_FILE: 'No file was uploaded.',
  INGEST_UPLOAD_EXTENSION: 'This file type is not allowed.',
  INGEST_UPLOAD_SIZE_EXCEEDED: 'The upload exceeds the maximum allowed size.',
  INGEST_PROBE_FAILED: 'Could not read video metadata from the file.',
  INGEST_PROBE_ZERO_DURATION: 'The file has no playable video duration.',
  INGEST_INVALID_MODE: 'Invalid import mode.',
  INGEST_INVALID_CHUNKING:
    'Invalid chunk preset or window/overlap values. Use standard, 60s, 30s, 20s, fine — or valid window_ms + overlap_ms.',
  INGEST_BATCH_EMPTY: 'No video files found for this batch.',
  INGEST_BATCH_TOO_LARGE: 'Too many files in one batch. Split into smaller batches.',
  INGEST_INTERNAL: 'An unexpected error occurred during import.',
};

export type Locale = 'zh' | 'en';
