/**
 * E2E tests for OIDC capability discovery (requires GATEWAY_USER_AUTH_ENABLED).
 *
 * Covered endpoint:
 *   GET /v1/config  logins on + configured OIDC providers
 *
 * Spec: user-management-and-oauth.md Section 4.5, 9.7
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setApiBaseUrl } from '../../src/core';
import { getGatewayConfig } from '../../src/api';
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

describe('GET /v1/config', () => {
  it('advertises logins and the configured provider names', async () => {
    const result = await getGatewayConfig();

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    expect(result.value.userAuthEnabled).toBe(true);
    expect(result.value.providers).toEqual([{ name: 'keycloak' }]);
  });

  it('does not leak OIDC client configuration', async () => {
    const result = await getGatewayConfig();

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const json = JSON.stringify(result.value);
    expect(json).not.toContain('client_secret');
    expect(json).not.toContain('client_id');
    expect(json).not.toContain('openid_configuration');
  });
});
