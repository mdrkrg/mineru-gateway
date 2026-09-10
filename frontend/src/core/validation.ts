import { ArkErrors } from 'arktype';
import type { Type } from 'arktype';
import type { Options } from 'ky';
import { ok, err } from 'neverthrow';
import type { Result, ResultAsync } from 'neverthrow';
import {
  createHttpError,
  isHttpError,
} from '@/core/error-model';
import type {
  ApiError,
  HttpError,
  InferHttpErrors,
} from '@/core/error-model';
import { request, parseJson, parseBlob, parseArrayBuffer } from '@/core/http-client';
import type { BlobResult } from '@/core/http-client';

// Spec: frontend/specs/core/validation.md

/**
 * Bridge between arktype and neverthrow.  Validates `data` against `schema`
 * and returns `Ok(validated)` or `Err(ArkErrors)`.
 *
 * When the schema has a morph (e.g. `defineResponseSchema`'s
 * `camelCase(x, Infinity)`), `schema(data)` applies the morph, and
 * `Ok` contains the transformed value.
 *
 * @param schema - arktype schema (possibly morphing).
 * @param data   - value to validate.
 * @returns `Result<S['infer'], ArkErrors>`
 *
 * @example
 * const result = validate(TaskSchema, { task_id: 't1' });
 * if (result.isOk()) {
 *     console.log(result.value.taskId); // 't1' (camelCase after morph)
 * }
 */
export function validate<S extends Type>(
  schema: S,
  data: unknown,
): Result<S['infer'], ArkErrors> {
  const result = schema(data);
  if (result instanceof ArkErrors) {
    return err(result);
  }
  return ok(result as S['infer']);
}

/**
 * Composable validator for success response bodies.
 *
 * Returns a function suitable for `.andThen()`: it validates the parsed
 * JSON body against `schema` and converts arktype errors into the
 * `ValidationError` variant of `ApiError`.
 *
 * @param schema - arktype schema (typically created with
 *                 `defineResponseSchema` for automatic snake_case-to-camelCase
 *                 morph).
 * @returns A function `(data: unknown) => Result<S['infer'], ApiError<never>>`.
 *
 * @example
 * request('tasks', { method: 'POST' })
 *   .andThen(parseJson)
 *   .andThen(validateSuccess(TaskSchema))
 * // ResultAsync<{ taskId: string; status: string }, ...>
 */
export function validateSuccess<S extends Type>(
  schema: S,
): (data: unknown) => Result<S['infer'], ApiError<never>> {
  return (data: unknown) => {
    const result = validate(schema, data);
    if (result.isErr()) {
      return err({
        _type: 'ValidationError',
        status: null,
        summary: result.error.summary,
        issues: result.error,
      } as ApiError<never>);
    }
    return ok(result.value);
  };
}

/**
 * Composable validator for error response bodies.  Used with `.orElse()` to
 * validate HTTP error bodies against per-status-code schemas.
 *
 * Works by checking the error's `_type`:
 *
 * - Non-HttpError variants (`NetworkError`, `ValidationError`, etc.) pass
 *   through unchanged.
 * - HttpError variants:
 *   - Status matches a key in `failures` -> validate body with that schema.
 *   - No match, but `fallback` is provided  -> validate body with `fallback`.
 *   - No match, no fallback                 -> `UnhandledStatusError`.
 *
 * Schema validation failure inside an HttpError produces `ValidationError`
 * with `status` set to the HTTP status code.
 *
 * @param failures - Map of status code -> arktype schema,
 *                   e.g. `{ 422: SchemaA, 409: SchemaB }`.
 *                   Keys must be number literals (not strings).
 * @param fallback - Optional schema for any unlisted status code.
 *
 * @returns A function that takes `ApiError<HttpError<...>>` and returns
 *          `Result<never, ApiError<InferHttpErrors<F, FB>>>`.
 *
 * @example
 * request('tasks/result-zip', { method: 'POST', json: body })
 *   .andThen(parseBlob) // success: blob
 *   .orElse(validateFailure({ 409: NonDownloadableSchema }))
 * // error branch: 409 body validated as NonDownloadable
 */
export function validateFailure<
  F extends Record<number, Type>,
  FB extends Type | undefined = undefined,
>(
  failures: F,
  fallback?: FB,
): (
  error: ApiError<HttpError<number, unknown>>,
) => Result<never, ApiError<InferHttpErrors<F, FB>>> {
  return (error: ApiError<HttpError<number, unknown>>) => {
    if (!isHttpError(error)) {
      return err(error as unknown as ApiError<InferHttpErrors<F, FB>>);
    }

    const status = error.status;
    const schema = (failures as Record<number, Type>)[status] ?? fallback;

    if (!schema) {
      return err({
        _type: 'UnhandledStatusError',
        status,
        data: error.data,
      } as ApiError<InferHttpErrors<F, FB>>);
    }

    const result = validate(schema, error.data);
    if (result.isErr()) {
      return err({
        _type: 'ValidationError',
        status,
        summary: `Schema mismatch for HTTP ${status}: ${result.error.summary}`,
        issues: result.error,
      } as ApiError<InferHttpErrors<F, FB>>);
    }

    return err(
      createHttpError(status, result.value) as unknown as ApiError<InferHttpErrors<F, FB>>,
    );
  };
}

/**
 * Optional composable for validating request bodies before sending.
 *
 * Validates the given body against `schema` (typically created with
 * `defineRequestSchema` for automatic camelCase-to-snake_case morph).
 * On success the returned value is the wire format (snake_case keys)
 * suitable for `options.json`.
 *
 * On failure, returns `ValidationError` with `status: null` (no HTTP
 * request is sent).
 *
 * @param schema - arktype schema (typically from `defineRequestSchema`).
 * @returns A pure function -- does NOT make network calls.
 *
 * @example
 * const validator = validateRequest(ResultZipRequestSchema);
 * const body = validator({ taskIds: ['t1', 't2'] });
 * if (body.isOk()) {
 *     await request('tasks/result-zip', { method: 'POST', json: body.value });
 * }
 */
export function validateRequest<S extends Type>(
  schema: S,
): (body: S['inferIn']) => Result<S['infer'], ApiError<never>> {
  return (body: S['inferIn']) => {
    const result = validate(schema, body);
    if (result.isErr()) {
      return err({
        _type: 'ValidationError',
        status: null,
        summary: `Request body schema mismatch: ${result.error.summary}`,
        issues: result.error,
      } as ApiError<never>);
    }
    return ok(result.value);
  };
}

/**
 * Logs non-HttpError variants via `console.error`.  Designed for use with
 * `.orTee()`.
 *
 * - `HttpError` -> skipped (caller handles logging).
 * - `NetworkError` -> logs the error message.
 * - `ValidationError` -> logs the summary (and status if non-null).
 * - `UnhandledStatusError` -> logs the status and data.
 * - `UnexpectedError` -> logs the original thrown value.
 *
 * @example
 * request(url, options)
 *   .andThen(parseJson)
 *   .andThen(validateSuccess(Schema))
 *   .orTee(logNonHttpErrors) // logs network/validation/unexpected errors
 */
export function logNonHttpErrors<E extends HttpError<number, unknown>>(
  error: ApiError<E>,
): void {
  if (error._type === 'HttpError') {
    return;
  }
  if (error._type === 'NetworkError') {
    console.error('Network error:', error.error.message);
    return;
  }
  if (error._type === 'ValidationError') {
    if (error.status !== null) {
      console.error('Validation error:', error.summary, 'status:', error.status);
    } else {
      console.error('Validation error:', error.summary);
    }
    return;
  }
  if (error._type === 'UnhandledStatusError') {
    console.error('Unhandled status error:', error.status, error.data);
    return;
  }
  if (error._type === 'UnexpectedError') {
    console.error('Unexpected error:', error.error);
    return;
  }
}

/**
 * Full convenience pipeline for standard JSON endpoints.
 *
 * Internally chains:
 *   `request -> andThen(parseJson) -> orElse(validateFailure) ->
 *    andThen(validateSuccess) -> orTee(logNonHttpErrors)`
 *
 * @param url     - Relative URL path.
 * @param schemas - `{ success, failures?, fallbackFailure? }`.
 * @param options - Optional ky request options.
 *
 * @returns `ResultAsync<S['infer'], ApiError<InferHttpErrors<F, FB>>>`
 *
 * @example
 * const result = await fetchAndValidate('tasks', {
 *     success: TaskSchema,
 *     failures: { 422: FastApiErrorSchema },
 * });
 */
export function fetchAndValidate<
  S extends Type,
  F extends Record<number, Type> = {},
  FB extends Type | undefined = undefined,
>(
  url: string,
  schemas: { success: S; failures?: F; fallbackFailure?: FB },
  options?: Options,
): ResultAsync<S['infer'], ApiError<InferHttpErrors<F, FB>>> {
  const failures = (schemas.failures ?? {}) as F;
  return (request(url, options)
    .andThen(parseJson)
    .orElse(validateFailure<F, FB>(failures, schemas.fallbackFailure))
    .andThen(validateSuccess(schemas.success))
    .orTee(logNonHttpErrors) as unknown as ResultAsync<
    S['infer'],
    ApiError<InferHttpErrors<F, FB>>
  >);
}

/**
 * Convenience pipeline for endpoints that return binary data on success
 * but JSON on error (e.g. `POST /tasks/result-zip`: 200=ZIP, 409=JSON).
 *
 * Internally chains:
 *   `request -> andThen(parseBlob|parseArrayBuffer) ->
 *    orElse(validateFailure) -> orTee(logNonHttpErrors)`
 *
 * No success schema is needed -- the binary body is not validated.
 * The `failures` / `fallbackFailure` schemas validate JSON error bodies.
 *
 * @param url     - Relative URL path.
 * @param schemas - `{ binary?, failures?, fallbackFailure? }`.
 *                  `binary` defaults to `'blob'` (use `'arrayBuffer'` for
 *                  in-memory byte processing).  `'blob'` returns a
 *                  `BlobResult` (includes response headers for
 *                  `Content-Disposition`).
 * @param options - Optional ky request options.
 *
 * @returns On 2xx: `Ok(BlobResult)` or `Ok(ArrayBuffer)` depending on
 *          `binary`.  On error: `Err(HttpError<status, ...>)`,
 *          `Err(UnhandledStatusError)`, `Err(NetworkError)`, etc.
 *
 * @example
 * const result = await fetchBinaryAndValidate('tasks/result-zip', {
 *     failures: { 409: NonDownloadableSchema },
 * }, { method: 'POST', json: { taskIds: ['t1', 't2'] } });
 *
 * if (result.isOk()) {
 *     const { blob, headers } = result.value;
 *     const filename = headers.get('content-disposition');
 * }
 */
export function fetchBinaryAndValidate<
  F extends Record<number, Type> = {},
  FB extends Type | undefined = undefined,
  B extends 'blob' | 'arrayBuffer' = 'blob',
>(
  url: string,
  schemas: {
    binary?: B;
    failures?: F;
    fallbackFailure?: FB;
  },
  options?: Options,
): ResultAsync<
  B extends 'arrayBuffer' ? ArrayBuffer : BlobResult,
  ApiError<InferHttpErrors<F, FB>>
> {
  const failures = (schemas.failures ?? {}) as F;
  const binary = schemas.binary ?? ('blob' as B);

  if (binary === 'arrayBuffer') {
    return (request(url, options)
      .andThen(parseArrayBuffer)
      .orElse(validateFailure<F, FB>(failures, schemas.fallbackFailure))
      .orTee(logNonHttpErrors) as unknown as ResultAsync<
      B extends 'arrayBuffer' ? ArrayBuffer : BlobResult,
      ApiError<InferHttpErrors<F, FB>>
    >);
  }

  return (request(url, options)
    .andThen(parseBlob)
    .orElse(validateFailure<F, FB>(failures, schemas.fallbackFailure))
    .orTee(logNonHttpErrors) as unknown as ResultAsync<
    B extends 'arrayBuffer' ? ArrayBuffer : BlobResult,
    ApiError<InferHttpErrors<F, FB>>
  >);
}
