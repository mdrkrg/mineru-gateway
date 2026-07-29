import type { ResultAsync } from 'neverthrow';
import type { ApiError, HttpError } from '@/core/error-model';
import { fetchAndValidate } from '@/core/validation';
import {
  HealthResponseSchema,
  HealthDegradedResponseSchema,
  type HealthResponse,
  type HealthDegradedResponse,
} from '@/api/schemas/health';

export function getHealth(): ResultAsync<
  HealthResponse,
  ApiError<HttpError<503, HealthDegradedResponse>>
> {
  return fetchAndValidate('health', {
    success: HealthResponseSchema,
    failures: { 503: HealthDegradedResponseSchema },
  });
}
