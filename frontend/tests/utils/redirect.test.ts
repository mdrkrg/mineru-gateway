import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearOAuthRedirect,
  rememberOAuthRedirect,
  safeRedirectPath,
  takeOAuthRedirect,
} from '@/utils/redirect';

const oauthRedirects = new Map<string, string>();
Object.defineProperty(globalThis, 'sessionStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => oauthRedirects.get(key) ?? null,
    setItem: (key: string, value: string) => oauthRedirects.set(key, value),
    removeItem: (key: string) => oauthRedirects.delete(key),
  },
});

beforeEach(() => oauthRedirects.clear());

describe('safeRedirectPath', () => {
  it('accepts application paths with search and hash', () => {
    expect(safeRedirectPath('/tasks')).toBe('/tasks');
    expect(safeRedirectPath('/tasks/01a19071?page=2')).toBe('/tasks/01a19071?page=2');
    expect(safeRedirectPath('/tasks/01a19071#result')).toBe('/tasks/01a19071#result');
  });

  it('rejects non-strings, relative paths, and empty values', () => {
    expect(safeRedirectPath(undefined)).toBeNull();
    expect(safeRedirectPath(null)).toBeNull();
    expect(safeRedirectPath(42)).toBeNull();
    expect(safeRedirectPath('')).toBeNull();
    expect(safeRedirectPath('tasks')).toBeNull();
  });

  it('rejects protocol-relative and absolute URLs', () => {
    expect(safeRedirectPath('//evil.example/tasks')).toBeNull();
    expect(safeRedirectPath('/tasks/..//evil.example')).toBeNull();
    expect(safeRedirectPath('https://evil.example/tasks')).toBeNull();
    expect(safeRedirectPath('javascript:alert(1)')).toBeNull();
  });

  it('rejects backslashes and control characters', () => {
    expect(safeRedirectPath('/\\evil.example')).toBeNull();
    expect(safeRedirectPath('/tasks\nSet-Cookie: x')).toBeNull();
    expect(safeRedirectPath('/tasks\u0000')).toBeNull();
  });

  it('rejects auth pages to avoid redirect loops', () => {
    expect(safeRedirectPath('/login')).toBeNull();
    expect(safeRedirectPath('/login?redirect=/tasks')).toBeNull();
    expect(safeRedirectPath('/tasks/../login')).toBeNull();
    expect(safeRedirectPath('/%2e%2e/login')).toBeNull();
    expect(safeRedirectPath('/register')).toBeNull();
    expect(safeRedirectPath('/register/')).toBeNull();
    expect(safeRedirectPath('/oauth/callback')).toBeNull();
    // Prefix matches that are not auth pages remain valid.
    expect(safeRedirectPath('/logins')).toBe('/logins');
  });

  it('rejects excessively long values', () => {
    expect(safeRedirectPath(`/${'a'.repeat(2048)}`)).toBeNull();
  });
});

describe('OAuth redirect persistence', () => {
  it('round-trips a safe target and clears it after use', () => {
    rememberOAuthRedirect('/tasks?page=2#result');
    expect(takeOAuthRedirect()).toBe('/tasks?page=2#result');
    expect(takeOAuthRedirect()).toBeNull();
  });

  it('does not store unsafe targets', () => {
    rememberOAuthRedirect('//evil.example/tasks');
    expect(takeOAuthRedirect()).toBeNull();
  });

  it('drops a target when login finishes outside the callback', () => {
    rememberOAuthRedirect('/tasks');
    clearOAuthRedirect();
    expect(takeOAuthRedirect()).toBeNull();
  });
});
