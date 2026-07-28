import type { ArkErrors, Type } from 'arktype';

// Spec: frontend/specs/core/error-model.md

/**
 * Typed HTTP error carrying a literal status code and validated body data.
 *
 * The `_type` discriminant is `'HttpError'` so type guards can narrow
 * `ApiError<E>` unions without ambiguity.
 *
 * @typeParam Status - HTTP status code as a number literal (e.g. `404`).
 * @typeParam Data   - The response body type, either raw (`unknown`) or
 *                     the validated output of an arktype schema.
 */
export interface HttpError<Status extends number, Data> {
  readonly _type: 'HttpError';
  readonly status: Status;
  readonly data: Data;
}

/**
 * Base error variants that the infrastructure layer produces independently
 * of any specific endpoint.  Contains exactly 4 variants:
 *
 * - `NetworkError`      -- DNS, connection refused, timeout, abort.
 * - `ValidationError`   -- arktype schema failure or JSON parse failure.
 * - `UnhandledStatusError` -- HTTP response with a status code that has no
 *                              matching schema and no fallback.
 * - `UnexpectedError`   -- any other throwable that isn't one of the above.
 */
export type ApiErrorBase =
  | { readonly _type: 'NetworkError'; readonly error: Error }
  | {
      readonly _type: 'ValidationError';
      readonly status: number | null;
      readonly summary: string;
      readonly issues: ArkErrors | null;
    }
  | { readonly _type: 'UnhandledStatusError'; readonly status: number; readonly data: unknown }
  | { readonly _type: 'UnexpectedError'; readonly error: unknown };

/**
 * Discriminated union of `ApiErrorBase` and endpoint-specific `HttpError`
 * variants injected via the generic parameter `E`.
 *
 * @typeParam E - Union of `HttpError<Status, Data>` for expected error
 *                status codes.  Defaults to `HttpError<number, unknown>`
 *                (no validation applied to the error body).
 *
 * @example
 * // Errors for a tasks endpoint:
 * type TaskErrors = ApiError<HttpError<422, A> | HttpError<409, B>>;
 */
export type ApiError<E = HttpError<number, unknown>> = ApiErrorBase | E;

/**
 * Converts a TS object key (string) back to its numeric literal type.
 * Required because TS represents numeric object keys as strings.
 *
 * @example
 * ParseInt<'404'>  // 404
 * ParseInt<404>    // 404
 * ParseInt<'foo'>  // never
 */
export type ParseInt<T> = T extends number
  ? T
  : T extends `${infer N extends number}`
    ? N
    : never;

/**
 * Derives the endpoint-specific `HttpError` union from a status-code-to-schema
 * map and an optional fallback schema.
 *
 * @typeParam F  - Map of status codes to arktype schemas, e.g.
 *                 `{ 422: SchemaA, 409: SchemaB }`.
 * @typeParam FB - Optional fallback schema for any unlisted status code.
 *
 * @example
 * // With only explicit failures:
 * InferHttpErrors<{ 422: SchemaA }>
 * // => HttpError<422, SchemaA['infer']>
 *
 * // With fallback:
 * InferHttpErrors<{ 422: SchemaA }, Fallback>
 * // => HttpError<422, SchemaA['infer']> | HttpError<number, Fallback['infer']>
 */
export type InferHttpErrors<
  F extends Record<number, Type>,
  FB extends Type | undefined = undefined,
> =
  | {
      [K in keyof F]: F[K] extends Type
        ? ParseInt<K> extends never
          ? never
          : HttpError<ParseInt<K>, F[K]['infer']>
        : never;
    }[keyof F]
  | (FB extends Type ? HttpError<number, FB['infer']> : never);

/**
 * Creates a typed `HttpError` with the given status code and data.
 *
 * @param status - HTTP status code (literal).
 * @param data   - Response body.  `undefined` when the body is empty or
 *                 could not be parsed.
 *
 * @example
 * createHttpError(401, { detail: 'unauthorized' })
 * // => { _type: 'HttpError', status: 401, data: { detail: 'unauthorized' } }
 */
export function createHttpError<S extends number, D>(status: S, data: D): HttpError<S, D> {
  return { _type: 'HttpError', status, data };
}

/**
 * Returns `true` when `error._type === 'HttpError'`.
 * Narrows `error` to any `HttpError` variant (including endpoint-specific
 * ones injected via `ApiError<E>`).
 */
export function isHttpError<E extends HttpError<number, unknown>>(
  error: ApiError<E>,
): error is Extract<ApiError<E>, { _type: 'HttpError' }> {
  return error._type === 'HttpError';
}

/**
 * Returns `true` when `error._type === 'NetworkError'`.
 * Covers DNS failures, connection refusals, timeouts, and aborts.
 */
export function isNetworkError<E extends HttpError<number, unknown>>(
  error: ApiError<E>,
): error is Extract<ApiError<E>, { _type: 'NetworkError' }> {
  return error._type === 'NetworkError';
}

/**
 * Returns `true` when `error._type === 'ValidationError'`.
 * Covers arktype schema failures and JSON parse failures.
 */
export function isValidationError<E extends HttpError<number, unknown>>(
  error: ApiError<E>,
): error is Extract<ApiError<E>, { _type: 'ValidationError' }> {
  return error._type === 'ValidationError';
}

/**
 * Returns `true` when `error._type === 'UnhandledStatusError'`.
 * Produced when an HTTP response has a status code that was not declared
 * in the `failures` map and no `fallback` was provided.
 */
export function isUnhandledStatusError<E extends HttpError<number, unknown>>(
  error: ApiError<E>,
): error is Extract<ApiError<E>, { _type: 'UnhandledStatusError' }> {
  return error._type === 'UnhandledStatusError';
}

/**
 * Returns `true` when `error._type === 'UnexpectedError'`.
 * Catch-all for any throwable that is not an HTTP, network, or validation error.
 */
export function isUnexpectedError<E extends HttpError<number, unknown>>(
  error: ApiError<E>,
): error is Extract<ApiError<E>, { _type: 'UnexpectedError' }> {
  return error._type === 'UnexpectedError';
}
