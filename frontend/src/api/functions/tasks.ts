import type { ResultAsync } from 'neverthrow';
import type { ApiError, HttpError } from '@/core/error-model';
import { fetchAndValidate, fetchBinaryAndValidate, validateRequest, validateSuccess } from '@/core/validation';
import { request, parseJson, parseBlob, passthrough } from '@/core/http-client';
import type { BlobResult, RawResponse } from '@/core/http-client';
import type { MineruBackend, ParseRequestFields } from '@/api/schemas/mineru-options';
import { createParseFormData } from '@/api/schemas/mineru-options';
import { ErrorDetailSchema } from '@/api/schemas/shared';
import {
  TaskSubmitResponseSchema,
  TaskListResponseSchema,
  TaskDetailSchema,
  TaskCancelResponseSchema,
  TaskStatsResponseSchema,
  ResultZipRequestSchema,
  NonDownloadableErrorSchema,
  BatchCancelRequestSchema,
  BatchCancelResponseSchema,
  type TaskListResponse,
  type TaskDetail,
  type TaskCancelResponse,
  type TaskStatsResponse,
  type BatchCancelResponse,
  type NonDownloadableError,
} from '@/api/schemas/tasks';

// ===== Proxy: Task Submission =====

export interface TaskSubmissionOptions {
  apiKey?: string;
  idempotencyKey?: string;
  parseFields: ParseRequestFields;
  signal?: AbortSignal;
}

export function submitTask(options: TaskSubmissionOptions) {
  const headers: Record<string, string> = {};
  if (options.apiKey) headers['X-API-Key'] = options.apiKey;
  if (options.idempotencyKey) headers['X-Idempotency-Key'] = options.idempotencyKey;

  return request('tasks', {
    method: 'POST',
    body: createParseFormData(options.parseFields),
    headers,
    signal: options.signal,
  })
    .andThen(parseJson)
    .andThen(validateSuccess(TaskSubmitResponseSchema));
}

// ===== Proxy: File Parse =====

export interface FileParseOptions {
  apiKey?: string;
  parseFields: ParseRequestFields;
  signal?: AbortSignal;
}

export function parseFile(
  options: FileParseOptions,
): ResultAsync<RawResponse, ApiError<HttpError<number, unknown>>> {
  const headers: Record<string, string> = {};
  if (options.apiKey) headers['X-API-Key'] = options.apiKey;

  return request('file_parse', {
    method: 'POST',
    body: createParseFormData(options.parseFields),
    headers,
    signal: options.signal,
  }).andThen(passthrough);
}

// ===== Task List =====

export interface TaskListParams {
  apiKey: string;
  status?: string;
  backend?: MineruBackend;
  fileName?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
}

export function listTasks(
  params: TaskListParams,
): ResultAsync<
  TaskListResponse,
  ApiError<HttpError<401, { detail: string }>>
> {
  const searchParams = new URLSearchParams();
  if (params.status) searchParams.set('status', params.status);
  if (params.backend) searchParams.set('backend', params.backend);
  if (params.fileName) searchParams.set('file_name', params.fileName);
  if (params.dateFrom) searchParams.set('date_from', params.dateFrom);
  if (params.dateTo) searchParams.set('date_to', params.dateTo);
  if (params.page !== undefined) searchParams.set('page', String(params.page));
  if (params.pageSize !== undefined) searchParams.set('page_size', String(params.pageSize));

  return fetchAndValidate(`tasks?${searchParams}`, {
    success: TaskListResponseSchema,
    failures: { 401: ErrorDetailSchema },
  }, {
    headers: { 'X-API-Key': params.apiKey },
  }) as ResultAsync<TaskListResponse, ApiError<HttpError<401, { detail: string }>>>;
}

// ===== Task Stats =====

export function getTaskStats(
  apiKey: string,
): ResultAsync<
  TaskStatsResponse,
  ApiError<HttpError<401, { detail: string }>>
> {
  return fetchAndValidate('tasks/stats', {
    success: TaskStatsResponseSchema,
    failures: { 401: ErrorDetailSchema },
  }, {
    headers: { 'X-API-Key': apiKey },
  }) as ResultAsync<TaskStatsResponse, ApiError<HttpError<401, { detail: string }>>>;
}

// ===== Task Detail =====

export function getTaskDetail(
  taskId: string,
  apiKey: string,
): ResultAsync<
  TaskDetail,
  ApiError<HttpError<401, { detail: string }> | HttpError<404, { detail: string }>>
> {
  return fetchAndValidate(`tasks/${taskId}`, {
    success: TaskDetailSchema,
    failures: { 401: ErrorDetailSchema, 404: ErrorDetailSchema },
  }, {
    headers: { 'X-API-Key': apiKey },
  }) as ResultAsync<
    TaskDetail,
    ApiError<HttpError<401, { detail: string }> | HttpError<404, { detail: string }>>
  >;
}

// ===== Task Cancel =====

export function cancelTask(
  taskId: string,
  apiKey: string,
): ResultAsync<
  TaskCancelResponse,
  ApiError<
    | HttpError<401, { detail: string }>
    | HttpError<404, { detail: string }>
    | HttpError<409, { detail: string }>
  >
> {
  return fetchAndValidate(`tasks/${taskId}`, {
    success: TaskCancelResponseSchema,
    failures: { 401: ErrorDetailSchema, 404: ErrorDetailSchema, 409: ErrorDetailSchema },
  }, {
    method: 'DELETE',
    headers: { 'X-API-Key': apiKey },
  }) as ResultAsync<
    TaskCancelResponse,
    ApiError<
      | HttpError<401, { detail: string }>
      | HttpError<404, { detail: string }>
      | HttpError<409, { detail: string }>
    >
  >;
}

// ===== Task Result Download =====

export function getTaskResult(
  taskId: string,
  apiKey: string,
): ResultAsync<BlobResult, ApiError<HttpError<number, unknown>>> {
  return request(`tasks/${taskId}/result`, {
    headers: { 'X-API-Key': apiKey },
  }).andThen(parseBlob);
}

// ===== Result Zip =====

export function downloadResultZip(
  taskIds: string[],
  apiKey: string,
): ResultAsync<
  BlobResult,
  ApiError<HttpError<409, NonDownloadableError> | HttpError<404, { detail: string }>>
> {
  const validated = validateRequest(ResultZipRequestSchema)({ taskIds });
  if (validated.isErr()) return validated as never;

  return fetchBinaryAndValidate('tasks/result-zip', {
    failures: { 409: NonDownloadableErrorSchema, 404: ErrorDetailSchema },
  }, {
    method: 'POST',
    json: validated.value,
    headers: { 'X-API-Key': apiKey },
  }) as ResultAsync<
    BlobResult,
    ApiError<HttpError<409, NonDownloadableError> | HttpError<404, { detail: string }>>
  >;
}

// ===== Batch Cancel =====

export function batchCancelTasks(
  taskIds: string[],
  apiKey: string,
): ResultAsync<
  BatchCancelResponse,
  ApiError<HttpError<401, { detail: string }>>
> {
  const validated = validateRequest(BatchCancelRequestSchema)({ taskIds });
  if (validated.isErr()) return validated as never;

  return fetchAndValidate('tasks/cancel', {
    success: BatchCancelResponseSchema,
    failures: { 401: ErrorDetailSchema },
  }, {
    method: 'POST',
    json: validated.value,
    headers: { 'X-API-Key': apiKey },
  }) as ResultAsync<
    BatchCancelResponse,
    ApiError<HttpError<401, { detail: string }>>
  >;
}
