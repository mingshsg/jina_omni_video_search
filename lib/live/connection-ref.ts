import { createHash } from 'node:crypto';
import type { LiveProtocol, LiveTransport } from './types';

/** Worker-only structured connection secret (never returned to the web/API). */
export interface LiveConnectionSecret {
  url: string;
  username?: string;
  password?: string;
  passphrase?: string;
}

const CONNECTION_REF_RE = /^LIVE_SOURCE_[A-Z0-9_]+_(URL|CONNECTION)$/;

export function isValidConnectionRefName(name: string): boolean {
  return CONNECTION_REF_RE.test(name);
}

export class LiveConnectionRefError extends Error {
  constructor(
    message: string,
    public readonly code: string = 'LIVE_CONNECTION_REF_INVALID',
  ) {
    super(message);
    this.name = 'LiveConnectionRefError';
  }
}

/**
 * Resolve a connection_ref from the worker environment only.
 * Values must be JSON objects — never raw URL-with-userinfo strings.
 */
export function resolveConnectionSecret(
  connectionRef: string,
  env: NodeJS.ProcessEnv = process.env,
): LiveConnectionSecret {
  if (!isValidConnectionRefName(connectionRef)) {
    throw new LiveConnectionRefError(
      `connection_ref must match ${CONNECTION_REF_RE}`,
    );
  }
  const raw = env[connectionRef];
  if (raw === undefined || raw.trim() === '') {
    throw new LiveConnectionRefError(
      `Missing worker secret for ${connectionRef}`,
      'LIVE_CONNECTION_SECRET_MISSING',
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new LiveConnectionRefError(
      `${connectionRef} must be a JSON object (got non-JSON)`,
      'LIVE_CONNECTION_SECRET_INVALID',
    );
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new LiveConnectionRefError(
      `${connectionRef} must be a JSON object`,
      'LIVE_CONNECTION_SECRET_INVALID',
    );
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.url !== 'string' || !obj.url.trim()) {
    throw new LiveConnectionRefError(
      `${connectionRef}.url must be a non-empty string`,
      'LIVE_CONNECTION_SECRET_INVALID',
    );
  }
  const secret: LiveConnectionSecret = { url: obj.url.trim() };
  if (obj.username !== undefined) {
    if (typeof obj.username !== 'string') {
      throw new LiveConnectionRefError(`${connectionRef}.username must be a string`);
    }
    secret.username = obj.username;
  }
  if (obj.password !== undefined) {
    if (typeof obj.password !== 'string') {
      throw new LiveConnectionRefError(`${connectionRef}.password must be a string`);
    }
    secret.password = obj.password;
  }
  if (obj.passphrase !== undefined) {
    if (typeof obj.passphrase !== 'string') {
      throw new LiveConnectionRefError(`${connectionRef}.passphrase must be a string`);
    }
    secret.passphrase = obj.passphrase;
  }

  // Reject accidental raw secrets in the URL field.
  if (/^[a-z][a-z0-9+.-]*:\/\/[^/]*@/i.test(secret.url)) {
    throw new LiveConnectionRefError(
      `${connectionRef}.url must not contain userinfo`,
      'LIVE_SOURCE_USERINFO_FORBIDDEN',
    );
  }

  return secret;
}

export interface RedactedEndpointProvenance {
  endpoint_redacted: string;
  endpoint_fingerprint: string;
  allowed_host: string;
  allowed_port: number;
}

export function fingerprintEndpoint(parts: {
  protocol: LiveProtocol;
  transport?: LiveTransport;
  endpointRedacted: string;
  allowedHost: string;
  allowedPort: number;
  connectionRef: string;
}): string {
  return createHash('sha256')
    .update(
      [
        parts.protocol,
        parts.transport ?? '',
        parts.endpointRedacted,
        parts.allowedHost,
        String(parts.allowedPort),
        parts.connectionRef,
      ].join('\0'),
    )
    .digest('hex');
}

/** Redact argv or log lines that may contain credentials. */
export function redactSecretsInText(
  text: string,
  secrets: Array<string | undefined>,
): string {
  let out = text;
  for (const secret of secrets) {
    if (!secret || secret.length < 1) continue;
    if (secret.length >= 3) {
      out = out.split(secret).join('***');
    }
  }
  // Strip URL userinfo if somehow present.
  out = out.replace(
    /([a-z][a-z0-9+.-]*:\/\/)([^/@\s]+)@/gi,
    '$1***@',
  );
  return out;
}
