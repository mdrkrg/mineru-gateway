import type { Options } from 'ky';
import type { ResultAsync, Result } from 'neverthrow';
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

export function request(
  url: string,
  options?: Options,
): ResultAsync<RawResponse, ApiError<HttpError<number, unknown>>> {
  throw new Error('not implemented');
}

export function parseJson(
  response: RawResponse,
): ResultAsync<unknown, ApiError<never>> {
  throw new Error('not implemented');
}

export function parseBlob(
  response: RawResponse,
): ResultAsync<BlobResult, ApiError<never>> {
  throw new Error('not implemented');
}

export function parseArrayBuffer(
  response: RawResponse,
): ResultAsync<ArrayBuffer, ApiError<never>> {
  throw new Error('not implemented');
}

export function passthrough(
  response: RawResponse,
): Result<RawResponse, ApiError<never>> {
  throw new Error('not implemented');
}
