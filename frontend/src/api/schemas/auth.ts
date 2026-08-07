import { type } from 'arktype';
import { defineResponseSchema, defineRequestSchema } from '@/core/conventions';

// ===== API Key management =====

export const ApiKeyCreateRequestSchema = defineRequestSchema(
  {
    label: 'string | null',
    expiresAt: 'string | null',
  },
  {} as {
    label: string | null;
    expires_at: string | null;
  },
);

export const ApiKeyCreatedResponseSchema = defineResponseSchema(
  {
    key_id: 'string',
    api_key: 'string',
    api_key_prefix: 'string',
    message: 'string',
  },
  {} as {
    keyId: string;
    apiKey: string;
    apiKeyPrefix: string;
    message: string;
  },
);

export const ApiKeyInfoSchema = defineResponseSchema(
  {
    id: 'string',
    api_key_prefix: 'string',
    label: 'string',
    created_at: 'string',
    last_used_at: 'string | null',
    expires_at: 'string | null',
    is_active: 'boolean',
  },
  {} as {
    id: string;
    apiKeyPrefix: string;
    label: string;
    createdAt: string;
    lastUsedAt: string | null;
    expiresAt: string | null;
    isActive: boolean;
  },
);

export const ApiKeyListResponseSchema = defineResponseSchema(
  {
    keys: type({
      id: 'string',
      api_key_prefix: 'string',
      label: 'string',
      created_at: 'string',
      last_used_at: 'string | null',
      expires_at: 'string | null',
      is_active: 'boolean',
    }).array(),
  },
  {} as {
    keys: {
      id: string;
      apiKeyPrefix: string;
      label: string;
      createdAt: string;
      lastUsedAt: string | null;
      expiresAt: string | null;
      isActive: boolean;
    }[];
  },
);

// ===== My API Keys =====

export const MyApiKeyCreateRequestSchema = defineRequestSchema(
  {
    label: 'string | null',
    expiresAt: 'string | null',
  },
  {} as {
    label: string | null;
    expires_at: string | null;
  },
);

// ===== JWT Auth =====

export const LoginRequestSchema = defineRequestSchema(
  {
    email: 'string',
    password: 'string',
  },
  {} as { email: string; password: string },
);

export const TokenPairResponseSchema = defineResponseSchema(
  {
    access_token: 'string',
    refresh_token: 'string',
    token_type: 'string',
  },
  {} as {
    accessToken: string;
    refreshToken: string;
    tokenType: string;
  },
);

export const AccessTokenResponseSchema = defineResponseSchema(
  {
    access_token: 'string',
    token_type: 'string',
  },
  {} as {
    accessToken: string;
    tokenType: string;
  },
);

export const RefreshTokenRequestSchema = defineRequestSchema(
  {
    refreshToken: 'string',
  },
  {} as { refresh_token: string },
);

// ===== User =====

export const UserReadSchema = defineResponseSchema(
  {
    id: 'string',
    email: 'string',
    is_active: 'boolean',
    is_superuser: 'boolean',
    is_verified: 'boolean',
    display_name: 'string | null',
    created_at: 'string',
    updated_at: 'string',
  },
  {} as {
    id: string;
    email: string;
    isActive: boolean;
    isSuperuser: boolean;
    isVerified: boolean;
    displayName: string | null;
    createdAt: string;
    updatedAt: string;
  },
);

export const UserCreateRequestSchema = defineRequestSchema(
  {
    email: 'string',
    password: 'string',
    isActive: 'boolean | null',
    isSuperuser: 'boolean | null',
    isVerified: 'boolean | null',
    displayName: 'string | null',
  },
  {} as {
    email: string;
    password: string;
    is_active: boolean | null;
    is_superuser: boolean | null;
    is_verified: boolean | null;
    display_name: string | null;
  },
);

export const UserUpdateRequestSchema = defineRequestSchema(
  {
    password: 'string | null',
    displayName: 'string | null',
  },
  {} as {
    password: string | null;
    display_name: string | null;
  },
);

// ===== Logout =====

export const LogoutResponseSchema = defineResponseSchema(
  {
    message: 'string',
  },
  {} as { message: string },
);

// ===== Email verification =====

export const VerifyEmailRequestSchema = defineRequestSchema(
  {
    email: 'string',
  },
  {} as { email: string },
);

export const VerifyEmailTokenRequestSchema = defineRequestSchema(
  {
    token: 'string',
  },
  {} as { token: string },
);

// ===== OAuth =====

export const OAuthProvidersResponseSchema = defineResponseSchema(
  {
    providers: type({
      name: 'string',
    }).array(),
  },
  {} as {
    providers: { name: string }[];
  },
);

// ===== Type exports =====

export type ApiKeyCreateRequest = { label: string | null; expiresAt: string | null };
export type ApiKeyCreatedResponse = typeof ApiKeyCreatedResponseSchema.infer;
export type ApiKeyInfo = typeof ApiKeyInfoSchema.infer;
export type ApiKeyListResponse = typeof ApiKeyListResponseSchema.infer;

export type MyApiKeyCreateRequest = { label: string | null; expiresAt: string | null };

export type LoginRequest = { email: string; password: string };
export type TokenPairResponse = typeof TokenPairResponseSchema.infer;
export type AccessTokenResponse = typeof AccessTokenResponseSchema.infer;
export type RefreshTokenRequest = { refreshToken: string };

export type UserRead = typeof UserReadSchema.infer;
export type UserCreateRequest = {
  email: string;
  password: string;
  isActive: boolean | null;
  isSuperuser: boolean | null;
  isVerified: boolean | null;
  displayName: string | null;
};
export type UserUpdateRequest = { password: string | null; displayName: string | null };

export type VerifyEmailRequest = { email: string };
export type VerifyEmailTokenRequest = { token: string };

export type OAuthProvidersResponse = typeof OAuthProvidersResponseSchema.infer;
