/**
 * E2E tests for API key management (admin endpoints).
 *
 * Verifies admin API key CRUD against a running gateway with
 * GATEWAY_ADMIN_TOKEN=e2e-admin-token.
 *
 * Covered endpoints:
 *   POST   /auth/keys       create key -> 201 with raw key
 *   GET    /auth/keys        list keys  -> 200 with key array
 *   DELETE /auth/keys/{id}   revoke key -> 204
 *
 * Auth failure: missing or wrong admin token -> 401.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setApiBaseUrl, isHttpError } from '../../src/core';
import {
  createApiKey,
  listApiKeys,
  revokeApiKey,
} from '../../src/api';
import { MockControl } from './mock-control';
import { loadE2EUrls } from './helpers';

const ADMIN_TOKEN = 'e2e-admin-token';

let mock: MockControl;

beforeAll(async () => {
  const urls = loadE2EUrls();
  setApiBaseUrl(urls.gatewayUrl);
  mock = new MockControl(urls.mockUrl);
  await mock.reset();
});

afterAll(async () => {
  await mock.reset();
});

describe('POST /auth/keys (create)', () => {
  it('creates an API key and returns the raw key', async () => {
    const body = { label: 'e2e-test', expiresAt: null } as never;
    const result = await createApiKey(body, ADMIN_TOKEN);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    expect(result.value.keyId).toBeTruthy();
    expect(typeof result.value.apiKey).toBe('string');
    expect(result.value.apiKey.length).toBeGreaterThan(0);
    expect(result.value.apiKeyPrefix).toBeTruthy();
    expect(result.value.message).toContain('Save this API key');
  });

  it('rejects creation without admin token', async () => {
    const body = { label: 'e2e-test', expiresAt: null } as never;
    const result = await createApiKey(body, '');

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;

    expect(isHttpError(result.error)).toBe(true);
    if (!isHttpError(result.error)) return;
    expect(result.error.status).toBe(401);
  });
});

describe('GET /auth/keys (list)', () => {
  it('lists API keys for valid admin token', async () => {
    // Create a key first so the list is non-empty.
    const body = { label: 'e2e-list', expiresAt: null } as never;
    await createApiKey(body, ADMIN_TOKEN);

    const result = await listApiKeys(ADMIN_TOKEN);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    expect(result.value.keys.length).toBeGreaterThanOrEqual(1);
    const key = result.value.keys[0];
    expect(typeof key.id).toBe('string');
    expect(typeof key.apiKeyPrefix).toBe('string');
    expect(key.isActive).toBe(true);
  });

  it('rejects listing without admin token', async () => {
    const result = await listApiKeys('');

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;

    expect(isHttpError(result.error)).toBe(true);
    if (!isHttpError(result.error)) return;
    expect(result.error.status).toBe(401);
  });
});

describe('DELETE /auth/keys/{keyId} (revoke)', () => {
  it('revokes an existing API key and returns 204', async () => {
    const body = { label: 'e2e-revoke', expiresAt: null } as never;
    const createResult = await createApiKey(body, ADMIN_TOKEN);
    expect(createResult.isOk()).toBe(true);
    if (!createResult.isOk()) return;
    const keyId = createResult.value.keyId;

    const result = await revokeApiKey(keyId, ADMIN_TOKEN);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    expect(result.value.status).toBe(204);
  });
});
