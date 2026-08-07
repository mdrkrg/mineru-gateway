import type { ResultAsync } from 'neverthrow';
import { fetchAndValidate, validateRequest } from '@/core/validation';
import { request } from '@/core/http-client';
import type { RawResponse } from '@/core/http-client';
import type { ApiError, HttpError } from '@/core/error-model';
import { ErrorDetailSchema } from '@/api/schemas/shared';
import {
  ApiKeyCreatedResponseSchema,
  ApiKeyListResponseSchema,
  ApiKeyCreateRequestSchema,
  LoginRequestSchema,
  TokenPairResponseSchema,
  RefreshTokenRequestSchema,
  AccessTokenResponseSchema,
  LogoutResponseSchema,
  UserReadSchema,
  UserCreateRequestSchema,
  UserUpdateRequestSchema,
  MyApiKeyCreateRequestSchema,
  VerifyEmailRequestSchema,
  OAuthProvidersResponseSchema,
  type ApiKeyCreateRequest,
  type LoginRequest,
  type RefreshTokenRequest,
  type UserCreateRequest,
  type UserUpdateRequest,
  type MyApiKeyCreateRequest,
  type UserRead,
  type VerifyEmailRequest,
} from '@/api/schemas/auth';

// ===== Admin API Keys =====

export function createApiKey(body: ApiKeyCreateRequest, adminToken: string) {
  const validated = validateRequest(ApiKeyCreateRequestSchema)(body);
  if (validated.isErr()) return validated;
  return fetchAndValidate('auth/keys', {
    success: ApiKeyCreatedResponseSchema,
    failures: { 401: ErrorDetailSchema },
  }, {
    method: 'POST',
    json: validated.value,
    headers: { 'X-Admin-Token': adminToken },
  });
}

export function listApiKeys(adminToken: string) {
  return fetchAndValidate('auth/keys', {
    success: ApiKeyListResponseSchema,
    failures: { 401: ErrorDetailSchema },
  }, {
    headers: { 'X-Admin-Token': adminToken },
  });
}

export function revokeApiKey(keyId: string, adminToken: string) {
  return request(`auth/keys/${keyId}`, {
    method: 'DELETE',
    headers: { 'X-Admin-Token': adminToken },
  });
}

// ===== JWT Auth =====

export function login(body: LoginRequest) {
  const validated = validateRequest(LoginRequestSchema)(body);
  if (validated.isErr()) return validated;
  return fetchAndValidate('auth/jwt/login', {
    success: TokenPairResponseSchema,
    failures: { 401: ErrorDetailSchema },
  }, {
    method: 'POST',
    json: validated.value,
  });
}

export function refreshToken(body: RefreshTokenRequest) {
  const validated = validateRequest(RefreshTokenRequestSchema)(body);
  if (validated.isErr()) return validated;
  return fetchAndValidate('auth/jwt/refresh', {
    success: AccessTokenResponseSchema,
    failures: { 401: ErrorDetailSchema },
  }, {
    method: 'POST',
    json: validated.value,
  });
}

export function logout() {
  return fetchAndValidate('auth/jwt/logout', {
    success: LogoutResponseSchema,
    failures: { 401: ErrorDetailSchema },
  }, {
    method: 'POST',
  });
}

// ===== Registration =====

export function register(body: UserCreateRequest) {
  const validated = validateRequest(UserCreateRequestSchema)(body);
  if (validated.isErr()) return validated;
  return fetchAndValidate('auth/register', {
    success: UserReadSchema,
    failures: { 400: ErrorDetailSchema, 403: ErrorDetailSchema },
  }, {
    method: 'POST',
    json: validated.value,
  });
}

// ===== Admin Create User =====

export function adminCreateUser(body: UserCreateRequest, adminToken: string) {
  const validated = validateRequest(UserCreateRequestSchema)(body);
  if (validated.isErr()) return validated;
  return fetchAndValidate('auth/users', {
    success: UserReadSchema,
    failures: { 400: ErrorDetailSchema, 401: ErrorDetailSchema },
  }, {
    method: 'POST',
    json: validated.value,
    headers: { 'X-Admin-Token': adminToken },
  });
}

// ===== User Profile =====

export function getCurrentUser(accessToken?: string) {
  const headers: Record<string, string> = {};
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;
  return fetchAndValidate('users/me', {
    success: UserReadSchema,
    failures: { 401: ErrorDetailSchema },
  }, { headers });
}

export function updateCurrentUser(body: UserUpdateRequest) {
  const validated = validateRequest(UserUpdateRequestSchema)(body);
  if (validated.isErr()) return validated;
  return fetchAndValidate('users/me', {
    success: UserReadSchema,
    failures: { 401: ErrorDetailSchema, 400: ErrorDetailSchema },
  }, {
    method: 'PATCH',
    json: validated.value,
  });
}

// ===== Self-Service API Keys =====

export function listMyApiKeys() {
  return fetchAndValidate('me/api-keys', {
    success: ApiKeyListResponseSchema,
    failures: { 401: ErrorDetailSchema },
  });
}

export function createMyApiKey(body: MyApiKeyCreateRequest) {
  const validated = validateRequest(MyApiKeyCreateRequestSchema)(body);
  if (validated.isErr()) return validated;
  return fetchAndValidate('me/api-keys', {
    success: ApiKeyCreatedResponseSchema,
    failures: { 401: ErrorDetailSchema, 403: ErrorDetailSchema },
  }, {
    method: 'POST',
    json: validated.value,
  });
}

export function revokeMyApiKey(keyId: string) {
  return request(`me/api-keys/${keyId}`, {
    method: 'DELETE',
  });
}

// ===== OAuth =====

export function getOAuthProviders() {
  return fetchAndValidate('auth/oauth/providers', {
    success: OAuthProvidersResponseSchema,
  });
}

// ===== Email verification =====

export function requestVerifyToken(
  body: VerifyEmailRequest,
): ResultAsync<RawResponse, ApiError<HttpError<number, unknown>>> {
  const validated = validateRequest(VerifyEmailRequestSchema)(body);
  if (validated.isErr()) return validated as never;
  return request('auth/request-verify-token', {
    method: 'POST',
    json: validated.value,
  });
}
