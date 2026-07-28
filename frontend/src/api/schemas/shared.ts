import { defineResponseSchema } from '../../core/conventions';

export const ErrorDetailSchema = defineResponseSchema(
  { detail: 'string' },
  {} as { detail: string },
);
