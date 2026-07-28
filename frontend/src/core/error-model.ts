import type { ArkErrors, Type } from 'arktype';

// Spec: frontend/specs/core/error-model.md

export interface HttpError<Status extends number, Data> {
  readonly _type: 'HttpError';
  readonly status: Status;
  readonly data: Data;
}

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

export type ApiError<E = HttpError<number, unknown>> = ApiErrorBase | E;

export type ParseInt<T> = T extends number
  ? T
  : T extends `${infer N extends number}`
    ? N
    : never;

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

export function createHttpError<S extends number, D>(status: S, data: D): HttpError<S, D> {
  return { _type: 'HttpError', status, data };
}

export function isHttpError<E extends HttpError<number, unknown>>(
  error: ApiError<E>,
): error is Extract<ApiError<E>, { _type: 'HttpError' }> {
  return error._type === 'HttpError';
}

export function isNetworkError<E extends HttpError<number, unknown>>(
  error: ApiError<E>,
): error is Extract<ApiError<E>, { _type: 'NetworkError' }> {
  return error._type === 'NetworkError';
}

export function isValidationError<E extends HttpError<number, unknown>>(
  error: ApiError<E>,
): error is Extract<ApiError<E>, { _type: 'ValidationError' }> {
  return error._type === 'ValidationError';
}

export function isUnhandledStatusError<E extends HttpError<number, unknown>>(
  error: ApiError<E>,
): error is Extract<ApiError<E>, { _type: 'UnhandledStatusError' }> {
  return error._type === 'UnhandledStatusError';
}

export function isUnexpectedError<E extends HttpError<number, unknown>>(
  error: ApiError<E>,
): error is Extract<ApiError<E>, { _type: 'UnexpectedError' }> {
  return error._type === 'UnexpectedError';
}
