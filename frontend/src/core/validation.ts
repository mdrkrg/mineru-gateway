import type { Type, ArkErrors } from 'arktype';
import type { Options } from 'ky';
import type { Result, ResultAsync } from 'neverthrow';
import type {
  ApiError,
  HttpError,
  InferHttpErrors,
} from './error-model';
import type { RawResponse, BlobResult } from './http-client';

// Spec: frontend/specs/core/validation.md

export function validate<S extends Type>(
  schema: S,
  data: unknown,
): Result<S['infer'], ArkErrors> {
  throw new Error('not implemented');
}

export function validateSuccess<S extends Type>(
  schema: S,
): (data: unknown) => Result<S['infer'], ApiError<never>> {
  throw new Error('not implemented');
}

export function validateFailure<
  F extends Record<number, Type>,
  FB extends Type | undefined = undefined,
>(
  failures: F,
  fallback?: FB,
): (
  error: ApiError<HttpError<number, unknown>>,
) => Result<never, ApiError<InferHttpErrors<F, FB>>> {
  throw new Error('not implemented');
}

export function validateRequest<S extends Type>(
  schema: S,
): (body: unknown) => Result<S['infer'], ApiError<never>> {
  throw new Error('not implemented');
}

export function logNonHttpErrors<E extends HttpError<number, unknown>>(
  error: ApiError<E>,
): void {
  throw new Error('not implemented');
}

export function fetchAndValidate<
  S extends Type,
  F extends Record<number, Type> = {},
  FB extends Type | undefined = undefined,
>(
  url: string,
  schemas: { success: S; failures?: F; fallbackFailure?: FB },
  options?: Options,
): ResultAsync<S['infer'], ApiError<InferHttpErrors<F, FB>>> {
  throw new Error('not implemented');
}

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
  throw new Error('not implemented');
}
