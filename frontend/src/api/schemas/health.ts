import { defineResponseSchema } from '@/core/conventions';

export const HealthResponseSchema = defineResponseSchema(
  {
    gateway: 'string',
    status: 'string',
    upstream: {
      status: 'string',
      version: 'string | null',
      features: {
        webhook: 'boolean',
        output_formats: 'string[]',
        sources: 'string[]',
      },
    },
  },
  {} as {
    gateway: string;
    status: string;
    upstream: {
      status: string;
      version: string | null;
      features: {
        webhook: boolean;
        outputFormats: string[];
        sources: string[];
      };
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
