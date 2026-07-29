import { defineResponseSchema } from '@/core/conventions';

export const HealthResponseSchema = defineResponseSchema(
  {
    gateway: 'string',
    status: 'string',
    upstream: {
      status: 'string',
      version: 'string | null',
      protocol_version: 'number | null',
      max_concurrent_requests: 'number',
      queued_tasks: 'number',
      processing_tasks: 'number',
      completed_tasks: 'number',
      failed_tasks: 'number',
      processing_window_size: 'number | null',
      free_slots: 'number',
    },
  },
  {} as {
    gateway: string;
    status: string;
    upstream: {
      status: string;
      version: string | null;
      protocolVersion: number | null;
      maxConcurrentRequests: number;
      queuedTasks: number;
      processingTasks: number;
      completedTasks: number;
      failedTasks: number;
      processingWindowSize: number | null;
      freeSlots: number;
    };
  },
);

export const HealthDegradedResponseSchema = defineResponseSchema(
  {
    gateway: 'string',
    status: 'string',
    upstream: {
      status: 'string',
      error: 'string?',
    },
  },
  {} as {
    gateway: string;
    status: string;
    upstream: { status: string; error: string | undefined };
  },
);

export type HealthResponse = typeof HealthResponseSchema.infer;
export type HealthDegradedResponse = typeof HealthDegradedResponseSchema.infer;
