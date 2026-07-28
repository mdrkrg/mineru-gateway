import { type } from 'arktype';
import { defineResponseSchema, defineRequestSchema } from '../../core/conventions';

// ===== Task status type =====

export type TaskStatus =
  | 'pending'
  | 'processing'
  | 'retry_pending'
  | 'completed'
  | 'failed'
  | 'cancelled';

// ===== Task submission =====

export const TaskSubmitResponseSchema = defineResponseSchema(
  {
    task_id: 'string',
    status: 'string',
    backend: 'string',
    file_names: 'string[]',
    created_at: 'string',
    status_url: 'string',
    result_url: 'string',
    started_at: 'string | null',
    completed_at: 'string | null',
    error: 'string | null',
    message: 'string',
  },
  {} as {
    taskId: string;
    status: string;
    backend: string;
    fileNames: string[];
    createdAt: string;
    statusUrl: string;
    resultUrl: string;
    startedAt: string | null;
    completedAt: string | null;
    error: string | null;
    message: string;
  },
);

// ===== Task list =====

export const TaskListItemSchema = defineResponseSchema(
  {
    task_id: 'string',
    status: 'string',
    backend: 'string',
    file_names: 'string[]',
    created_at: 'string',
    started_at: 'string | null',
    completed_at: 'string | null',
    error: 'string | null',
    retry_count: 'number',
    queued_ahead: 'number | null',
  },
  {} as {
    taskId: string;
    status: string;
    backend: string;
    fileNames: string[];
    createdAt: string;
    startedAt: string | null;
    completedAt: string | null;
    error: string | null;
    retryCount: number;
    queuedAhead: number | null;
  },
);

export const TaskListResponseSchema = defineResponseSchema(
  {
    items: type({
      task_id: 'string',
      status: 'string',
      backend: 'string',
      file_names: 'string[]',
      created_at: 'string',
      started_at: 'string | null',
      completed_at: 'string | null',
      error: 'string | null',
      retry_count: 'number',
      queued_ahead: 'number | null',
    }).array(),
    total: 'number',
    page: 'number',
    page_size: 'number',
  },
  {} as {
    items: {
      taskId: string;
      status: string;
      backend: string;
      fileNames: string[];
      createdAt: string;
      startedAt: string | null;
      completedAt: string | null;
      error: string | null;
      retryCount: number;
      queuedAhead: number | null;
    }[];
    total: number;
    page: number;
    pageSize: number;
  },
);

// ===== Task detail =====

export const TaskDetailSchema = defineResponseSchema(
  {
    task_id: 'string',
    status: 'string',
    backend: 'string',
    file_names: 'string[]',
    file_count: 'number',
    created_at: 'string',
    started_at: 'string | null',
    completed_at: 'string | null',
    error: 'string | null',
    retry_count: 'number',
    queued_ahead: 'number | null',
  },
  {} as {
    taskId: string;
    status: string;
    backend: string;
    fileNames: string[];
    fileCount: number;
    createdAt: string;
    startedAt: string | null;
    completedAt: string | null;
    error: string | null;
    retryCount: number;
    queuedAhead: number | null;
  },
);

// ===== Task cancel =====

export const TaskCancelResponseSchema = defineResponseSchema(
  {
    task_id: 'string',
    status: 'string',
    message: 'string',
  },
  {} as {
    taskId: string;
    status: string;
    message: string;
  },
);

// ===== Task stats =====

export const TaskStatsResponseSchema = defineResponseSchema(
  {
    pending: 'number',
    processing: 'number',
    retry_pending: 'number',
    completed: 'number',
    failed: 'number',
    cancelled: 'number',
    today_completed: 'number',
    today_failed: 'number',
    total_bytes: 'number',
    avg_duration_ms: 'number | null',
  },
  {} as {
    pending: number;
    processing: number;
    retryPending: number;
    completed: number;
    failed: number;
    cancelled: number;
    todayCompleted: number;
    todayFailed: number;
    totalBytes: number;
    avgDurationMs: number | null;
  },
);

// ===== Result zip =====

export const ResultZipRequestSchema = defineRequestSchema(
  {
    taskIds: 'string[]',
  },
  {} as { task_ids: string[] },
);

export const NonDownloadableItemSchema = defineResponseSchema(
  {
    task_id: 'string',
    status: 'string',
    reason: 'string',
  },
  {} as {
    taskId: string;
    status: string;
    reason: string;
  },
);

export const NonDownloadableErrorSchema = defineResponseSchema(
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
    nonDownloadable: {
      taskId: string;
      status: string;
      reason: string;
    }[];
  },
);

// ===== Batch cancel =====

export const BatchCancelRequestSchema = defineRequestSchema(
  {
    taskIds: 'string[]',
  },
  {} as { task_ids: string[] },
);

export const BatchCancelErrorSchema = defineResponseSchema(
  {
    task_id: 'string',
    reason: 'string',
    current_status: 'string | null',
  },
  {} as {
    taskId: string;
    reason: string;
    currentStatus: string | null;
  },
);

export const BatchCancelResponseSchema = defineResponseSchema(
  {
    cancelled_count: 'number',
    cancelled_ids: 'string[]',
    errors: type({
      task_id: 'string',
      reason: 'string',
      current_status: 'string | null',
    }).array(),
  },
  {} as {
    cancelledCount: number;
    cancelledIds: string[];
    errors: {
      taskId: string;
      reason: string;
      currentStatus: string | null;
    }[];
  },
);

// ===== Type exports =====

export type TaskSubmitResponse = typeof TaskSubmitResponseSchema.infer;
export type TaskListItem = typeof TaskListItemSchema.infer;
export type TaskListResponse = typeof TaskListResponseSchema.infer;
export type TaskDetail = typeof TaskDetailSchema.infer;
export type TaskCancelResponse = typeof TaskCancelResponseSchema.infer;
export type TaskStatsResponse = typeof TaskStatsResponseSchema.infer;
export type ResultZipRequest = typeof ResultZipRequestSchema.infer;
export type NonDownloadableItem = typeof NonDownloadableItemSchema.infer;
export type NonDownloadableError = typeof NonDownloadableErrorSchema.infer;
export type BatchCancelRequest = typeof BatchCancelRequestSchema.infer;
export type BatchCancelError = typeof BatchCancelErrorSchema.infer;
export type BatchCancelResponse = typeof BatchCancelResponseSchema.infer;
