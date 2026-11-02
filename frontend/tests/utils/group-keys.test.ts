import { describe, expect, it } from 'vitest';
import type { ApiKeyInfo } from '../../src/api/schemas/auth';
import { groupKeysByOwner } from '../../src/utils/group-keys';

function key(overrides: Partial<ApiKeyInfo> & Pick<ApiKeyInfo, 'id' | 'ownerId'>): ApiKeyInfo {
  return {
    ownerEmail: `${overrides.ownerId}@example.com`,
    apiKeyPrefix: 'mru_abcd',
    label: '',
    createdAt: '2026-01-01T00:00:00Z',
    lastUsedAt: null,
    expiresAt: null,
    isActive: true,
    ...overrides,
  };
}

describe('groupKeysByOwner', () => {
  it('groups interleaved keys by owner and keeps first-appearance order', () => {
    const keys = [
      key({ id: 'a1', ownerId: 'owner-a' }),
      key({ id: 'b1', ownerId: 'owner-b' }),
      key({ id: 'a2', ownerId: 'owner-a', isActive: false }),
    ];

    const groups = groupKeysByOwner(keys);

    expect(groups.map((g) => g.ownerId)).toEqual(['owner-a', 'owner-b']);
    expect(groups[0].keys.map((k) => k.id)).toEqual(['a1', 'a2']);
    expect(groups[0].ownerEmail).toBe('owner-a@example.com');
  });

  it('counts only active keys', () => {
    const groups = groupKeysByOwner([
      key({ id: 'a1', ownerId: 'owner-a' }),
      key({ id: 'a2', ownerId: 'owner-a' }),
      key({ id: 'a3', ownerId: 'owner-a', isActive: false }),
    ]);

    expect(groups[0].activeCount).toBe(2);
    expect(groups[0].keys).toHaveLength(3);
  });

  it('returns no groups for an empty list', () => {
    expect(groupKeysByOwner([])).toEqual([]);
  });
});
