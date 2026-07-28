import { describe, it, expect } from 'vitest';
import { type } from 'arktype';
import {
  createHttpError,
  isHttpError,
  isNetworkError,
  isValidationError,
  isUnhandledStatusError,
  isUnexpectedError,
  type ApiError,
  type ApiErrorBase,
  type HttpError,
  type InferHttpErrors,
} from '../../src/core/error-model';

// Spec: frontend/specs/core/error-model.md
//
// This file tests the error model contract: HttpError, ApiErrorBase,
// ApiError<E>, type guards, createHttpError, InferHttpErrors.

const SchemaX = type({ foo: 'string' });
const SchemaF = type({ bar: 'number' });

describe('error-model: HttpError interface', () => {
  // Spec: error-model.md "HttpError<Status, Data>"
  // - _type: 'HttpError'
  // - status: Status (number literal)
  // - data: Data

  it('HttpError has _type="HttpError", status, and data fields', () => {
    // Invariant 3: createHttpError(401, { detail: 'x' }) returns object
    // satisfying isHttpError(...) === true, status === 401, data.detail === 'x'
    const err = createHttpError(401, { detail: 'x' });
    expect(err._type).toBe('HttpError');
    expect(err.status).toBe(401);
    expect((err.data as { detail: string }).detail).toBe('x');
  });

  it('createHttpError preserves literal status type and exact data type', () => {
    const err = createHttpError(404, { not_found: true });
    expect(err.status).toBe(404);
    expect((err.data as { not_found: boolean }).not_found).toBe(true);
  });

  it('createHttpError with undefined data preserves undefined', () => {
    // Spec: error-model.md "空体约定" - HttpError.data is undefined when body is empty
    const err = createHttpError(500, undefined);
    expect(err.data).toBeUndefined();
  });
});

describe('error-model: ApiErrorBase has exactly 4 variants', () => {
  // Spec: error-model.md Invariant 1
  // ApiErrorBase has exactly 4 variants: NetworkError, ValidationError,
  // UnhandledStatusError, UnexpectedError

  it('NetworkError variant shape', () => {
    const e: ApiErrorBase = { _type: 'NetworkError', error: new Error('dns') };
    expect(e._type).toBe('NetworkError');
    expect((e as { error: Error }).error).toBeInstanceOf(Error);
  });

  it('ValidationError variant shape with status=null', () => {
    const e: ApiErrorBase = {
      _type: 'ValidationError',
      status: null,
      summary: 'bad',
      issues: null,
    };
    expect(e._type).toBe('ValidationError');
    expect((e as { status: number | null }).status).toBeNull();
    expect((e as { summary: string }).summary).toBe('bad');
  });

  it('ValidationError variant shape with status=number', () => {
    const e: ApiErrorBase = {
      _type: 'ValidationError',
      status: 422,
      summary: 'mismatch',
      issues: null,
    };
    expect((e as { status: number | null }).status).toBe(422);
  });

  it('UnhandledStatusError variant shape', () => {
    const e: ApiErrorBase = {
      _type: 'UnhandledStatusError',
      status: 500,
      data: 'oops',
    };
    expect(e._type).toBe('UnhandledStatusError');
    expect((e as { status: number }).status).toBe(500);
  });

  it('UnhandledStatusError data can be undefined (empty body)', () => {
    // Spec: error-model.md "空体约定" - data undefined when body missing
    const e: ApiErrorBase = {
      _type: 'UnhandledStatusError',
      status: 500,
      data: undefined,
    };
    expect((e as { data: unknown }).data).toBeUndefined();
  });

  it('UnexpectedError variant shape', () => {
    const e: ApiErrorBase = { _type: 'UnexpectedError', error: 'boom' };
    expect(e._type).toBe('UnexpectedError');
    expect((e as { error: unknown }).error).toBe('boom');
  });
});

describe('error-model: ApiError<E> default type param', () => {
  // Spec: error-model.md Invariant 2
  // ApiError<E> is ApiErrorBase | E; E defaults to HttpError<number, unknown>

  it('ApiError without generic param accepts HttpError<any, any>', () => {
    const httpErr: HttpError<number, unknown> = createHttpError(404, 'nf');
    const e: ApiError = httpErr;
    expect(e._type).toBe('HttpError');
  });

  it('ApiError without generic param accepts any ApiErrorBase variant', () => {
    const e1: ApiError = { _type: 'NetworkError', error: new Error('x') };
    const e2: ApiError = {
      _type: 'ValidationError',
      status: null,
      summary: 's',
      issues: null,
    };
    expect(e1._type).toBe('NetworkError');
    expect(e2._type).toBe('ValidationError');
  });

  it('ApiError<E> accepts endpoint-specific HttpError union', () => {
    type E = HttpError<401, { detail: string }> | HttpError<409, { reason: string }>;
    const e1: ApiError<E> = createHttpError(401, { detail: 'unauth' });
    const e2: ApiError<E> = createHttpError(409, { reason: 'conflict' });
    expect(e1.status).toBe(401);
    expect(e2.status).toBe(409);
  });
});

describe('error-model: createHttpError', () => {
  // Spec: error-model.md Invariant 3
  // createHttpError(401, { detail: 'x' }) satisfies isHttpError === true,
  // status === 401, data.detail === 'x'

  it('returns object with _type="HttpError"', () => {
    const err = createHttpError(200, {});
    expect(err._type).toBe('HttpError');
  });

  it('preserves status code as literal type', () => {
    const err = createHttpError(422, { detail: 'invalid' });
    expect(err.status).toBe(422);
  });

  it('preserves data reference', () => {
    const payload = { a: 1, b: [2, 3] };
    const err = createHttpError(400, payload);
    expect(err.data).toBe(payload);
  });
});

describe('error-model: type guards', () => {
  // Spec: error-model.md "类型守卫"
  // Each guard checks only its _type literal, returns boolean.
  // isHttpError returns true for any HttpError<S, D>.

  const httpErr = (): ApiError => createHttpError(404, 'nf');
  const netErr = (): ApiError => ({ _type: 'NetworkError', error: new Error('dns') });
  const valErr = (): ApiError => ({
    _type: 'ValidationError',
    status: null,
    summary: 'bad',
    issues: null,
  });
  const unhandledErr = (): ApiError => ({
    _type: 'UnhandledStatusError',
    status: 500,
    data: 'oops',
  });
  const unexpectedErr = (): ApiError => ({ _type: 'UnexpectedError', error: 'boom' });

  describe('isHttpError', () => {
    it('returns true for HttpError variant', () => {
      expect(isHttpError(httpErr())).toBe(true);
    });
    it('returns false for NetworkError', () => {
      expect(isHttpError(netErr())).toBe(false);
    });
    it('returns false for ValidationError', () => {
      expect(isHttpError(valErr())).toBe(false);
    });
    it('returns false for UnhandledStatusError', () => {
      expect(isHttpError(unhandledErr())).toBe(false);
    });
    it('returns false for UnexpectedError', () => {
      expect(isHttpError(unexpectedErr())).toBe(false);
    });
  });

  describe('isNetworkError', () => {
    it('returns true for NetworkError variant', () => {
      expect(isNetworkError(netErr())).toBe(true);
    });
    it('returns false for HttpError', () => {
      expect(isNetworkError(httpErr())).toBe(false);
    });
    it('returns false for ValidationError', () => {
      expect(isNetworkError(valErr())).toBe(false);
    });
    it('returns false for UnhandledStatusError', () => {
      expect(isNetworkError(unhandledErr())).toBe(false);
    });
    it('returns false for UnexpectedError', () => {
      expect(isNetworkError(unexpectedErr())).toBe(false);
    });
  });

  describe('isValidationError', () => {
    it('returns true for ValidationError variant', () => {
      expect(isValidationError(valErr())).toBe(true);
    });
    it('returns false for HttpError', () => {
      expect(isValidationError(httpErr())).toBe(false);
    });
    it('returns false for NetworkError', () => {
      expect(isValidationError(netErr())).toBe(false);
    });
    it('returns false for UnhandledStatusError', () => {
      expect(isValidationError(unhandledErr())).toBe(false);
    });
    it('returns false for UnexpectedError', () => {
      expect(isValidationError(unexpectedErr())).toBe(false);
    });
  });

  describe('isUnhandledStatusError', () => {
    it('returns true for UnhandledStatusError variant', () => {
      expect(isUnhandledStatusError(unhandledErr())).toBe(true);
    });
    it('returns false for HttpError', () => {
      expect(isUnhandledStatusError(httpErr())).toBe(false);
    });
    it('returns false for NetworkError', () => {
      expect(isUnhandledStatusError(netErr())).toBe(false);
    });
    it('returns false for ValidationError', () => {
      expect(isUnhandledStatusError(valErr())).toBe(false);
    });
    it('returns false for UnexpectedError', () => {
      expect(isUnhandledStatusError(unexpectedErr())).toBe(false);
    });
  });

  describe('isUnexpectedError', () => {
    it('returns true for UnexpectedError variant', () => {
      expect(isUnexpectedError(unexpectedErr())).toBe(true);
    });
    it('returns false for HttpError', () => {
      expect(isUnexpectedError(httpErr())).toBe(false);
    });
    it('returns false for NetworkError', () => {
      expect(isUnexpectedError(netErr())).toBe(false);
    });
    it('returns false for ValidationError', () => {
      expect(isUnexpectedError(valErr())).toBe(false);
    });
    it('returns false for UnhandledStatusError', () => {
      expect(isUnexpectedError(unhandledErr())).toBe(false);
    });
  });
});

describe('error-model: discriminant union completeness', () => {
  // Spec: error-model.md Invariant 6
  // Any ApiError<E> value's _type matches exactly one variant.

  it('no two base variants share _type', () => {
    // Construct one of each base variant, plus an HttpError
    const errors: ApiError[] = [
      { _type: 'NetworkError', error: new Error('x') },
      { _type: 'ValidationError', status: null, summary: 's', issues: null },
      { _type: 'UnhandledStatusError', status: 500, data: null },
      { _type: 'UnexpectedError', error: null },
      createHttpError(200, {}),
    ];
    const types = errors.map((e) => e._type);
    expect(new Set(types).size).toBe(types.length);
  });

  it('ApiErrorBase _type literals are exactly the 4 defined variants', () => {
    // Type-level check: ApiErrorBase must only contain these 4 _type values.
    // If the type is correct, Extract picks the right variant.
    type NetworkVariant = Extract<ApiErrorBase, { _type: 'NetworkError' }>;
    type ValidationVariant = Extract<ApiErrorBase, { _type: 'ValidationError' }>;
    type UnhandledVariant = Extract<ApiErrorBase, { _type: 'UnhandledStatusError' }>;
    type UnexpectedVariant = Extract<ApiErrorBase, { _type: 'UnexpectedError' }>;
    // Each variant must be non-never (i.e. exists in ApiErrorBase)
    const _n: NetworkVariant['error'] = new Error('x');
    const _v: ValidationVariant['summary'] = 's';
    const _u: UnhandledVariant['status'] = 500;
    const _ue: UnexpectedVariant['error'] = null;
    // If any variant didn't exist in ApiErrorBase, the Extract would be never,
    // and the assignment would fail at compile time.
    expect(_n).toBeInstanceOf(Error);
  });
});

describe('error-model: InferHttpErrors type-level', () => {
  // Spec: error-model.md Invariant 4 & 5
  // Invariant 4: InferHttpErrors<{ 404: SchemaX }> === HttpError<404, SchemaX['infer']>
  // Invariant 5: InferHttpErrors<{ 404: SchemaX }, SchemaF>
  //              === HttpError<404, X['infer']> | HttpError<number, F['infer']>

  // Helper: type-level exactness check. If Inferred is exactly T, this compiles.
  // Uses bidirectional assignability: [Inferred] extends [T] AND [T] extends [Inferred].
  type IsExact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

  it('InferHttpErrors<{404: SchemaX}> is exactly HttpError<404, SchemaX[infer]>', () => {
    type F = { 404: typeof SchemaX };
    type Inferred = InferHttpErrors<F>;
    type Expected = HttpError<404, typeof SchemaX['infer']>;
    type Check = IsExact<Inferred, Expected>;
    const _c: Check = true;
    expect(_c).toBe(true);
  });

  it('InferHttpErrors<{404: SchemaX}> does NOT accept other status codes (negative check)', () => {
    type F = { 404: typeof SchemaX };
    type Inferred = InferHttpErrors<F>;
    // createHttpError(500, ...) should NOT be assignable to Inferred
    // (HttpError<500, ...> is not in the union HttpError<404, ...>)
    type IsAssignable = HttpError<500, unknown> extends Inferred ? true : false;
    const _c: IsAssignable = false;
    expect(_c).toBe(false);
  });

  it('InferHttpErrors<{404: SchemaX}, SchemaF> is exactly HttpError<404, X> | HttpError<number, F>', () => {
    type F = { 404: typeof SchemaX };
    type Inferred = InferHttpErrors<F, typeof SchemaF | undefined>;
    type Expected =
      | HttpError<404, typeof SchemaX['infer']>
      | HttpError<number, typeof SchemaF['infer']>;
    type Check = IsExact<Inferred, Expected>;
    const _c: Check = true;
    expect(_c).toBe(true);
  });

  it('InferHttpErrors with empty failures map ({}) and no fallback yields never', () => {
    // Spec: error-model.md rule 3 - no FB means unlisted statuses produce
    // UnhandledStatusError at runtime, not HttpError. So InferHttpErrors<{}> = never.
    type Inferred = InferHttpErrors<{}>;
    type Check = IsExact<Inferred, never>;
    const _c: Check = true;
    expect(_c).toBe(true);
  });

  it('InferHttpErrors with multiple statuses yields exact union', () => {
    type F = { 401: typeof SchemaX; 409: typeof SchemaF };
    type Inferred = InferHttpErrors<F>;
    type Expected =
      | HttpError<401, typeof SchemaX['infer']>
      | HttpError<409, typeof SchemaF['infer']>;
    type Check = IsExact<Inferred, Expected>;
    const _c: Check = true;
    expect(_c).toBe(true);
  });

  it('InferHttpErrors with string keys (not number) yields never', () => {
    // Spec: validation.md lines 78-82 - caller must NOT use string keys like '422'.
    // ParseInt<'422'> = 422 (template literal converts), but 'foo' would yield never.
    // Actually ParseInt<'422'> does work since TS converts '422' to 422 via template.
    // But a non-numeric string key like 'foo' should yield never.
    type F = { foo: typeof SchemaX };
    type Inferred = InferHttpErrors<F>;
    type Check = IsExact<Inferred, never>;
    const _c: Check = true;
    expect(_c).toBe(true);
  });
});

describe('error-model: empty body convention', () => {
  // Spec: error-model.md Invariant 7 & "空体约定"
  // HttpError.data and UnhandledStatusError.data are undefined when body missing.
  // Consumers must use == null check (covers undefined and null).

  it('HttpError.data is undefined when body is missing', () => {
    const err = createHttpError(204, undefined);
    expect(err.data).toBeUndefined();
    // == null check should be true
    expect(err.data == null).toBe(true);
  });

  it('UnhandledStatusError.data is undefined when body is missing', () => {
    const e: ApiErrorBase = {
      _type: 'UnhandledStatusError',
      status: 500,
      data: undefined,
    };
    expect((e as { data: unknown }).data).toBeUndefined();
    expect((e as { data: unknown }).data == null).toBe(true);
  });
});
