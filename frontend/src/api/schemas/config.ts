import { type } from 'arktype';
import { defineResponseSchema } from '@/core/conventions';

/** Public gateway capabilities, served by `GET /v1/config`. */
export const GatewayConfigSchema = defineResponseSchema(
  {
    user_auth_enabled: 'boolean',
    providers: type({ name: 'string' }).array(),
  },
  {} as {
    userAuthEnabled: boolean;
    providers: { name: string }[];
  },
);

export type GatewayConfig = typeof GatewayConfigSchema.infer;
