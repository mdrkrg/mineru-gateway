/**
 * @file Email verification endpoint function tests - the behavioral spec.
 *
 * Gateway spec: specs/email-verification.md Section 4.1 / 4.2.
 *
 * ## Contract under test
 *
 * ### `requestVerifyToken({ email })`
 *
 * - POSTs to `auth/request-verify-token` with the snake_case body
 *   `{ email }`.
 * - 202 (accepted, empty body) -> `Ok(RawResponse)` with `status === 202`.
 * - Any HTTP error -> `Err(HttpError)` with the actual status.
 * - Network errors -> `Err(NetworkError)`.
 * - Invalid body (email not a string) -> `Err(ValidationError)` and no
 *   HTTP request is made.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MockKy } from '../core/ky-mock';

vi.mock('ky', async () => {
  const { createKyMock } = await import('../core/ky-mock');
  return createKyMock();
});

import ky from 'ky';
import { HTTPError, NetworkError } from '../core/ky-mock';
import { requestVerifyToken } from '../../src/api/functions/auth';
import { isHttpError } from '../../src/core/error-model';

const m = ky as unknown as MockKy;

const EMAIL = 'user@example.com';

function httpError(status: number, body: unknown): HTTPError {
  const httpErr = new HTTPError(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
    new Request('http://test'),
    {},
  );
  httpErr.data = body;
  return httpErr;
}

beforeEach(() => {
  m.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ================================================================
// requestVerifyToken
// ================================================================

describe('requestVerifyToken', () => {
  it('POSTs the email to auth/request-verify-token', async () => {
    m.mockResolvedValueOnce(new Response(null, { status: 202 }));

    const result = await requestVerifyToken({ email: EMAIL });

    expect(result.isOk()).toBe(true);
    expect(m).toHaveBeenCalledTimes(1);
    const [url, options] = m.mock.calls[0] as [
      string,
      { method: string; json: unknown },
    ];
    expect(url).toBe('auth/request-verify-token');
    expect(options.method).toBe('POST');
    expect(options.json).toEqual({ email: EMAIL });
  });

  it('returns Ok with status 202 (empty body)', async () => {
    m.mockResolvedValueOnce(new Response(null, { status: 202 }));

    const result = await requestVerifyToken({ email: EMAIL });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.status).toBe(202);
    }
  });

  it('returns Err(HttpError) on server error', async () => {
    m.mockRejectedValueOnce(httpError(500, { detail: 'boom' }));

    const result = await requestVerifyToken({ email: EMAIL });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(isHttpError(result.error)).toBe(true);
      if (isHttpError(result.error)) {
        expect(result.error.status).toBe(500);
      }
    }
  });

  it('returns Err(NetworkError) on network failure', async () => {
    m.mockRejectedValueOnce(
      new NetworkError('offline', { cause: new Error('dns') }),
    );

    const result = await requestVerifyToken({ email: EMAIL });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error._type).toBe('NetworkError');
    }
  });

  it('returns Err(ValidationError) without calling the API for a non-string email', async () => {
    const result = await requestVerifyToken({
      email: 123 as unknown as string,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error._type).toBe('ValidationError');
    }
    expect(m).not.toHaveBeenCalled();
  });
});
