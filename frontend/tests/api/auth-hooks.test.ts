/**
 * @file Auth hook tests for the HTTP client.
 *
 * These tests verify the beforeRequest and afterResponse ky hooks that
 * handle automatic JWT token injection and transparent 401 -> refresh -> retry.
 *
 * The hooks are factory functions taking minimal token-access interfaces,
 * making them testable without real ky or a running gateway.
 *
 * ## Hooks under test
 *
 * ### `createAuthBeforeRequest(getToken)`
 *
 * Creates a ky `beforeRequest` hook.  Expected behaviour:
 *
 * - When `getToken()` returns a non-null token, the hook returns a new
 *   `Request` with `Authorization: Bearer <token>` appended.  Existing
 *   headers, method, and URL are preserved.
 * - When `getToken()` returns `null`, the hook returns `undefined` -
 *   the original request is sent unchanged.
 *
 * ### `createAuthAfterResponse(refresh, retryFn)`
 *
 * Creates a ky `afterResponse` hook.  Expected behaviour:
 *
 * - **Non-401 responses** are passed through unchanged (returns `undefined`).
 * - **POST /auth/jwt/refresh** receives a 401 -> passed through without
 *   retrying (prevents infinite refresh loops).
 * - **`retryCount > 0`** -> 401 is passed through - each request gets at
 *   most one automatic retry.
 * - **First 401 on any other endpoint**: calls `refresh()`.  On success,
 *   returns a retry marker (via `retryFn`) carrying a new `Request` with
 *   the updated `Authorization` header.  On failure (`refresh()` returns
 *   `null`), the original 401 is passed through.
 * - **Concurrent 401s from multiple requests**: the hook deduplicates
 *   `refresh()` calls.  The first caller triggers the refresh; subsequent
 *   callers wait on the same promise.  All callers retry with the same
 *   new token on success, or all pass through the 401 on failure.
 *
 * ## Test strategy
 *
 * - `createAuthBeforeRequest`: pure function of `(state, token)` - tested
 *   with real `Request` objects and `vi.fn()` for `getToken`.
 * - `createAuthAfterResponse`: factory that closes over a shared
 *   `refreshPromise` for dedup.  Each test creates a fresh hook instance.
 *   `refresh` and `retryFn` are vi mocks; requests/responses use built-in
 *   fetch primitives.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAuthBeforeRequest, createAuthAfterResponse } from '../../src/core/http-client';

function makeRequest(opts?: {
  headers?: Record<string, string>;
  method?: string;
  url?: string;
}): Request {
  return new Request(opts?.url ?? 'https://example.com/api/tasks', {
    method: opts?.method ?? 'GET',
    headers: opts?.headers,
  });
}

// ================================================================
// createAuthBeforeRequest
// ================================================================

describe('createAuthBeforeRequest', () => {
  describe('when access token is available', () => {
    it('injects Authorization: Bearer header with the token', () => {
      const getToken = vi.fn(() => 'access-token-123');
      const hook = createAuthBeforeRequest(getToken);

      const result = hook({ request: makeRequest() });

      expect(result).toBeInstanceOf(Request);
      expect((result as Request).headers.get('Authorization')).toBe(
        'Bearer access-token-123',
      );
    });

    it('preserves existing request headers', () => {
      const getToken = vi.fn(() => 'tok');
      const hook = createAuthBeforeRequest(getToken);

      const result = hook({
        request: makeRequest({
          headers: { 'X-Custom': 'val', 'Content-Type': 'application/json' },
        }),
      });

      const req = result as Request;
      expect(req.headers.get('X-Custom')).toBe('val');
      expect(req.headers.get('Content-Type')).toBe('application/json');
      expect(req.headers.get('Authorization')).toBe('Bearer tok');
    });

    it('preserves request method and URL', () => {
      const getToken = vi.fn(() => 'tok');
      const hook = createAuthBeforeRequest(getToken);

      const result = hook({
        request: makeRequest({
          method: 'POST',
          url: 'https://example.com/api/tasks',
        }),
      });

      const req = result as Request;
      expect(req.method).toBe('POST');
      expect(req.url).toBe('https://example.com/api/tasks');
    });

    it('overwrites an existing Authorization header', () => {
      const getToken = vi.fn(() => 'new-token');
      const hook = createAuthBeforeRequest(getToken);

      const result = hook({
        request: makeRequest({
          headers: { Authorization: 'Bearer old-token' },
        }),
      });

      expect((result as Request).headers.get('Authorization')).toBe(
        'Bearer new-token',
      );
    });
  });

  describe('when access token is null', () => {
    it('returns undefined leaving request unchanged', () => {
      const getToken = vi.fn(() => null);
      const hook = createAuthBeforeRequest(getToken);

      const result = hook({ request: makeRequest() });

      expect(result).toBeUndefined();
    });
  });
});

// ================================================================
// createAuthAfterResponse
// ================================================================

describe('createAuthAfterResponse', () => {
  let retryFn: ReturnType<typeof vi.fn<(req: Request) => unknown>>;

  beforeEach(() => {
    retryFn = vi.fn<(req: Request) => unknown>((req: Request) => ({ _retryMarker: true, request: req }));
  });

  function afterState(opts: {
    status: number;
    retryCount?: number;
    url?: string;
    headers?: Record<string, string>;
  }) {
    return {
      request: makeRequest({
        url: opts.url ?? 'https://example.com/api/tasks',
        headers: opts.headers,
      }),
      response: { status: opts.status },
      retryCount: opts.retryCount ?? 0,
    };
  }

  describe('non-401 responses', () => {
    it('passes through 200 responses', async () => {
      const refresh = vi.fn();
      const hook = createAuthAfterResponse(
        refresh,
        retryFn,
      );

      const result = await hook(afterState({ status: 200 }));

      expect(result).toBeUndefined();
      expect(refresh).not.toHaveBeenCalled();
      expect(retryFn).not.toHaveBeenCalled();
    });

    it('passes through 403 responses', async () => {
      const refresh = vi.fn();
      const hook = createAuthAfterResponse(
        refresh,
        retryFn,
      );

      const result = await hook(afterState({ status: 403 }));

      expect(result).toBeUndefined();
      expect(refresh).not.toHaveBeenCalled();
    });

    it('passes through 500 responses', async () => {
      const refresh = vi.fn();
      const hook = createAuthAfterResponse(
        refresh,
        retryFn,
      );

      const result = await hook(afterState({ status: 500 }));

      expect(result).toBeUndefined();
      expect(refresh).not.toHaveBeenCalled();
    });
  });

  describe('refresh endpoint recursion guard', () => {
    it('passes through 401 on /auth/jwt/refresh without retrying', async () => {
      const refresh = vi.fn();
      const hook = createAuthAfterResponse(
        refresh,
        retryFn,
      );

      const result = await hook(
        afterState({
          status: 401,
          url: 'https://example.com/auth/jwt/refresh',
        }),
      );

      expect(result).toBeUndefined();
      expect(refresh).not.toHaveBeenCalled();
      expect(retryFn).not.toHaveBeenCalled();
    });
  });

  describe('retryCount guard', () => {
    it('passes through 401 when retryCount > 0 (already retried)', async () => {
      const refresh = vi.fn();
      const hook = createAuthAfterResponse(
        refresh,
        retryFn,
      );

      const result = await hook(afterState({ status: 401, retryCount: 1 }));

      expect(result).toBeUndefined();
      expect(refresh).not.toHaveBeenCalled();
      expect(retryFn).not.toHaveBeenCalled();
    });
  });

  describe('successful refresh', () => {
    it('calls refresh() and retries with new Authorization header', async () => {
      const refresh = vi.fn(async () => 'new-access-token');
      const hook = createAuthAfterResponse(
        refresh,
        retryFn,
      );

      const result = await hook(
        afterState({
          status: 401,
          headers: { Authorization: 'Bearer old-token' },
        }),
      );

      expect(refresh).toHaveBeenCalledOnce();
      expect(retryFn).toHaveBeenCalledOnce();
      const retriedReq = retryFn.mock.calls[0][0] as Request;
      expect(retriedReq.headers.get('Authorization')).toBe(
        'Bearer new-access-token',
      );
      expect(retriedReq.url).toBe('https://example.com/api/tasks');
      expect(result).toEqual({ _retryMarker: true, request: retriedReq });
    });

    it('preserves non-Authorization headers on the retried request', async () => {
      const refresh = vi.fn(async () => 'new-tok');
      const hook = createAuthAfterResponse(
        refresh,
        retryFn,
      );

      await hook(
        afterState({
          status: 401,
          headers: { 'X-Custom': 'keep-me', Authorization: 'Bearer old-tok' },
        }),
      );

      const retriedReq = retryFn.mock.calls[0][0] as Request;
      expect(retriedReq.headers.get('X-Custom')).toBe('keep-me');
    });
  });

  describe('failed refresh', () => {
    it('passes through original 401 when refresh() returns null', async () => {
      const refresh = vi.fn(async () => null);
      const hook = createAuthAfterResponse(
        refresh,
        retryFn,
      );

      const result = await hook(afterState({ status: 401 }));

      expect(refresh).toHaveBeenCalledOnce();
      expect(retryFn).not.toHaveBeenCalled();
      expect(result).toBeUndefined();
    });
  });

  describe('API key rejection', () => {
    it('passes through 401 and calls onApiKeyRejected when X-Api-Key is present', async () => {
      const refresh = vi.fn();
      const onApiKeyRejected = vi.fn();
      const hook = createAuthAfterResponse(
        refresh,
        retryFn,
        onApiKeyRejected,
      );

      const result = await hook(
        afterState({
          status: 401,
          headers: { 'X-Api-Key': 'some-key' },
        }),
      );

      expect(onApiKeyRejected).toHaveBeenCalledOnce();
      expect(refresh).not.toHaveBeenCalled();
      expect(retryFn).not.toHaveBeenCalled();
      expect(result).toBeUndefined();
    });

    it('still calls onApiKeyRejected on /auth/jwt/refresh path', async () => {
      const refresh = vi.fn();
      const onApiKeyRejected = vi.fn();
      const hook = createAuthAfterResponse(
        refresh,
        retryFn,
        onApiKeyRejected,
      );

      const result = await hook(
        afterState({
          status: 401,
          url: 'https://example.com/auth/jwt/refresh',
          headers: { 'X-Api-Key': 'some-key' },
        }),
      );

      expect(onApiKeyRejected).toHaveBeenCalledOnce();
      expect(refresh).not.toHaveBeenCalled();
      expect(result).toBeUndefined();
    });

    it('does not call onApiKeyRejected when X-Api-Key is absent', async () => {
      const refresh = vi.fn(async () => 'new-token');
      const onApiKeyRejected = vi.fn();
      const hook = createAuthAfterResponse(
        refresh,
        retryFn,
        onApiKeyRejected,
      );

      const result = await hook(afterState({ status: 401 }));

      expect(onApiKeyRejected).not.toHaveBeenCalled();
      expect(refresh).toHaveBeenCalledOnce();
      expect(retryFn).toHaveBeenCalledOnce();
    });

    it('is a no-op when onApiKeyRejected is undefined', async () => {
      const refresh = vi.fn(async () => 'new-token');
      const hook = createAuthAfterResponse(
        refresh,
        retryFn,
      );

      const result = await hook(
        afterState({
          status: 401,
          headers: { 'X-Api-Key': 'some-key' },
        }),
      );

      expect(refresh).not.toHaveBeenCalled();
      expect(retryFn).not.toHaveBeenCalled();
      expect(result).toBeUndefined();
    });
  });

  describe('concurrent dedup', () => {
    it('shares a single refresh() call across multiple concurrent 401s', async () => {
      let resolveRefresh: (value: string) => void;
      const refresh = vi.fn(
        () =>
          new Promise<string>((resolve) => {
            resolveRefresh = resolve;
          }),
      );
      const hook = createAuthAfterResponse(
        refresh,
        retryFn,
      );

      const p1 = hook(afterState({ status: 401 }));
      const p2 = hook(afterState({ status: 401 }));

      expect(refresh).toHaveBeenCalledOnce();

      resolveRefresh!('new-token');

      await Promise.all([p1, p2]);

      expect(refresh).toHaveBeenCalledOnce();
      expect(retryFn).toHaveBeenCalledTimes(2);
    });

    it('both callers retry with the same new token', async () => {
      const refresh = vi.fn(async () => 'shared-new-token');
      const hook = createAuthAfterResponse(
        refresh,
        retryFn,
      );

      await Promise.all([
        hook(afterState({ status: 401 })),
        hook(afterState({ status: 401 })),
      ]);

      expect(refresh).toHaveBeenCalledOnce();
      const req1 = retryFn.mock.calls[0][0] as Request;
      const req2 = retryFn.mock.calls[1][0] as Request;
      expect(req1.headers.get('Authorization')).toBe('Bearer shared-new-token');
      expect(req2.headers.get('Authorization')).toBe('Bearer shared-new-token');
    });

    it('both callers pass through 401 when shared refresh fails', async () => {
      let rejectRefresh!: (err: Error) => void;
      const refresh = vi.fn(
        () =>
          new Promise<string>((_, reject) => {
            rejectRefresh = reject;
          }).catch(() => null),
      );
      const hook = createAuthAfterResponse(
        refresh,
        retryFn,
      );

      const p1 = hook(afterState({ status: 401 }));
      const p2 = hook(afterState({ status: 401 }));

      rejectRefresh!(new Error('refresh failed'));

      const [r1, r2] = await Promise.all([p1, p2]);

      expect(refresh).toHaveBeenCalledOnce();
      expect(retryFn).not.toHaveBeenCalled();
      expect(r1).toBeUndefined();
      expect(r2).toBeUndefined();
    });

    it('allows a new refresh after the previous one completes', async () => {
      const refresh = vi
        .fn()
        .mockResolvedValueOnce('token-1')
        .mockResolvedValueOnce('token-2');
      const hook = createAuthAfterResponse(
        refresh,
        retryFn,
      );

      await hook(afterState({ status: 401 }));
      expect(refresh).toHaveBeenCalledTimes(1);

      await hook(afterState({ status: 401 }));
      expect(refresh).toHaveBeenCalledTimes(2);
    });
  });
});
