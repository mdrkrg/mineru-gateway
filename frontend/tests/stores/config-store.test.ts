import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockKy } from '../core/ky-mock';

vi.mock('ky', async () => {
  const { createKyMock } = await import('../core/ky-mock');
  return createKyMock();
});

import ky from 'ky';
import { createConfigStore } from '../../src/stores/config';

const m = ky as unknown as MockKy;

beforeEach(() => {
  m.mockReset();
});

function configResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('ConfigStore', () => {
  it('assumes logins are enabled and no providers until loaded', () => {
    const store = createConfigStore();
    expect(store.userAuthEnabled()).toBe(true);
    expect(store.providers()).toEqual([]);
    expect(store.isLoaded()).toBe(false);
  });

  it('reads capabilities from /v1/config', async () => {
    m.mockResolvedValueOnce(
      configResponse({
        user_auth_enabled: false,
        providers: [{ name: 'keycloak' }],
      }),
    );

    const store = createConfigStore();
    await store.init();

    expect(store.userAuthEnabled()).toBe(false);
    expect(store.providers()).toEqual([{ name: 'keycloak' }]);
    expect(store.isLoaded()).toBe(true);
  });

  it('keeps the login fallback and retries after a failed read', async () => {
    m.mockRejectedValueOnce(new Error('network down'));

    const store = createConfigStore();
    await store.init();

    expect(store.userAuthEnabled()).toBe(true);
    expect(store.isLoaded()).toBe(false);

    m.mockResolvedValueOnce(
      configResponse({ user_auth_enabled: true, providers: [] }),
    );
    await store.init();

    expect(m).toHaveBeenCalledTimes(2);
    expect(store.isLoaded()).toBe(true);
  });

  it('reads the capabilities once per page life', async () => {
    m.mockResolvedValueOnce(
      configResponse({ user_auth_enabled: true, providers: [] }),
    );

    const store = createConfigStore();
    await store.init();
    await store.init();

    expect(m).toHaveBeenCalledTimes(1);
    expect(store.isLoaded()).toBe(true);
  });
});
