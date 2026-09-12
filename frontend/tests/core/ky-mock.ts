import { vi } from 'vitest';

export type MockKy = ReturnType<typeof vi.fn> & {
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

export class HTTPError extends Error {
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

export class NetworkError extends Error {
  cause?: Error;
  constructor(message: string, options?: { cause?: Error }) {
    super(message);
    this.name = 'NetworkError';
    if (options?.cause) this.cause = options.cause;
  }
}

export class TimeoutError extends Error {
  request: Request;
  constructor(request: Request) {
    super('Request timed out');
    this.name = 'TimeoutError';
    this.request = request;
  }
}

export interface RetryMarkerLike {
  __retryMarker: true;
  options: unknown;
}

export function createKyMock() {
  const fn = vi.fn() as MockKy;
  Object.assign(fn, {
    extend: vi.fn(() => fn),
    create: vi.fn(() => fn),
    stop: vi.fn(),
    // Mirrors ky.retry(): returns a marker object ky's retry machinery recognizes.
    retry: vi.fn((options: unknown): RetryMarkerLike => ({ __retryMarker: true, options })),
    get: vi.fn(() => fn),
    post: vi.fn(() => fn),
    put: vi.fn(() => fn),
    patch: vi.fn(() => fn),
    delete: vi.fn(() => fn),
    head: vi.fn(() => fn),
  });

  return {
    default: fn,
    HTTPError,
    NetworkError,
    TimeoutError,
    isHTTPError: (e: unknown) => e instanceof HTTPError,
    isNetworkError: (e: unknown) => e instanceof NetworkError,
    isTimeoutError: (e: unknown) => e instanceof TimeoutError,
  };
}