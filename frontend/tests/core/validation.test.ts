import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { type, ArkErrors } from 'arktype';

// Spec: frontend/specs/core/validation.md
//
// This file tests the validation layer contract: validate,
// validateSuccess, validateFailure, validateRequest, logNonHttpErrors,
// fetchAndValidate, fetchBinaryAndValidate.

// ---------------------------------------------------------------------------
// ky mock (same structure as http-client.test.ts)
// ---------------------------------------------------------------------------

const kyMock = vi.hoisted(() => {
  const fn = vi.fn() as unknown as ReturnType<typeof vi.fn> & {
    extend: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    retry: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    post: ReturnType<typeof vi.fn>;
    put: ReturnType<typeof vi.fn>;
    patch: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    head: ReturnType<typeof vi.fn>;
  };
  Object.assign(fn, {
    extend: vi.fn(() => fn),
    create: vi.fn(() => fn),
    stop: vi.fn(),
    retry: vi.fn(),
    get: vi.fn(() => fn),
    post: vi.fn(() => fn),
    put: vi.fn(() => fn),
    patch: vi.fn(() => fn),
    delete: vi.fn(() => fn),
    head: vi.fn(() => fn),
  });

  class HTTPError extends Error {
    response: Response;
    request: Request;
    data: unknown;
    constructor(response: Response, request: Request, options: unknown) {
      super(`HTTPError: ${response.status}`);
      this.name = 'HTTPError';
      this.response = response;
      this.request = request;
      this.data = undefined;
    }
  }

  class NetworkError extends Error {
    cause?: Error;
    constructor(message: string, options?: { cause?: Error }) {
      super(message);
      this.name = 'NetworkError';
      if (options?.cause) this.cause = options.cause;
    }
  }

  class TimeoutError extends Error {
    request: Request;
    constructor(request: Request) {
      super('Request timed out');
      this.name = 'TimeoutError';
      this.request = request;
    }
  }

  return { fn, HTTPError, NetworkError, TimeoutError };
});

vi.mock('ky', () => ({
  default: kyMock.fn,
  HTTPError: kyMock.HTTPError,
  NetworkError: kyMock.NetworkError,
  TimeoutError: kyMock.TimeoutError,
  isHTTPError: (e: unknown) => e instanceof kyMock.HTTPError,
  isNetworkError: (e: unknown) => e instanceof kyMock.NetworkError,
  isTimeoutError: (e: unknown) => e instanceof kyMock.TimeoutError,
}));

// ---------------------------------------------------------------------------
// Imports (after mock setup)
// ---------------------------------------------------------------------------

import {
  validate,
  validateSuccess,
  validateFailure,
  validateRequest,
  logNonHttpErrors,
  fetchAndValidate,
  fetchBinaryAndValidate,
} from '../../src/core/validation';
import {
  createHttpError,
  isHttpError,
  isNetworkError,
  isValidationError,
  isUnhandledStatusError,
  isUnexpectedError,
  type ApiError,
} from '../../src/core/error-model';
import { defineResponseSchema, defineRequestSchema } from '../../src/core/conventions';

// ---------------------------------------------------------------------------
// Test schemas
// ---------------------------------------------------------------------------

const SchemaA = defineResponseSchema(
  { detail: 'string' },
  {} as { detail: string },
);
const FallbackSchema = defineResponseSchema(
  { error: 'string' },
  {} as { error: string },
);
const SchemaNonDownloadable = defineResponseSchema(
  {
    detail: 'string',
    non_downloadable: type({
      task_id: 'string',
      status: 'string',
      reason: 'string',
    }).array(),
  },
  {} as {
    detail: string;
    nonDownloadable: { taskId: string; status: string; reason: string }[];
  },
);
const SuccessSchema = defineResponseSchema(
  { task_id: 'string', status: 'string' },
  {} as { taskId: string; status: string },
);
const RequestSchema = defineRequestSchema(
  { taskIds: 'string[]' },
  {} as { task_ids: string[] },
);

// Plain arktype schema (no morph) for basic validate tests
const PlainSchema = type({ foo: 'string', count: 'number' });

beforeEach(() => {
  kyMock.fn.mockReset();
});

// ---------------------------------------------------------------------------
// validate()
// ---------------------------------------------------------------------------

describe('validation: validate', () => {
  // Spec: validation.md "arktype->neverthrow bridge validate"
  // - calls schema(data)
  // - ArkErrors instance -> err(thatInstance)
  // - otherwise -> ok(data as S['infer'])

  it('returns ok with typed value for valid data (invariant 1)', () => {
    const result = validate(PlainSchema, { foo: 'bar', count: 5 });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.foo).toBe('bar');
      expect(result.value.count).toBe(5);
    }
  });

  it('returns err(ArkErrors) for invalid data (invariant 2)', () => {
    const result = validate(PlainSchema, { foo: 'bar', count: 'not-a-number' });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(ArkErrors);
    }
  });

  it('returns err(ArkErrors) for missing required field', () => {
    const result = validate(PlainSchema, { foo: 'bar' });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(ArkErrors);
    }
  });

  it('applies morph when schema has .pipe(camelCase)', () => {
    const result = validate(SchemaA, { detail: 'msg' });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      // SchemaA has no underscore keys, so output equals input shape
      expect(result.value.detail).toBe('msg');
    }
  });

  it('applies morph for snake_case -> camelCase conversion', () => {
    const result = validate(SchemaNonDownloadable, {
      detail: 'failed',
      non_downloadable: [
        { task_id: 't1', status: 'failed', reason: 'not_completed' },
      ],
    });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.nonDownloadable[0].taskId).toBe('t1');
    }
  });
});

// ---------------------------------------------------------------------------
// validateSuccess()
// ---------------------------------------------------------------------------

describe('validation: validateSuccess', () => {
  // Spec: validation.md "validateSuccess"
  // - input data: unknown (from parseJson or manual)
  // - calls validate(schema, data)
  // - success -> ok(validated) with type S['infer']
  // - failure -> err(ValidationError, status=null, summary, issues=ArkErrors)

  it('returns ok for valid data', () => {
    const validator = validateSuccess(SchemaA);
    const result = validator({ detail: 'success msg' });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.detail).toBe('success msg');
    }
  });

  it('returns err(ValidationError) for invalid data (invariant 3)', () => {
    const validator = validateSuccess(SchemaA);
    const result = validator({ detail: 123 });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error._type).toBe('ValidationError');
      expect((result.error as { status: number | null }).status).toBeNull();
      expect((result.error as { summary: string }).summary).toBeTruthy();
      expect((result.error as { issues: unknown }).issues).toBeInstanceOf(ArkErrors);
    }
  });

  it('returns err(ValidationError) for missing field', () => {
    const validator = validateSuccess(SchemaA);
    const result = validator({});
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error._type).toBe('ValidationError');
    }
  });

  it('status is null (success branch has no HTTP status)', () => {
    const validator = validateSuccess(PlainSchema);
    const result = validator({ foo: 123, count: 5 });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect((result.error as { status: number | null }).status).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// validateFailure()
// ---------------------------------------------------------------------------

describe('validation: validateFailure', () => {
  // Spec: validation.md "validateFailure" invariants 4-9

  it('returns err(HttpError) when status matches and body validates (invariant 4)', () => {
    const fn = validateFailure({ 422: SchemaA });
    const result = fn(createHttpError(422, { detail: 'validation failed' }));
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error._type).toBe('HttpError');
      expect((result.error as { status: number }).status).toBe(422);
      expect((result.error as { data: { detail: string } }).data.detail).toBe(
        'validation failed',
      );
    }
  });

  it('returns err(UnhandledStatusError) when status not in failures (invariant 5)', () => {
    const fn = validateFailure({ 422: SchemaA });
    const result = fn(createHttpError(404, { whatever: 'x' }));
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error._type).toBe('UnhandledStatusError');
      expect((result.error as { status: number }).status).toBe(404);
    }
  });

  it('returns err(HttpError) via fallback when status not in failures (invariant 6)', () => {
    const fn = validateFailure({ 422: SchemaA }, FallbackSchema);
    const result = fn(createHttpError(404, { error: 'not found' }));
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error._type).toBe('HttpError');
      expect((result.error as { status: number }).status).toBe(404);
      expect((result.error as { data: { error: string } }).data.error).toBe(
        'not found',
      );
    }
  });

  it('returns err(UnhandledStatusError) with undefined data for empty body (invariant 7)', () => {
    const fn = validateFailure({});
    const result = fn(createHttpError(500, undefined));
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error._type).toBe('UnhandledStatusError');
      expect((result.error as { data: unknown }).data).toBeUndefined();
    }
  });

  it('returns err(ValidationError) preserving status when body schema mismatch (invariant 8)', () => {
    const fn = validateFailure({ 422: SchemaA });
    // SchemaA expects { detail: string }, pass invalid body
    const result = fn(createHttpError(422, { wrong_field: 123 }));
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error._type).toBe('ValidationError');
      expect((result.error as { status: number | null }).status).toBe(422);
      expect((result.error as { summary: string }).summary).toContain('422');
      expect((result.error as { issues: unknown }).issues).toBeInstanceOf(ArkErrors);
    }
  });

  it('passes through NetworkError unchanged (invariant 9)', () => {
    const fn = validateFailure({ 422: SchemaA });
    const netErr: ApiError = { _type: 'NetworkError', error: new Error('dns') };
    const result = fn(netErr);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error._type).toBe('NetworkError');
      expect((result.error as { error: Error }).error.message).toBe('dns');
    }
  });

  it('passes through ValidationError unchanged', () => {
    const fn = validateFailure({ 422: SchemaA });
    const valErr: ApiError = {
      _type: 'ValidationError',
      status: null,
      summary: 'prev error',
      issues: null,
    };
    const result = fn(valErr);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error._type).toBe('ValidationError');
      expect((result.error as { summary: string }).summary).toBe('prev error');
    }
  });

  it('passes through UnhandledStatusError unchanged', () => {
    const fn = validateFailure({ 422: SchemaA });
    const unhandled: ApiError = {
      _type: 'UnhandledStatusError',
      status: 500,
      data: 'oops',
    };
    const result = fn(unhandled);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error._type).toBe('UnhandledStatusError');
    }
  });

  it('passes through UnexpectedError unchanged', () => {
    const fn = validateFailure({ 422: SchemaA });
    const unexpected: ApiError = { _type: 'UnexpectedError', error: 'boom' };
    const result = fn(unexpected);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error._type).toBe('UnexpectedError');
    }
  });

  it('applies snake_case -> camelCase morph to error body', () => {
    const fn = validateFailure({ 409: SchemaNonDownloadable });
    const result = fn(
      createHttpError(409, {
        detail: 'failed',
        non_downloadable: [
          { task_id: 't1', status: 'failed', reason: 'not_completed' },
        ],
      }),
    );
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      const data = (result.error as { data: unknown }).data as {
        nonDownloadable: { taskId: string }[];
      };
      expect(data.nonDownloadable[0].taskId).toBe('t1');
    }
  });

  it('always returns err (Result<never, ...>) - never ok', () => {
    const fn = validateFailure({ 422: SchemaA });
    const result = fn(createHttpError(422, { detail: 'x' }));
    expect(result.isErr()).toBe(true);
  });

  // Spec: conventions.md invariant 8 - UnhandledStatusError.data is
  // un-morphed ky pre-parsed value (snake_case keys preserved).
  it('UnhandledStatusError.data preserves snake_case keys (no morph applied)', () => {
    const fn = validateFailure({ 422: SchemaA });
    // 500 is not in failures, no fallback -> UnhandledStatusError
    // data should be the raw snake_case object, NOT camelCased
    const result = fn(
      createHttpError(500, { detail: 'err', non_downloadable: [{ task_id: 't1' }] }),
    );
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error._type).toBe('UnhandledStatusError');
      const data = (result.error as { data: unknown }).data as Record<string, unknown>;
      // Keys must remain snake_case (no morph applied)
      expect(data).toHaveProperty('non_downloadable');
      expect(data).not.toHaveProperty('nonDownloadable');
      const items = data.non_downloadable as { task_id: string }[];
      expect(items[0]).toHaveProperty('task_id');
      expect(items[0]).not.toHaveProperty('taskId');
    }
  });

  // Spec: validation.md line 74 - summary format for body mismatch
  it('ValidationError summary contains "Schema mismatch for HTTP" prefix', () => {
    const fn = validateFailure({ 422: SchemaA });
    const result = fn(createHttpError(422, { wrong_field: 123 }));
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      const summary = (result.error as { summary: string }).summary;
      expect(summary).toContain('Schema mismatch for HTTP');
      expect(summary).toContain('422');
    }
  });
});

// ---------------------------------------------------------------------------
// validateRequest()
// ---------------------------------------------------------------------------

describe('validation: validateRequest', () => {
  // Spec: validation.md "validateRequest (optional composable)" & invariant 13

  it('returns ok with snake_case wire format for valid body', () => {
    const validator = validateRequest(RequestSchema);
    const result = validator({ taskIds: ['t1', 't2'] });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.task_ids).toEqual(['t1', 't2']);
    }
  });

  it('returns err(ValidationError) for invalid body (invariant 13)', () => {
    const validator = validateRequest(RequestSchema);
    const result = validator({ taskIds: 'not-an-array' });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error._type).toBe('ValidationError');
      expect((result.error as { status: number | null }).status).toBeNull();
      expect((result.error as { issues: unknown }).issues).toBeInstanceOf(ArkErrors);
    }
  });

  it('returns err(ValidationError) for missing field', () => {
    const validator = validateRequest(RequestSchema);
    const result = validator({});
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error._type).toBe('ValidationError');
    }
  });

  // Spec: validation.md line 228 - summary format for request body mismatch
  it('ValidationError summary contains "Request body schema mismatch" prefix', () => {
    const validator = validateRequest(RequestSchema);
    const result = validator({ taskIds: 123 });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      const summary = (result.error as { summary: string }).summary;
      expect(summary).toContain('Request body schema mismatch');
    }
  });

  // Spec: validation.md invariant 13 - "request not sent (ky not called)"
  // validateRequest runs BEFORE request(); if it fails, no HTTP call is made.
  it('does not send request when validation fails (invariant 13)', () => {
    // The spec says: "失败时不发请求（在 request 之前短路）"
    // validateRequest is a composable that runs before request(). If it
    // returns err, the caller should short-circuit and never call request().
    // We verify validateRequest itself does not call ky.
    const validator = validateRequest(RequestSchema);
    const result = validator({ taskIds: 123 });
    expect(result.isErr()).toBe(true);
    // ky mock should not have been called by validateRequest itself
    expect(kyMock.fn).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// logNonHttpErrors()
// ---------------------------------------------------------------------------

describe('validation: logNonHttpErrors', () => {
  // Spec: validation.md "logNonHttpErrors"
  // - HttpError: do NOT log
  // - NetworkError: console.error
  // - ValidationError: console.error (with summary, status if !== null)
  // - UnhandledStatusError: console.error (with status and data)
  // - UnexpectedError: console.error (with original error)
  // - returns void, does not change error value

  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('does NOT log for HttpError variant', () => {
    const err = createHttpError(404, { detail: 'nf' });
    logNonHttpErrors(err);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('logs NetworkError via console.error', () => {
    const err = { _type: 'NetworkError' as const, error: new Error('dns failure') };
    logNonHttpErrors(err);
    expect(errorSpy).toHaveBeenCalled();
    // Spec: logs the network problem - verify error message is included
    const loggedArgs = errorSpy.mock.calls[0].join(' ');
    expect(loggedArgs).toContain('dns failure');
  });

  it('logs ValidationError with summary via console.error', () => {
    const err = {
      _type: 'ValidationError' as const,
      status: null,
      summary: 'schema mismatch occurred',
      issues: null,
    };
    logNonHttpErrors(err);
    expect(errorSpy).toHaveBeenCalled();
    // Spec: logs summary
    const loggedArgs = errorSpy.mock.calls[0].join(' ');
    expect(loggedArgs).toContain('schema mismatch occurred');
  });

  it('logs ValidationError with status when status !== null', () => {
    const err = {
      _type: 'ValidationError' as const,
      status: 422,
      summary: 'mismatch at 422',
      issues: null,
    };
    logNonHttpErrors(err);
    expect(errorSpy).toHaveBeenCalled();
    // Spec: logs status when !== null
    const loggedArgs = errorSpy.mock.calls[0].join(' ');
    expect(loggedArgs).toContain('422');
  });

  it('logs UnhandledStatusError with status and data', () => {
    const err = {
      _type: 'UnhandledStatusError' as const,
      status: 500,
      data: 'server crashed',
    };
    logNonHttpErrors(err);
    expect(errorSpy).toHaveBeenCalled();
    // Spec: logs status and data
    const loggedArgs = errorSpy.mock.calls[0].join(' ');
    expect(loggedArgs).toContain('500');
    expect(loggedArgs).toContain('server crashed');
  });

  it('logs UnexpectedError with original error', () => {
    const err = { _type: 'UnexpectedError' as const, error: 'unexpected boom' };
    logNonHttpErrors(err);
    expect(errorSpy).toHaveBeenCalled();
    // Spec: logs original error
    const loggedArgs = errorSpy.mock.calls[0].join(' ');
    expect(loggedArgs).toContain('unexpected boom');
  });

  it('returns void', () => {
    const err = { _type: 'NetworkError' as const, error: new Error('x') };
    const result = logNonHttpErrors(err);
    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// fetchAndValidate() - form 4
// ---------------------------------------------------------------------------

describe('validation: fetchAndValidate (form 4)', () => {
  // Spec: validation.md "form 4: full composition convenience" & invariants 12

  it('returns ok(Success) for 2xx with valid body', async () => {
    kyMock.fn.mockResolvedValueOnce(
      new Response(JSON.stringify({ task_id: 't1', status: 'pending' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const result = await fetchAndValidate('tasks', {
      success: SuccessSchema,
    });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.taskId).toBe('t1');
      expect(result.value.status).toBe('pending');
    }
  });

  it('returns err(UnhandledStatusError) for non-2xx with no failures (invariant 12)', async () => {
    const httpErr = new kyMock.HTTPError(
      new Response(JSON.stringify({ detail: 'error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }),
      new Request('http://test'),
      {},
    );
    httpErr.data = { detail: 'error' };
    kyMock.fn.mockRejectedValueOnce(httpErr);
    const result = await fetchAndValidate('tasks', {
      success: SuccessSchema,
    });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(isUnhandledStatusError(result.error)).toBe(true);
    }
  });

  it('returns err(HttpError) for non-2xx with matching failure schema', async () => {
    const httpErr = new kyMock.HTTPError(
      new Response(JSON.stringify({ detail: 'bad request' }), {
        status: 422,
        headers: { 'Content-Type': 'application/json' },
      }),
      new Request('http://test'),
      {},
    );
    httpErr.data = { detail: 'bad request' };
    kyMock.fn.mockRejectedValueOnce(httpErr);
    const result = await fetchAndValidate('tasks', {
      success: SuccessSchema,
      failures: { 422: SchemaA },
    });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(isHttpError(result.error)).toBe(true);
      expect((result.error as { status: number }).status).toBe(422);
    }
  });

  it('returns err(NetworkError) for network failure', async () => {
    const netErr = new kyMock.NetworkError('fetch failed', {
      cause: new Error('dns'),
    });
    kyMock.fn.mockRejectedValueOnce(netErr);
    const result = await fetchAndValidate('tasks', {
      success: SuccessSchema,
    });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(isNetworkError(result.error)).toBe(true);
    }
  });

  it('passes url and options to ky', async () => {
    kyMock.fn.mockResolvedValueOnce(
      new Response(JSON.stringify({ task_id: 't1', status: 'pending' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    await fetchAndValidate('tasks', { success: SuccessSchema }, { method: 'POST' });
    expect(kyMock.fn).toHaveBeenCalledWith(
      'tasks',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  // Spec: validation.md line 177 - fetchAndValidate uses parseJson internally.
  // If the 2xx response body is not valid JSON, parseJson fails with
  // ValidationError (status=null, "Response body is not valid JSON").
  it('returns err(ValidationError) when 2xx body is not valid JSON', async () => {
    kyMock.fn.mockResolvedValueOnce(
      new Response('not json at all', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      }),
    );
    const result = await fetchAndValidate('tasks', {
      success: SuccessSchema,
    });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(isValidationError(result.error)).toBe(true);
      expect((result.error as { status: number | null }).status).toBeNull();
      expect((result.error as { summary: string }).summary).toContain('JSON');
    }
  });
});

// ---------------------------------------------------------------------------
// fetchBinaryAndValidate() - form 5
// ---------------------------------------------------------------------------

describe('validation: fetchBinaryAndValidate (form 5)', () => {
  // Spec: validation.md "form 5: binary endpoint convenience" & invariants 14-15

  it('returns ok(BlobResult) for 2xx with blob (invariant 14)', async () => {
    const blob = new Blob(['zip content'], { type: 'application/zip' });
    kyMock.fn.mockResolvedValueOnce(
      new Response(blob, {
        status: 200,
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': 'attachment; filename="results.zip"',
        },
      }),
    );
    const result = await fetchBinaryAndValidate('tasks/result-zip', {
      failures: { 409: SchemaNonDownloadable },
    });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      // blob variant returns BlobResult
      const val = result.value as { blob: Blob; status: number; headers: Headers };
      expect(val.blob.size).toBe(11);
      expect(val.status).toBe(200);
      expect(val.headers.get('content-disposition')).toContain(
        'filename="results.zip"',
      );
    }
  });

  it('returns ok(ArrayBuffer) for 2xx with binary=arrayBuffer (invariant 15)', async () => {
    const buf = new Uint8Array([1, 2, 3, 4]).buffer;
    kyMock.fn.mockResolvedValueOnce(
      new Response(buf, {
        status: 200,
        headers: { 'Content-Type': 'application/zip' },
      }),
    );
    const result = await fetchBinaryAndValidate('tasks/result-zip', {
      binary: 'arrayBuffer',
    });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      // arrayBuffer variant returns ArrayBuffer, NOT BlobResult
      const val = result.value;
      expect(val).toBeInstanceOf(ArrayBuffer);
      expect((val as ArrayBuffer).byteLength).toBe(4);
    }
  });

  it('returns err(HttpError<409>) for 409 without triggering parseBlob (invariant 14)', async () => {
    // Spec: validation.md invariants 10 & 14 - on 409, parseBlob must NOT
    // be triggered. The error branch short-circuits before andThen(parseBlob).
    // We verify by spying on the real Response's body methods — if the
    // implementation incorrectly reads error.response.json/blob() instead of
    // using error.data, the spies will record the call.
    const response = new Response(
      JSON.stringify({
        detail: 'not available',
        non_downloadable: [
          { task_id: 't1', status: 'failed', reason: 'not_completed' },
        ],
      }),
      { status: 409, headers: { 'Content-Type': 'application/json' } },
    );
    const blobSpy = vi.spyOn(response, 'blob');
    const jsonSpy = vi.spyOn(response, 'json');
    const textSpy = vi.spyOn(response, 'text');
    const arrayBufferSpy = vi.spyOn(response, 'arrayBuffer');

    const httpErr = new kyMock.HTTPError(response, new Request('http://test'), {});
    httpErr.data = {
      detail: 'not available',
      non_downloadable: [
        { task_id: 't1', status: 'failed', reason: 'not_completed' },
      ],
    };
    kyMock.fn.mockRejectedValueOnce(httpErr);
    const result = await fetchBinaryAndValidate('tasks/result-zip', {
      failures: { 409: SchemaNonDownloadable },
    });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(isHttpError(result.error)).toBe(true);
      expect((result.error as { status: number }).status).toBe(409);
      const data = (result.error as { data: unknown }).data as {
        nonDownloadable: { taskId: string }[];
      };
      expect(data.nonDownloadable[0].taskId).toBe('t1');
    }
    // Critical assertion: blob() must NOT have been called on the 409 path
    expect(blobSpy).not.toHaveBeenCalled();
    blobSpy.mockRestore();
    jsonSpy.mockRestore();
    textSpy.mockRestore();
    arrayBufferSpy.mockRestore();
  });

  it('returns err(HttpError) via fallbackFailure for unhandled status (invariant)', async () => {
    // Spec: validation.md form 5 - fallbackFailure covers unlisted status codes
    const httpErr = new kyMock.HTTPError(
      new Response(JSON.stringify({ detail: 'server error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }),
      new Request('http://test'),
      {},
    );
    httpErr.data = { detail: 'server error' };
    kyMock.fn.mockRejectedValueOnce(httpErr);
    const result = await fetchBinaryAndValidate('tasks/result-zip', {
      failures: { 409: SchemaNonDownloadable },
      fallbackFailure: SchemaA,
    });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(isHttpError(result.error)).toBe(true);
      expect((result.error as { status: number }).status).toBe(500);
      expect((result.error as { data: { detail: string } }).data.detail).toBe(
        'server error',
      );
    }
  });

  it('returns err(UnhandledStatusError) for unhandled status code', async () => {
    const httpErr = new kyMock.HTTPError(
      new Response(JSON.stringify({ detail: 'server error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }),
      new Request('http://test'),
      {},
    );
    httpErr.data = { detail: 'server error' };
    kyMock.fn.mockRejectedValueOnce(httpErr);
    const result = await fetchBinaryAndValidate('tasks/result-zip', {
      failures: { 409: SchemaNonDownloadable },
    });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(isUnhandledStatusError(result.error)).toBe(true);
    }
  });

  it('returns err(NetworkError) for network failure', async () => {
    const netErr = new kyMock.NetworkError('fetch failed', {
      cause: new Error('dns'),
    });
    kyMock.fn.mockRejectedValueOnce(netErr);
    const result = await fetchBinaryAndValidate('tasks/result-zip', {});
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(isNetworkError(result.error)).toBe(true);
    }
  });

  it('default binary is blob (not arrayBuffer)', async () => {
    kyMock.fn.mockResolvedValueOnce(
      new Response(new Blob(['data']), {
        status: 200,
        headers: { 'Content-Type': 'application/octet-stream' },
      }),
    );
    const result = await fetchBinaryAndValidate('tasks/result-zip', {});
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      // Default should be BlobResult, not ArrayBuffer
      const val = result.value as { blob: Blob };
      expect(val.blob).toBeDefined();
    }
  });
});
