import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Type } from 'arktype';
import { type } from 'arktype';

// Spec: frontend/specs/core/http-client.md
//
// This file tests the HTTP client layer contract: RawResponse, request(),
// and the four composable parsers (parseJson, parseBlob, parseArrayBuffer,
// passthrough).

// ---------------------------------------------------------------------------
// ky mock
// ---------------------------------------------------------------------------
// The implementation imports ky and creates a pre-configured instance via
// ky.extend(...). We mock the ky module so that:
//   - default export is a vi.fn() (the ky instance, callable as ky(url, opts))
//   - ky.extend() returns itself (so instance = ky.extend(...) = mockKy)
//   - HTTPError / NetworkError / TimeoutError are real classes the impl can
//     import and use with instanceof / is* checks
//
// The mock factory is shared with validation.test.ts via ky-mock.ts.

vi.mock('ky', async () => {
  const { createKyMock } = await import('./ky-mock');
  return createKyMock();
});

// ---------------------------------------------------------------------------
// Imports (after mock setup)
// ---------------------------------------------------------------------------

import ky from 'ky';
import { HTTPError, NetworkError, TimeoutError } from './ky-mock';
import type { MockKy } from './ky-mock';

const m = ky as unknown as MockKy;

import {
  request,
  parseJson,
  parseBlob,
  parseArrayBuffer,
  passthrough,
  type RawResponse,
  type BlobResult,
} from '../../src/core/http-client';
import { isHttpError, isNetworkError, isUnexpectedError } from '../../src/core/error-model';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a mock RawResponse without needing ky. Used for parser tests. */
function mockRawResponse(opts: {
  status?: number;
  headers?: Record<string, string> | Headers;
  bodyJson?: unknown;
  bodyText?: string;
  bodyBlob?: Blob;
  bodyArrayBuffer?: ArrayBuffer;
  jsonThrows?: boolean;
}): RawResponse {
  const headers =
    opts.headers instanceof Headers ? opts.headers : new Headers(opts.headers ?? {});
  const status = opts.status ?? 200;
  return {
    status,
    headers,
    reader: {
      json: opts.jsonThrows
        ? () => Promise.reject(new SyntaxError('Unexpected token'))
        : () => Promise.resolve(opts.bodyJson ?? null),
      text: () => Promise.resolve(opts.bodyText ?? ''),
      blob: () => Promise.resolve(opts.bodyBlob ?? new Blob()),
      arrayBuffer: () => Promise.resolve(opts.bodyArrayBuffer ?? new ArrayBuffer(0)),
    },
  };
}

/** Build a Response for ky mock (success case). */
function mockResponse(body: string, opts: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(body, {
    status: opts.status ?? 200,
    headers: opts.headers ?? { 'Content-Type': 'application/json' },
  });
}

/** Build a ky HTTPError with pre-parsed data. */
function makeHttpError(status: number, data: unknown): InstanceType<typeof HTTPError> {
  const resp = new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
  const err = new HTTPError(resp, new Request('http://test'), {});
  err.data = data;
  return err;
}

beforeEach(() => {
  m.mockReset();
});

// ---------------------------------------------------------------------------
// Parser tests (no ky mock needed)
// ---------------------------------------------------------------------------

describe('http-client: parseJson', () => {
  // Spec: http-client.md "JSON parser"
  // - calls response.reader.json()
  // - success: ok(parsed), parsed type is unknown
  // - throws (body not valid JSON): err(ValidationError, status=null,
  //   summary='Response body is not valid JSON', issues=null)

  it('returns ok(parsed) when body is valid JSON', async () => {
    const resp = mockRawResponse({ bodyJson: { foo: 'bar' } });
    const result = await parseJson(resp);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual({ foo: 'bar' });
    }
  });

  it('returns ok for JSON arrays', async () => {
    const resp = mockRawResponse({ bodyJson: [1, 2, 3] });
    const result = await parseJson(resp);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual([1, 2, 3]);
    }
  });

  it('returns ok for JSON primitives', async () => {
    const resp = mockRawResponse({ bodyJson: 42 });
    const result = await parseJson(resp);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBe(42);
    }
  });

  it('returns err(ValidationError) when body is not valid JSON', async () => {
    const resp = mockRawResponse({ jsonThrows: true });
    const result = await parseJson(resp);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error._type).toBe('ValidationError');
      expect((result.error as { status: number | null }).status).toBeNull();
      expect((result.error as { summary: string }).summary).toBe(
        'Response body is not valid JSON',
      );
      expect((result.error as { issues: unknown }).issues).toBeNull();
    }
  });

  // Spec: conventions.md invariant 5 - parseJson does NOT do key conversion.
  // It returns unknown (raw snake_case JSON.parsed value). Conversion is done
  // by schema morph in validateSuccess/validateFailure.
  it('does NOT convert snake_case keys to camelCase (invariant 5)', async () => {
    const resp = mockRawResponse({
      bodyJson: { task_id: 't1', file_names: ['a', 'b'] },
    });
    const result = await parseJson(resp);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const val = result.value as Record<string, unknown>;
      // Keys must remain snake_case (not converted to camelCase)
      expect(val).toHaveProperty('task_id');
      expect(val).toHaveProperty('file_names');
      expect(val).not.toHaveProperty('taskId');
      expect(val).not.toHaveProperty('fileNames');
    }
  });
});

describe('http-client: parseBlob', () => {
  // Spec: http-client.md "Blob parser"
  // - calls response.reader.blob()
  // - success: ok({ blob, status: response.status, headers: response.headers })
  // - must preserve headers (for Content-Disposition filename)
  // - blob read generally does not throw; if it throws, UnexpectedError

  it('returns ok(BlobResult) with blob, status, and headers', async () => {
    const blob = new Blob(['zip content'], { type: 'application/zip' });
    const headers = { 'Content-Disposition': 'attachment; filename="results.zip"' };
    const resp = mockRawResponse({
      status: 200,
      headers,
      bodyBlob: blob,
    });
    const result = await parseBlob(resp);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const val: BlobResult = result.value;
      expect(val.blob).toBe(blob);
      expect(val.status).toBe(200);
      expect(val.headers.get('content-disposition')).toBe(
        'attachment; filename="results.zip"',
      );
    }
  });

  it('headers field equals RawResponse.headers (invariant 9)', async () => {
    const resp = mockRawResponse({
      status: 200,
      headers: { 'X-Custom': 'val' },
      bodyBlob: new Blob(),
    });
    const result = await parseBlob(resp);
    if (result.isOk()) {
      expect(result.value.headers).toBe(resp.headers);
    }
  });
});

describe('http-client: parseArrayBuffer', () => {
  // Spec: http-client.md "ArrayBuffer parser"
  // - behavior same as Blob, but returns ArrayBuffer
  // - used for in-memory byte handling (e.g., ZIP parsing)

  it('returns ok(ArrayBuffer) with the raw bytes', async () => {
    const buf = new Uint8Array([1, 2, 3, 4]).buffer;
    const resp = mockRawResponse({
      status: 200,
      bodyArrayBuffer: buf,
    });
    const result = await parseArrayBuffer(resp);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBe(buf);
    }
  });
});

describe('http-client: passthrough', () => {
  // Spec: http-client.md "Passthrough parser"
  // - does NOT read body, directly ok(response)
  // - used for /file_parse etc. where upstream shape is arbitrary

  it('returns ok(RawResponse) without reading body', () => {
    const resp = mockRawResponse({ bodyJson: { any: 'thing' } });
    const result = passthrough(resp);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBe(resp);
    }
  });

  it('does not call any reader method (invariant 10)', () => {
    const jsonFn = vi.fn(() => Promise.resolve(null));
    const textFn = vi.fn(() => Promise.resolve(''));
    const blobFn = vi.fn(() => Promise.resolve(new Blob()));
    const abFn = vi.fn(() => Promise.resolve(new ArrayBuffer(0)));
    const resp: RawResponse = {
      status: 200,
      headers: new Headers(),
      reader: {
        json: jsonFn,
        text: textFn,
        blob: blobFn,
        arrayBuffer: abFn,
      },
    };
    passthrough(resp);
    expect(jsonFn).not.toHaveBeenCalled();
    expect(textFn).not.toHaveBeenCalled();
    expect(blobFn).not.toHaveBeenCalled();
    expect(abFn).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// request() tests (ky mock)
// ---------------------------------------------------------------------------

describe('http-client: request() success path', () => {
  // Spec: http-client.md invariant 1
  // - success returns ok(RawResponse)
  // - RawResponse.status is 2xx
  // - RawResponse.headers is Headers instance
  // - RawResponse.reader has json/text/blob/arrayBuffer

  it('returns ok(RawResponse) with 2xx status', async () => {
    m.mockResolvedValueOnce(
      mockResponse(JSON.stringify({ task_id: 't1' }), {
        status: 202,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const result = await request('tasks', { method: 'POST' });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.status).toBe(202);
      expect(result.value.headers).toBeInstanceOf(Headers);
      expect(typeof result.value.reader.json).toBe('function');
      expect(typeof result.value.reader.text).toBe('function');
      expect(typeof result.value.reader.blob).toBe('function');
      expect(typeof result.value.reader.arrayBuffer).toBe('function');
    }
  });

  it('passes url and options to ky', async () => {
    m.mockResolvedValueOnce(mockResponse('{}'));
    await request('auth/jwt/login', { method: 'POST', json: { user: 'x' } });
    expect(m).toHaveBeenCalledWith(
      'auth/jwt/login',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('url is relative path (invariant 8)', async () => {
    m.mockResolvedValueOnce(mockResponse('{}'));
    await request('tasks');
    const calledUrl = m.mock.calls[0][0];
    expect(calledUrl).not.toMatch(/^https?:\/\//);
    expect(calledUrl).toBe('tasks');
  });
});

describe('http-client: request() HTTP error path', () => {
  // Spec: http-client.md invariant 2 & behavior assertion 3
  // - 4xx/5xx with throwHttpErrors:true -> err(HttpError<status, data>)
  // - data is ky pre-parsed body (JSON parsed, empty=undefined)

  it('returns err(HttpError) with status and parsed JSON data', async () => {
    const httpErr = makeHttpError(404, { detail: 'Not found' });
    m.mockRejectedValueOnce(httpErr);
    const result = await request('tasks/t1');
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(isHttpError(result.error)).toBe(true);
      expect((result.error as { status: number }).status).toBe(404);
      expect((result.error as { data: unknown }).data).toEqual({ detail: 'Not found' });
    }
  });

  it('returns err(HttpError) with undefined data for empty body', async () => {
    const resp = new Response(null, { status: 204 });
    const httpErr = new HTTPError(resp, new Request('http://test'), {});
    httpErr.data = undefined;
    m.mockRejectedValueOnce(httpErr);
    const result = await request('tasks/t1');
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect((result.error as { data: unknown }).data).toBeUndefined();
    }
  });

  it('returns err(HttpError) with string data for non-JSON body', async () => {
    const resp = new Response('plain text', {
      status: 500,
      headers: { 'Content-Type': 'text/plain' },
    });
    const httpErr = new HTTPError(resp, new Request('http://test'), {});
    httpErr.data = 'plain text';
    m.mockRejectedValueOnce(httpErr);
    const result = await request('tasks/t1');
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect((result.error as { data: unknown }).data).toBe('plain text');
    }
  });
});

describe('http-client: request() network/timeout/abort errors', () => {
  // Spec: http-client.md invariant 3 & 4, behavior assertions 4-6
  // - NetworkError -> err(NetworkError, error = error.cause ?? new Error(...))
  // - TimeoutError -> err(NetworkError, error = error)
  // - DOMException (AbortError) -> err(NetworkError, error = error)
  // - error must be Error instance

  it('returns err(NetworkError) for ky NetworkError', async () => {
    const cause = new Error('DNS failure');
    const netErr = new NetworkError('fetch failed', { cause });
    m.mockRejectedValueOnce(netErr);
    const result = await request('tasks');
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(isNetworkError(result.error)).toBe(true);
      expect((result.error as { error: Error }).error).toBe(cause);
    }
  });

  it('returns err(NetworkError) with fallback Error when cause is missing', async () => {
    const netErr = new NetworkError('fetch failed');
    m.mockRejectedValueOnce(netErr);
    const result = await request('tasks');
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(isNetworkError(result.error)).toBe(true);
      const err = (result.error as { error: Error }).error;
      expect(err).toBeInstanceOf(Error);
    }
  });

  it('returns err(NetworkError) for ky TimeoutError', async () => {
    const timeoutErr = new TimeoutError(new Request('http://test'));
    m.mockRejectedValueOnce(timeoutErr);
    const result = await request('tasks');
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(isNetworkError(result.error)).toBe(true);
      expect((result.error as { error: Error }).error).toBe(timeoutErr);
    }
  });

  it('returns err(NetworkError) for DOMException AbortError', async () => {
    const abortErr = new DOMException('The operation was aborted', 'AbortError');
    m.mockRejectedValueOnce(abortErr);
    const result = await request('tasks');
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(isNetworkError(result.error)).toBe(true);
      const err = (result.error as { error: Error }).error;
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe('AbortError');
    }
  });

  it('options.signal aborted produces NetworkError with AbortError name', async () => {
    const controller = new AbortController();
    controller.abort();
    const abortErr = new DOMException('The operation was aborted', 'AbortError');
    m.mockRejectedValueOnce(abortErr);
    const result = await request('tasks', { signal: controller.signal });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(isNetworkError(result.error)).toBe(true);
      expect((result.error as { error: Error }).error.name).toBe('AbortError');
    }
  });
});

describe('http-client: request() unexpected errors', () => {
  // Spec: http-client.md behavior assertion 7
  // - any other thrown value -> err(UnexpectedError, error = thrown)

  it('returns err(UnexpectedError) for non-ky Error', async () => {
    const thrown = new Error('something weird');
    m.mockRejectedValueOnce(thrown);
    const result = await request('tasks');
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(isUnexpectedError(result.error)).toBe(true);
      expect((result.error as { error: unknown }).error).toBe(thrown);
    }
  });

  it('returns err(UnexpectedError) for non-Error thrown value', async () => {
    m.mockRejectedValueOnce('string error');
    const result = await request('tasks');
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(isUnexpectedError(result.error)).toBe(true);
      expect((result.error as { error: unknown }).error).toBe('string error');
    }
  });

  it('returns err(UnexpectedError) for null thrown', async () => {
    m.mockRejectedValueOnce(null);
    const result = await request('tasks');
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(isUnexpectedError(result.error)).toBe(true);
    }
  });
});

describe('http-client: request() header accessibility', () => {
  // Spec: http-client.md invariant 5 & 6, behavior assertion 9
  // - RawResponse.headers must expose X-MinerU-Task-* and Content-Disposition

  it('exposes X-MinerU-Task-* headers on POST /tasks success (invariant 5)', async () => {
    m.mockResolvedValueOnce(
      mockResponse(JSON.stringify({ task_id: 't1' }), {
        status: 202,
        headers: {
          'Content-Type': 'application/json',
          'X-MinerU-Task-Id': 't1',
          'X-MinerU-Task-Status': 'pending',
          'X-MinerU-Task-Status-Url': 'http://gw/tasks/t1',
          'X-MinerU-Task-Result-Url': 'http://gw/tasks/t1/result',
        },
      }),
    );
    const result = await request('tasks', { method: 'POST' });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.headers.get('x-mineru-task-id')).toBe('t1');
      expect(result.value.headers.get('x-mineru-task-status')).toBe('pending');
      expect(result.value.headers.get('x-mineru-task-status-url')).toBe('http://gw/tasks/t1');
      expect(result.value.headers.get('x-mineru-task-result-url')).toBe(
        'http://gw/tasks/t1/result',
      );
    }
  });

  it('exposes Content-Disposition on POST /tasks/result-zip success (invariant 6)', async () => {
    m.mockResolvedValueOnce(
      new Response(new Blob(['zip']), {
        status: 200,
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': 'attachment; filename="results.zip"',
        },
      }),
    );
    const result = await request('tasks/result-zip', { method: 'POST' });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const cd = result.value.headers.get('content-disposition');
      expect(cd).toContain('filename="results.zip"');
    }
  });

  it('exposes X-Idempotency-Key-Replayed header on replay', async () => {
    m.mockResolvedValueOnce(
      mockResponse(JSON.stringify({ task_id: 't1' }), {
        status: 202,
        headers: {
          'X-MinerU-Task-Id': 't1',
          'X-Idempotency-Key-Replayed': 'true',
        },
      }),
    );
    const result = await request('tasks', {
      method: 'POST',
      headers: { 'X-Idempotency-Key': 'key-123' },
    });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.headers.get('x-idempotency-key-replayed')).toBe('true');
    }
  });
});

describe('http-client: request() throwHttpErrors requirement', () => {
  // Spec: http-client.md behavior assertion 10
  // - throwHttpErrors: true is a HARD requirement
  // - caller must NOT configure throwHttpErrors: false
  // - the implementation must enforce this (override caller's false)

  it('enforces throwHttpErrors: true even when caller passes false', async () => {
    m.mockResolvedValueOnce(mockResponse('{}'));
    // Caller tries to disable throwHttpErrors — impl must override to true
    await request('tasks', { method: 'POST', throwHttpErrors: false });
    const callOpts = m.mock.calls[0][1];
    // The implementation must force throwHttpErrors to true (or remove the
    // caller's false), never pass false to ky.
    expect(callOpts?.throwHttpErrors).not.toBe(false);
  });

  it('does not pass throwHttpErrors: false when caller omits it', async () => {
    m.mockResolvedValueOnce(mockResponse('{}'));
    await request('tasks', { method: 'POST' });
    const callOpts = m.mock.calls[0][1];
    expect(callOpts?.throwHttpErrors).not.toBe(false);
  });
});

describe('http-client: ky instance configuration', () => {
  // Spec: http-client.md "ky instance configuration contract" & invariant 7
  // - ky instance created via ky.extend(...)
  // - hooks.beforeRequest / hooks.afterResponse configurable at creation time
  // - hook points reachable (called by ky internally during request lifecycle)
  //
  // Tests trigger a request before checking extend calls so that the
  // assertions are resilient to lazy-initialization strategies.

  it('ky.extend is called to create the pre-configured instance', async () => {
    // Spec invariant 7: the ky instance is created via ky.extend().
    // Trigger a request first to accommodate lazy init.
    m.mockResolvedValueOnce(mockResponse('{}'));
    await request('tasks');
    expect(m.extend).toHaveBeenCalled();
  });

  it('prefix is configured from VITE_API_PREFIX env var', async () => {
    // Spec: http-client.md "prefix" section
    // - prefix read from import.meta.env.VITE_API_PREFIX, default ''
    // The extend call should include a prefix option.
    m.mockResolvedValueOnce(mockResponse('{}'));
    await request('tasks');
    const extendCalls = m.extend.mock.calls;
    // At least one extend call should have a prefix in its options
    const hasPrefix = extendCalls.some((call) => {
      const opts = call[0];
      return typeof opts === 'object' && opts !== null && 'prefix' in opts;
    });
    expect(hasPrefix).toBe(true);
  });

  it('beforeRequest hook is configurable and reachable during request', async () => {
    // Spec: http-client.md "hooks.beforeRequest" & invariant 7
    m.mockResolvedValueOnce(mockResponse('{}'));
    await request('tasks');
    const extendCalls = m.extend.mock.calls;
    const hasBeforeRequest = extendCalls.some((call) => {
      const opts = call[0];
      return (
        typeof opts === 'object' &&
        opts !== null &&
        'hooks' in opts &&
        Array.isArray((opts as { hooks: { beforeRequest?: unknown[] } }).hooks?.beforeRequest)
      );
    });
    expect(hasBeforeRequest).toBe(true);
  });

  it('afterResponse hook is configurable and reachable during request', async () => {
    // Spec: http-client.md "hooks.afterResponse" & invariant 7
    m.mockResolvedValueOnce(mockResponse('{}'));
    await request('tasks');
    const extendCalls = m.extend.mock.calls;
    const hasAfterResponse = extendCalls.some((call) => {
      const opts = call[0];
      return (
        typeof opts === 'object' &&
        opts !== null &&
        'hooks' in opts &&
        Array.isArray((opts as { hooks: { afterResponse?: unknown[] } }).hooks?.afterResponse)
      );
    });
    expect(hasAfterResponse).toBe(true);
  });

  // Spec: http-client.md "ky instance configuration contract"
  // The ky instance is a singleton created once and reused across requests.
  // Hook-based state (future auth header injection, 401 retry) must be
  // shared across all requests, which requires a single instance.
  it('reuses the same ky instance across multiple requests', async () => {
    m.mockResolvedValueOnce(mockResponse('{}'));
    await request('a');

    const extendCallsAfterFirst = m.extend.mock.calls.length;

    m.mockResolvedValueOnce(mockResponse('{}'));
    await request('b');

    expect(m.extend.mock.calls.length).toBe(extendCallsAfterFirst);
  });
});
