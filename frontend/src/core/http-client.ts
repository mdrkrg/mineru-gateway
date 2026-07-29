import ky_default, { HTTPError, NetworkError, TimeoutError, isHTTPError, isNetworkError, isTimeoutError } from 'ky';
import type { Options, BeforeRequestHook, AfterResponseHook } from 'ky';
import { ResultAsync, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { createHttpError } from '@/core/error-model';
import type { ApiError, HttpError } from '@/core/error-model';
import { env } from '@/env';

// Spec: frontend/specs/core/http-client.md

/**
 * Wraps a ky/KyResponse body to allow callers to choose how to read it
 * (JSON, text, blob, or ArrayBuffer).
 *
 * Each method should be called at most once per response (the underlying
 * stream can only be consumed once).
 */
export interface BodyReader {
  json(): Promise<unknown>;
  text(): Promise<string>;
  blob(): Promise<Blob>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/**
 * Raw successful HTTP response returned by `request()`.
 *
 * The body is NOT read by `request()`.  Callers use the `reader` to choose
 * a parser (`parseJson`, `parseBlob`, `parseArrayBuffer`, or `passthrough`).
 */
export interface RawResponse {
  readonly status: number;
  readonly headers: Headers;
  readonly reader: BodyReader;
}

/**
 * Binary response result produced by `parseBlob()`.  Includes the blob data,
 * HTTP status code, and response headers (needed for `Content-Disposition`
 * when downloading files).
 */
export interface BlobResult {
  readonly blob: Blob;
  readonly status: number;
  readonly headers: Headers;
}

let _api: typeof ky_default | null = null;

/** Registered by {@link registerAuthHooks}, read by {@link _createApi}. */
let _beforeRequestHook: ((state: { request: Request }) => Request | void) | null =
  null;
let _afterResponseHook: ReturnType<typeof createAuthAfterResponse> | null = null;
/** Self-reference: set by {@link _createApi}, used by the 401 retry function. */
let _kyRetry: ((req: Request) => unknown) | null = null;

function _createApi(base: string): typeof ky_default {
  const beforeRequest: BeforeRequestHook[] = [];
  const afterResponse: AfterResponseHook[] = [];

  if (_beforeRequestHook) {
    beforeRequest.push(_beforeRequestHook as BeforeRequestHook);
  }
  if (_afterResponseHook) {
    afterResponse.push(async (state) => {
      const result = await _afterResponseHook!({
        request: state.request,
        response: { status: state.response.status },
        retryCount: state.retryCount,
      });
      return (result as Response | undefined);
    });
  }

  const api = ky_default.extend({
    prefix: base,
    hooks: { beforeRequest, afterResponse },
  });

  _kyRetry = (req: Request) => api(req);

  return api;
}

function getApi(): typeof ky_default {
  if (!_api) {
    _api = _createApi(env.apiPrefix);
  }
  return _api;
}

/**
 * Registers per-request auth hooks on the ky singleton:
 *
 * - **beforeRequest** - injects `Authorization: Bearer <token>` via
 *   {@link createAuthBeforeRequest}.
 * - **afterResponse** - on 401, calls `refresh()` then retries the original
 *   request with the new token (via {@link createAuthAfterResponse}).
 *
 * Must be called once during app bootstrap, **before any request is sent**.
 *
 * @param getToken - Synchronous accessor for the current access token.
 * @param refresh  - Async function that refreshes the token and returns the
 *                   new access token (or `null` on failure).
 */
export function registerAuthHooks(
  getToken: () => string | null,
  refresh: () => Promise<string | null>,
  onApiKeyRejected?: () => void,
): void {
  _beforeRequestHook = createAuthBeforeRequest(getToken);
  _afterResponseHook = createAuthAfterResponse(refresh, (req: Request) => {
    if (!_kyRetry) throw new Error('ky instance not initialized');
    return _kyRetry(req);
  }, onApiKeyRejected);
  _api = _createApi(env.apiPrefix);
}

/**
 * Resets the lazy-singleton ky instance to point at an absolute base URL.
 * Used by e2e tests to redirect all requests to a running gateway instance.
 * Must be called before any request is made (the singleton caches the
 * first instance).
 *
 * @param baseUrl - Absolute URL prefix for all requests, e.g.
 *                  `http://127.0.0.1:8000`.
 *
 * @example
 * // In an e2e test globalSetup or beforeAll:
 * import { setApiBaseUrl } from '@/http-client';
 * setApiBaseUrl('http://127.0.0.1:8765');
 */
export function setApiBaseUrl(baseUrl: string): void {
  _api = _createApi(baseUrl);
}

/**
 * Sends an HTTP request and returns a `ResultAsync` wrapping a `RawResponse`.
 *
 * The body is not parsed -- use `andThen(parseJson)`, `andThen(parseBlob)`,
 * etc. to read it.
 *
 * Error classification (all errors become `ApiError` variants):
 *
 * - `HTTPError` (ky)   -> `HttpError<status, data>`
 * - `NetworkError` (ky) -> `NetworkError`  (uses `error.cause` or a fallback)
 * - `TimeoutError` (ky) -> `NetworkError`
 * - `DOMException` with `name === 'AbortError'` -> `NetworkError`
 * - anything else       -> `UnexpectedError`
 *
 * @param url     - Relative URL path. Base is provided by the ky instance's
 *                  `prefix` (see `getApi()`).
 * @param options - ky request options.  `throwHttpErrors: true` is enforced
 *                  internally -- the caller cannot disable it.
 *
 * @returns `ResultAsync<RawResponse, ApiError<HttpError<number, unknown>>>`
 *
 * @example
 * import { request, parseJson } from '@/http-client';
 *
 * const result = await request('auth/jwt/login', {
 *     method: 'POST',
 *     json: { username, password },
 * }).andThen(parseJson);
 *
 * if (result.isOk()) {
 *     console.log(result.value); // raw JSON, unknown type
 * }
 */
export function request(
  url: string,
  options?: Options,
): ResultAsync<RawResponse, ApiError<HttpError<number, unknown>>> {
  return ResultAsync.fromPromise(
    getApi()(url, { ...options, throwHttpErrors: true }),
    (error: unknown) => {
      if (isHTTPError(error)) {
        const httpErr = error as HTTPError;
        return createHttpError(httpErr.response.status, httpErr.data) as ApiError<HttpError<number, unknown>>;
      }
      if (isNetworkError(error)) {
        const netErr = error as NetworkError;
        return {
          _type: 'NetworkError',
          error: netErr.cause ?? new Error('Network error'),
        } as ApiError<HttpError<number, unknown>>;
      }
      if (isTimeoutError(error)) {
        return {
          _type: 'NetworkError',
          error: error as unknown as Error,
        } as ApiError<HttpError<number, unknown>>;
      }
      if (error instanceof DOMException && error.name === 'AbortError') {
        return {
          _type: 'NetworkError',
          error: error,
        } as ApiError<HttpError<number, unknown>>;
      }
      return {
        _type: 'UnexpectedError',
        error,
      } as ApiError<HttpError<number, unknown>>;
    },
  ).map((resp) => {
    const raw: RawResponse = {
      status: resp.status,
      headers: resp.headers,
      reader: {
        json: () => resp.json(),
        text: () => resp.text(),
        blob: () => resp.blob(),
        arrayBuffer: () => resp.arrayBuffer(),
      },
    };
    return raw;
  });
}

/**
 * Reads the response body as JSON.  Returns `Ok(parsed)` on success or
 * `Err(ValidationError)` if the body is not valid JSON.
 *
 * **Does not convert snake_case keys.**  Key conversion is done by schema
 * morphs in `validateSuccess` / `validateFailure`.
 *
 * @returns `ResultAsync<unknown, ApiError<never>>`
 */
export function parseJson(
  response: RawResponse,
): ResultAsync<unknown, ApiError<never>> {
  return ResultAsync.fromPromise(
    response.reader.json(),
    () => {
      return {
        _type: 'ValidationError',
        status: null,
        summary: 'Response body is not valid JSON',
        issues: null,
      } as ApiError<never>;
    },
  );
}

/**
 * Reads the response body as a Blob.  Returns `Ok(BlobResult)` containing
 * the blob, the HTTP status code, and the response headers.
 *
 * The `headers` field is the original `RawResponse.headers` -- callers use
 * it to read `Content-Disposition` for file downloads.
 *
 * @returns `ResultAsync<BlobResult, ApiError<never>>`
 */
export function parseBlob(
  response: RawResponse,
): ResultAsync<BlobResult, ApiError<never>> {
  return ResultAsync.fromPromise(
    response.reader.blob().then((blob) => ({
      blob,
      status: response.status,
      headers: response.headers,
    })),
    (error) => {
      return {
        _type: 'UnexpectedError',
        error,
      } as ApiError<never>;
    },
  );
}

/**
 * Reads the response body as an `ArrayBuffer`.  Used for in-memory byte
 * handling (e.g. ZIP parsing).
 *
 * @returns `ResultAsync<ArrayBuffer, ApiError<never>>`
 */
export function parseArrayBuffer(
  response: RawResponse,
): ResultAsync<ArrayBuffer, ApiError<never>> {
  return ResultAsync.fromPromise(
    response.reader.arrayBuffer(),
    (error) => {
      return {
        _type: 'UnexpectedError',
        error,
      } as ApiError<never>;
    },
  );
}

/**
 * Passes the `RawResponse` through without reading the body.
 * Used for endpoints where the response shape is defined by the upstream
 * and the frontend does not validate it (e.g. `/file_parse`).
 *
 * @returns `Result<RawResponse, ApiError<never>>`
 */
export function passthrough(
  response: RawResponse,
): Result<RawResponse, ApiError<never>> {
  return ok(response) as Result<RawResponse, ApiError<never>>;
}

export function createAuthBeforeRequest(
  getToken: () => string | null,
): (state: { request: Request }) => Request | void {
  return (state) => {
    const token = getToken();
    if (!token) return;
    const headers = new Headers(state.request.headers);
    headers.set('Authorization', `Bearer ${token}`);
    return new Request(state.request, { headers });
  };
}

export function createAuthAfterResponse(
  refresh: () => Promise<string | null>,
  retryFn: (request: Request) => unknown,
  onApiKeyRejected?: () => void,
): (
  state: {
    request: Request;
    response: { status: number };
    retryCount: number;
  },
) => Promise<unknown> {
  let refreshPromise: Promise<string | null> | null = null;

  return async (state) => {
    if (state.response.status !== 401) return;

    if (state.request.headers.get('X-Api-Key')) {
      onApiKeyRejected?.();
      return;
    }

    if (state.request.url.includes('/auth/jwt/refresh')) return;
    if (state.retryCount > 0) return;

    if (!refreshPromise) {
      refreshPromise = refresh();
    }
    let newToken: string | null = null;
    try {
      newToken = await refreshPromise;
    } catch {
      // refresh rejected - pass through 401
    } finally {
      refreshPromise = null;
    }

    if (!newToken) return;

    const headers = new Headers(state.request.headers);
    headers.set('Authorization', `Bearer ${newToken}`);
    return retryFn(new Request(state.request, { headers }));
  };
}
