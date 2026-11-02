import { fetchAndValidate } from '@/core/validation';
import { GatewayConfigSchema, type GatewayConfig } from '@/api/schemas/config';
import type { ResultAsync } from 'neverthrow';
import type { ApiError, HttpError } from '@/core/error-model';

/**
 * Read the gateway's public capabilities. The panel needs this before it has
 * any credential: a key-only deployment has no login routes at all.
 */
export function getGatewayConfig(): ResultAsync<
  GatewayConfig,
  ApiError<HttpError<number, unknown>>
> {
  return fetchAndValidate('v1/config', { success: GatewayConfigSchema });
}
