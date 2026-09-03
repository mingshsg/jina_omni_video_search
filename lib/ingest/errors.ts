/** Stable ingest error codes — safe for API responses; never embed secrets or paths. */
export const INGEST_ERROR_CODES = [
  'INGEST_URL_INVALID',
  'INGEST_URL_INVALID_SCHEME',
  'INGEST_URL_CREDENTIALS',
  'INGEST_URL_SSRF_BLOCKED',
  'INGEST_URL_REDIRECT_LIMIT',
  'INGEST_URL_TIMEOUT',
  'INGEST_URL_SIZE_EXCEEDED',
  'INGEST_URL_DOWNLOAD_FAILED',
  'INGEST_LOCAL_NOT_CONFIGURED',
  'INGEST_LOCAL_NOT_ABSOLUTE',
  'INGEST_LOCAL_TRAVERSAL',
  'INGEST_LOCAL_NOT_FOUND',
  'INGEST_LOCAL_NOT_FILE',
  'INGEST_LOCAL_NOT_DIR',
  'INGEST_LOCAL_EXTENSION',
  'INGEST_LOCAL_SIZE_EXCEEDED',
  'INGEST_UPLOAD_NO_FILE',
  'INGEST_UPLOAD_EXTENSION',
  'INGEST_UPLOAD_SIZE_EXCEEDED',
  'INGEST_PROBE_FAILED',
  'INGEST_PROBE_ZERO_DURATION',
  'INGEST_INVALID_MODE',
  'INGEST_INVALID_CHUNKING',
  'INGEST_BATCH_EMPTY',
  'INGEST_BATCH_TOO_LARGE',
  'INGEST_INTERNAL',
] as const;

export type IngestErrorCode = (typeof INGEST_ERROR_CODES)[number];

export class IngestError extends Error {
  readonly code: IngestErrorCode;

  constructor(code: IngestErrorCode) {
    super(code);
    this.name = 'IngestError';
    this.code = code;
  }
}

export function isIngestError(err: unknown): err is IngestError {
  return err instanceof IngestError;
}

/** Map unknown failures to a safe client-facing error. */
export function toIngestError(err: unknown): IngestError {
  if (isIngestError(err)) return err;
  return new IngestError('INGEST_INTERNAL');
}
