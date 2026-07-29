import { fetchAndValidate, validateRequest } from '../../core/validation';
import { request } from '../../core/http-client';
import { ErrorDetailSchema } from '../schemas/shared';
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
  OAuthProvidersResponseSchema,
  type ApiKeyCreateRequest,
  type LoginRequest,
  type RefreshTokenRequest,
  type UserCreateRequest,
  type UserUpdateRequest,
  type MyApiKeyCreateRequest,
} from '../schemas/auth';

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

export function logout(accessToken: string) {
  return fetchAndValidate('auth/jwt/logout', {
    success: LogoutResponseSchema,
    failures: { 401: ErrorDetailSchema },
  }, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
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

export function getCurrentUser(accessToken: string) {
  return fetchAndValidate('users/me', {
    success: UserReadSchema,
    failures: { 401: ErrorDetailSchema },
  }, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export function updateCurrentUser(body: UserUpdateRequest, accessToken: string) {
  const validated = validateRequest(UserUpdateRequestSchema)(body);
  if (validated.isErr()) return validated;
  return fetchAndValidate('users/me', {
    success: UserReadSchema,
    failures: { 401: ErrorDetailSchema, 400: ErrorDetailSchema },
  }, {
    method: 'PATCH',
    json: validated.value,
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// ===== Self-Service API Keys =====

export function listMyApiKeys(accessToken: string) {
  return fetchAndValidate('me/api-keys', {
    success: ApiKeyListResponseSchema,
    failures: { 401: ErrorDetailSchema },
  }, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export function createMyApiKey(body: MyApiKeyCreateRequest, accessToken: string) {
  const validated = validateRequest(MyApiKeyCreateRequestSchema)(body);
  if (validated.isErr()) return validated;
  return fetchAndValidate('me/api-keys', {
    success: ApiKeyCreatedResponseSchema,
    failures: { 401: ErrorDetailSchema },
  }, {
    method: 'POST',
    json: validated.value,
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export function revokeMyApiKey(keyId: string, accessToken: string) {
  return request(`me/api-keys/${keyId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// ===== OAuth =====

export function getOAuthProviders() {
  return fetchAndValidate('auth/oauth/providers', {
    success: OAuthProvidersResponseSchema,
  });
}

export function getOAuthAuthorizeUrl(provider: string): string {
  return `auth/oauth/${provider}/authorize`;
}
