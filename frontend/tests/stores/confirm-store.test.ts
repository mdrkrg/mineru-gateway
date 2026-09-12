import { describe, expect, it } from 'vitest';
import { createConfirmStore } from '../../src/stores/confirm';

describe('createConfirmStore', () => {
  it('starts with no pending request', () => {
    const store = createConfirmStore();
    expect(store.request()).toBeNull();
  });

  it('ask exposes the request and resolves true on confirm', async () => {
    const store = createConfirmStore();
    const promise = store.ask({ title: 'Cancel task?', variant: 'danger' });

    expect(store.request()?.title).toBe('Cancel task?');
    expect(store.request()?.variant).toBe('danger');

    store.resolve(true);

    await expect(promise).resolves.toBe(true);
    expect(store.request()).toBeNull();
  });

  it('resolves false on cancel', async () => {
    const store = createConfirmStore();
    const promise = store.ask({ title: 'Revoke key?' });

    store.resolve(false);

    await expect(promise).resolves.toBe(false);
    expect(store.request()).toBeNull();
  });

  it('a new ask supersedes a pending one, resolving it false', async () => {
    const store = createConfirmStore();
    const first = store.ask({ title: 'first' });
    const second = store.ask({ title: 'second' });

    await expect(first).resolves.toBe(false);
    expect(store.request()?.title).toBe('second');

    store.resolve(true);
    await expect(second).resolves.toBe(true);
  });

  it('resolve is a no-op with no pending request', () => {
    const store = createConfirmStore();
    expect(() => store.resolve(true)).not.toThrow();
    expect(store.request()).toBeNull();
  });
});
