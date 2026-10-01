import { z } from 'zod';
import type { DramaJobState } from '../ingest/drama-options';

const overrideSchema = z.object({
  subtitle_source: z.enum(['auto', 'existing_only', 'force_asr']).optional(),
  source_language: z.enum(['en', 'zh']).optional(),
}).strict().refine(
  (value) => value.subtitle_source !== undefined || value.source_language !== undefined,
);

export class DramaRetryPolicyError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) {
    super(message);
  }
}

/** A retry keeps its policy unless the caller explicitly supplies an override. */
export function resolveDramaRetryPolicy(
  drama: DramaJobState,
  raw: unknown,
): Pick<DramaJobState, 'subtitleSource' | 'sourceLanguage'> {
  const parsed = overrideSchema.safeParse(raw);
  if (!parsed.success || !drama.modules.includes('subtitles')) {
    throw new DramaRetryPolicyError(
      'DRAMA_RETRY_POLICY_INVALID',
      400,
      'Invalid subtitle retry options',
    );
  }
  const subtitleSource = parsed.data.subtitle_source ?? drama.subtitleSource;
  const sourceLanguage = parsed.data.source_language ?? drama.sourceLanguage;
  if (
    drama.languages.includes('en') &&
    drama.languages.includes('zh') &&
    subtitleSource !== 'existing_only' &&
    !sourceLanguage
  ) {
    throw new DramaRetryPolicyError(
      'DRAMA_SPOKEN_LANGUAGE_REQUIRED',
      400,
      'Choose the spoken language (English or Chinese) before retrying with ASR',
    );
  }
  if (sourceLanguage && !drama.languages.includes(sourceLanguage)) {
    throw new DramaRetryPolicyError(
      'DRAMA_RETRY_POLICY_INVALID',
      400,
      'The spoken language must be one of the requested subtitle languages',
    );
  }
  return { subtitleSource, sourceLanguage };
}
