import { NextResponse } from 'next/server';

/**
 * Stable live API error catalog (docs/live-video-api-contract.md).
 * Messages never echo secrets, private IPs, or absolute spool paths.
 */

export type LiveErrorCode =
  | 'LIVE_INVALID_REQUEST'
  | 'LIVE_SOURCE_NOT_FOUND'
  | 'LIVE_SOURCE_DISABLED'
  | 'LIVE_SOURCE_PENDING_VALIDATION'
  | 'LIVE_SOURCE_INVALID'
  | 'LIVE_SOURCE_FORBIDDEN'
  | 'LIVE_CREDENTIAL_NOT_FOUND'
  | 'LIVE_SESSION_CONFLICT'
  | 'LIVE_SESSION_REPLACEMENT_PENDING'
  | 'LIVE_SESSION_NOT_FOUND'
  | 'LIVE_WORKER_UNAVAILABLE'
  | 'LIVE_SOURCE_CHANGED'
  | 'LIVE_CONNECT_TIMEOUT'
  | 'LIVE_MEDIA_INVALID'
  | 'LIVE_QUEUE_SATURATED'
  | 'LIVE_WINDOW_DROPPED'
  | 'LIVE_EMBED_FAILED'
  | 'LIVE_INDEX_FAILED'
  | 'LIVE_MEDIA_EXPIRED'
  | 'LIVE_EVENT_CURSOR_INVALID'
  | 'LIVE_EVENT_CURSOR_EXPIRED'
  | 'LIVE_QUERY_EXPIRED'
  | 'LIVE_RATE_LIMITED'
  | 'LIVE_PAYLOAD_TOO_LARGE';

export type LiveLocale = 'zh' | 'en';

const MESSAGES: Record<LiveErrorCode, { en: string; zh: string }> = {
  LIVE_INVALID_REQUEST: {
    en: 'Request validation failed',
    zh: '请求参数无效',
  },
  LIVE_SOURCE_NOT_FOUND: {
    en: 'Live source not found',
    zh: '直播源不存在',
  },
  LIVE_SOURCE_DISABLED: {
    en: 'Live source is disabled',
    zh: '直播源已禁用',
  },
  LIVE_SOURCE_PENDING_VALIDATION: {
    en: 'Live source is pending worker validation',
    zh: '直播源尚未通过 worker 校验',
  },
  LIVE_SOURCE_INVALID: {
    en: 'Live source connection was rejected',
    zh: '直播源连接材料被拒绝',
  },
  LIVE_SOURCE_FORBIDDEN: {
    en: 'Source destination is not allowed',
    zh: '源地址不在允许范围内',
  },
  LIVE_CREDENTIAL_NOT_FOUND: {
    en: 'Credential reference cannot be resolved',
    zh: '凭据引用无法解析',
  },
  LIVE_SESSION_CONFLICT: {
    en: 'Conflicting live session state',
    zh: '会话状态冲突',
  },
  LIVE_SESSION_REPLACEMENT_PENDING: {
    en: 'Prior session must finish draining',
    zh: '上一会话仍在排空，请稍后重试',
  },
  LIVE_SESSION_NOT_FOUND: {
    en: 'Live session not found',
    zh: '直播会话不存在',
  },
  LIVE_WORKER_UNAVAILABLE: {
    en: 'Live worker is unavailable',
    zh: '直播 worker 不可用',
  },
  LIVE_SOURCE_CHANGED: {
    en: 'Resolved endpoint no longer matches the session snapshot',
    zh: '源端点已变更，与会话快照不一致',
  },
  LIVE_CONNECT_TIMEOUT: {
    en: 'Connection attempt timed out',
    zh: '连接超时',
  },
  LIVE_MEDIA_INVALID: {
    en: 'Media validation failed',
    zh: '媒体校验失败',
  },
  LIVE_QUEUE_SATURATED: {
    en: 'Live work queue cannot accept more windows',
    zh: '直播处理队列已饱和',
  },
  LIVE_WINDOW_DROPPED: {
    en: 'Window was dropped under backpressure policy',
    zh: '窗口因背压策略被丢弃',
  },
  LIVE_EMBED_FAILED: {
    en: 'Embedding provider failed after retries',
    zh: '嵌入服务在重试后仍失败',
  },
  LIVE_INDEX_FAILED: {
    en: 'Window could not be acknowledged by Elasticsearch',
    zh: 'Elasticsearch 未能确认该窗口',
  },
  LIVE_MEDIA_EXPIRED: {
    en: 'Retained media is no longer available',
    zh: '保留媒体已不可用',
  },
  LIVE_EVENT_CURSOR_INVALID: {
    en: 'Session event cursor is malformed or ahead of published revision',
    zh: '事件游标无效或超前',
  },
  LIVE_EVENT_CURSOR_EXPIRED: {
    en: 'Session event cursor is no longer retained',
    zh: '事件游标已过期',
  },
  LIVE_QUERY_EXPIRED: {
    en: 'Follow-search handle is unavailable',
    zh: '跟随搜索句柄不可用',
  },
  LIVE_RATE_LIMITED: {
    en: 'Too many live mutation requests',
    zh: '直播变更请求过于频繁',
  },
  LIVE_PAYLOAD_TOO_LARGE: {
    en: 'Request body exceeds the configured limit',
    zh: '请求体超过大小限制',
  },
};

export const LIVE_ERROR_HTTP_STATUS: Record<LiveErrorCode, number> = {
  LIVE_INVALID_REQUEST: 400,
  LIVE_SOURCE_NOT_FOUND: 404,
  LIVE_SOURCE_DISABLED: 409,
  LIVE_SOURCE_PENDING_VALIDATION: 409,
  LIVE_SOURCE_INVALID: 422,
  LIVE_SOURCE_FORBIDDEN: 403,
  LIVE_CREDENTIAL_NOT_FOUND: 422,
  LIVE_SESSION_CONFLICT: 409,
  LIVE_SESSION_REPLACEMENT_PENDING: 409,
  LIVE_SESSION_NOT_FOUND: 404,
  LIVE_WORKER_UNAVAILABLE: 503,
  LIVE_SOURCE_CHANGED: 409,
  LIVE_CONNECT_TIMEOUT: 504,
  LIVE_MEDIA_INVALID: 422,
  LIVE_QUEUE_SATURATED: 503,
  LIVE_WINDOW_DROPPED: 200,
  LIVE_EMBED_FAILED: 502,
  LIVE_INDEX_FAILED: 502,
  LIVE_MEDIA_EXPIRED: 410,
  LIVE_EVENT_CURSOR_INVALID: 400,
  LIVE_EVENT_CURSOR_EXPIRED: 410,
  LIVE_QUERY_EXPIRED: 410,
  LIVE_RATE_LIMITED: 429,
  LIVE_PAYLOAD_TOO_LARGE: 413,
};

export function liveErrorMessage(
  code: LiveErrorCode,
  locale: LiveLocale = 'en',
): string {
  return MESSAGES[code][locale] ?? MESSAGES[code].en;
}

export class LiveApiError extends Error {
  readonly code: LiveErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(
    code: LiveErrorCode,
    options?: { message?: string; status?: number; details?: Record<string, unknown> },
  ) {
    super(options?.message ?? liveErrorMessage(code, 'en'));
    this.name = 'LiveApiError';
    this.code = code;
    this.status = options?.status ?? LIVE_ERROR_HTTP_STATUS[code];
    this.details = options?.details;
  }
}

export function resolveLiveLocale(request: Request): LiveLocale {
  const header = request.headers.get('accept-language') ?? '';
  if (/\bzh\b/i.test(header)) return 'zh';
  const url = new URL(request.url);
  const q = url.searchParams.get('locale');
  if (q === 'zh' || q === 'en') return q;
  return 'en';
}

export function liveErrorResponse(
  err: LiveApiError | LiveErrorCode,
  locale: LiveLocale = 'en',
  extra?: Record<string, unknown>,
): NextResponse {
  const code = typeof err === 'string' ? err : err.code;
  const status =
    typeof err === 'string'
      ? LIVE_ERROR_HTTP_STATUS[err]
      : err.status;
  const message =
    typeof err === 'string'
      ? liveErrorMessage(err, locale)
      : liveErrorMessage(err.code, locale);
  return NextResponse.json(
    {
      error: {
        code,
        message,
        ...(extra ?? {}),
      },
    },
    { status },
  );
}
