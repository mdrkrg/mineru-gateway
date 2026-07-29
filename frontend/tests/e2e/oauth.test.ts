/**
 * E2E tests for OAuth / OIDC endpoints that require GATEWAY_USER_AUTH_ENABLED.
 *
 * Covered endpoints:
 *   GET /auth/oauth/providers  list configured OIDC providers
 *
 * Spec: user-management-and-oauth.md Section 4.5, 9.7
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setApiBaseUrl } from '../../src/core';
import { getOAuthProviders } from '../../src/api';
import { MockControl } from './mock-control';
import { loadE2EUrls } from './helpers';

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

describe('GET /auth/oauth/providers', () => {
  it('returns configured provider names', async () => {
    const result = await getOAuthProviders();

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    expect(result.value.providers).toHaveLength(1);
    expect(result.value.providers[0]).toEqual({ name: 'keycloak' });
  });

  it('response does not leak client secrets', async () => {
    const result = await getOAuthProviders();

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const json = JSON.stringify(result.value);
    expect(json).not.toContain('client_secret');
    expect(json).not.toContain('client_id');
    expect(json).not.toContain('openid_configuration');
  });
});
