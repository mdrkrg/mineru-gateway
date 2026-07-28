import ky_default, { HTTPError, NetworkError, TimeoutError, isHTTPError, isNetworkError, isTimeoutError } from 'ky';
import type { Options } from 'ky';
import { ResultAsync, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { createHttpError } from './error-model';
import type { ApiError, HttpError } from './error-model';

// Spec: frontend/specs/core/http-client.md

export interface BodyReader {
  json(): Promise<unknown>;
  text(): Promise<string>;
  blob(): Promise<Blob>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface RawResponse {
  readonly status: number;
  readonly headers: Headers;
  readonly reader: BodyReader;
}

export interface BlobResult {
  readonly blob: Blob;
  readonly status: number;
  readonly headers: Headers;
}

const VITE_API_PREFIX: string =
  (import.meta as unknown as Record<string, unknown>).env
    ? ((import.meta as unknown as Record<string, { VITE_API_PREFIX?: string }>).env?.VITE_API_PREFIX ?? '')
    : '';

function getApi(): typeof ky_default {
  return ky_default.extend({
    prefix: VITE_API_PREFIX,
    hooks: {
      beforeRequest: [],
      afterResponse: [],
    },
  });
}

export function request(
  url: string,
  options?: Options,
): ResultAsync<RawResponse, ApiError<HttpError<number, unknown>>> {
  return ResultAsync.fromPromise(
    getApi()(url, { ...options, throwHttpErrors: true }),
    (error: unknown) => {
      if (isHTTPError(error)) {
        const httpErr = error as HTTPError;
        return createHttpError(httpErr.response.status, httpErr.data) as ApiError<HttpError<number, unknown>>;
      }
      if (isNetworkError(error)) {
        const netErr = error as NetworkError;
        return {
          _type: 'NetworkError',
          error: netErr.cause ?? new Error('Network error'),
        } as ApiError<HttpError<number, unknown>>;
      }
      if (isTimeoutError(error)) {
        return {
          _type: 'NetworkError',
          error: error as unknown as Error,
        } as ApiError<HttpError<number, unknown>>;
      }
      if (error instanceof DOMException && error.name === 'AbortError') {
        return {
          _type: 'NetworkError',
          error: error,
        } as ApiError<HttpError<number, unknown>>;
      }
      return {
        _type: 'UnexpectedError',
        error,
      } as ApiError<HttpError<number, unknown>>;
    },
  ).map((resp) => {
    const raw: RawResponse = {
      status: resp.status,
      headers: resp.headers,
      reader: {
        json: () => resp.json(),
        text: () => resp.text(),
        blob: () => resp.blob(),
        arrayBuffer: () => resp.arrayBuffer(),
      },
    };
    return raw;
  });
}

export function parseJson(
  response: RawResponse,
): ResultAsync<unknown, ApiError<never>> {
  return ResultAsync.fromPromise(
    response.reader.json(),
    () => {
      return {
        _type: 'ValidationError',
        status: null,
        summary: 'Response body is not valid JSON',
        issues: null,
      } as ApiError<never>;
    },
  );
}

export function parseBlob(
  response: RawResponse,
): ResultAsync<BlobResult, ApiError<never>> {
  return ResultAsync.fromPromise(
    response.reader.blob().then((blob) => ({
      blob,
      status: response.status,
      headers: response.headers,
    })),
    (error) => {
      return {
        _type: 'UnexpectedError',
        error,
      } as ApiError<never>;
    },
  );
}

export function parseArrayBuffer(
  response: RawResponse,
): ResultAsync<ArrayBuffer, ApiError<never>> {
  return ResultAsync.fromPromise(
    response.reader.arrayBuffer(),
    (error) => {
      return {
        _type: 'UnexpectedError',
        error,
      } as ApiError<never>;
    },
  );
}

export function passthrough(
  response: RawResponse,
): Result<RawResponse, ApiError<never>> {
  return ok(response) as Result<RawResponse, ApiError<never>>;
}
