import { ArkErrors } from 'arktype';
import type { Type } from 'arktype';
import type { Options } from 'ky';
import { ok, err } from 'neverthrow';
import type { Result, ResultAsync } from 'neverthrow';
import {
  createHttpError,
  isHttpError,
} from './error-model';
import type {
  ApiError,
  HttpError,
  InferHttpErrors,
} from './error-model';
import { request, parseJson, parseBlob, parseArrayBuffer } from './http-client';
import type { BlobResult } from './http-client';

// Spec: frontend/specs/core/validation.md

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

export function validateRequest<S extends Type>(
  schema: S,
): (body: unknown) => Result<S['infer'], ApiError<never>> {
  return (body: unknown) => {
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
