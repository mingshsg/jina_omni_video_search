/**
 * Pure state rules for the metadata editor's initial load (todo/43 F2).
 *
 * The editor fires two independent requests — the asset metadata DTO and the
 * shared catalogs — and previously treated them as one `Promise.all` unit:
 * a catalog failure threw before a valid DTO was applied, and a rejected
 * fetch or unparseable body left the failure flag unset. Because the render
 * condition was `loading || !catalogs`, the operator then sat on a permanent
 * loading message with no form and no retry.
 *
 * The rule is: the two requests are independent. A metadata failure is an
 * explicit error with retry; a catalog failure keeps the metadata form usable
 * and only flags the actor/group catalog (the intent of todo/40 R4). This
 * module is React-free so it is covered by the `lib/**` Vitest include and the
 * component only has to map the outcome onto state.
 */

/** One request as observed by the component: success flag, body and error. */
export interface FetchedJson<T> {
  /** The response was 2xx. */
  ok: boolean;
  /** Parsed JSON body, or `null` when the request failed or the body was not JSON. */
  body: T | null;
  /** The fetch itself rejected or the body could not be parsed as JSON. */
  transportFailed: boolean;
  /** Server-provided `error.message` when the body carried one. */
  errorMessage?: string;
}

export type MetaLoadOutcome<Meta, Catalogs> =
  /** Both requests usable — render the full form. */
  | { status: 'ok'; dto: Meta; catalogs: Catalogs }
  /** Metadata unusable — explicit error state with retry; no form. */
  | { status: 'meta_error'; message: string }
  /**
   * Metadata usable, catalogs not — render the form from the DTO and degrade
   * the actor/group selectors to free text with a warning.
   */
  | { status: 'catalogs_warning'; dto: Meta; message: string };

/** True when a parsed response can actually be used by the editor. */
export function isApiBodyUsable<T>(
  result: FetchedJson<T> | null | undefined,
): result is FetchedJson<T> & { body: T } {
  return Boolean(result && result.ok && result.body != null);
}

/**
 * Decide the editor's load state from the two independent request results.
 * `fallbackMessage` is the localized generic error used when the server did
 * not supply one (e.g. a network rejection or a non-JSON body).
 */
export function classifyMetaLoad<Meta, Catalogs>(
  meta: FetchedJson<Meta> | null | undefined,
  catalogs: FetchedJson<Catalogs> | null | undefined,
  fallbackMessage: string,
): MetaLoadOutcome<Meta, Catalogs> {
  if (!isApiBodyUsable(meta)) {
    return {
      status: 'meta_error',
      message: meta?.errorMessage || fallbackMessage,
    };
  }
  if (!isApiBodyUsable(catalogs)) {
    return {
      status: 'catalogs_warning',
      dto: meta.body,
      message: catalogs?.errorMessage || fallbackMessage,
    };
  }
  return { status: 'ok', dto: meta.body, catalogs: catalogs.body };
}

/** Which body the editor renders. */
export type MetaEditorView = 'loading' | 'form' | 'error';

/**
 * The editor's body view. Only a request that is still running shows the
 * loading text; once loading has finished a weak or missing DTO is an
 * explicit error view with retry, never an endless spinner (todo/43 F2).
 */
export function metaEditorView(params: {
  loading: boolean;
  hasDto: boolean;
}): MetaEditorView {
  if (params.loading) return 'loading';
  return params.hasDto ? 'form' : 'error';
}
