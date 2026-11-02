import { describe, expect, it, vi } from 'vitest';

// The real router module pulls UI code that cannot load in the node test env.
// Throwing the options is exactly what route `beforeLoad` does with them.
vi.mock('@tanstack/solid-router', () => ({
  redirect: (opts: unknown) => {
    throw opts;
  },
}));

import type { AuthStore } from '../../src/stores/auth';
import type { ConfigStore } from '../../src/stores/config';
import { requireAuth, requireSuperuser, requireUser } from '../../src/stores/guard';

function stores(opts: {
  credential: boolean;
  logins: boolean;
  superuser?: boolean;
}) {
  const auth = {
    hasCredential: () => opts.credential,
    apiKey: () => (opts.credential ? 'mru_key' : null),
    user: () => (opts.superuser === undefined ? null : { isSuperuser: opts.superuser }),
  } as unknown as AuthStore;
  const config = { userAuthEnabled: () => opts.logins } as unknown as ConfigStore;
  return { auth, config };
}

function redirectTo(run: () => void): string {
  try {
    run();
  } catch (error) {
    return (error as { to: string }).to;
  }
  throw new Error('expected a redirect');
}

describe('auth guards', () => {
  it('routes credential-less callers to /login or /key by deployment mode', () => {
    const withLogins = stores({ credential: false, logins: true });
    expect(redirectTo(() => requireAuth(withLogins.auth, withLogins.config))).toBe(
      '/login',
    );

    const keyOnly = stores({ credential: false, logins: false });
    expect(redirectTo(() => requireAuth(keyOnly.auth, keyOnly.config))).toBe('/key');
  });

  it('lets a key session reach admin pages only when logins are off', () => {
    const keyOnly = stores({ credential: true, logins: false });
    expect(() => requireSuperuser(keyOnly.auth, keyOnly.config)).not.toThrow();
    // Self-service keys and the profile page still need a user.
    expect(redirectTo(() => requireUser(keyOnly.auth, keyOnly.config))).toBe('/');

    const userMode = stores({ credential: true, logins: true, superuser: false });
    expect(redirectTo(() => requireSuperuser(userMode.auth, userMode.config))).toBe('/');
  });
});
