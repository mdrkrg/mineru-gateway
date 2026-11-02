import type { ApiKeyInfo } from '@/api/schemas/auth';

export interface OwnerKeyGroup {
  ownerId: string;
  ownerEmail: string;
  /** Keys in server order (newest first). */
  keys: ApiKeyInfo[];
  /** Keys still accepted by the gateway. */
  activeCount: number;
}

/**
 * Collapse a flat key list into one group per owner.
 *
 * Groups keep first-appearance order, so the owner with the most recently
 * created key comes first. All keys stay visible: hiding active keys behind a
 * summary would make live credentials invisible to the operator.
 */
export function groupKeysByOwner(keys: ApiKeyInfo[]): OwnerKeyGroup[] {
  const groups = new Map<string, OwnerKeyGroup>();

  for (const key of keys) {
    const existing = groups.get(key.ownerId);
    if (existing) {
      existing.keys.push(key);
      if (key.isActive) existing.activeCount += 1;
      continue;
    }
    groups.set(key.ownerId, {
      ownerId: key.ownerId,
      ownerEmail: key.ownerEmail,
      keys: [key],
      activeCount: key.isActive ? 1 : 0,
    });
  }

  return [...groups.values()];
}
