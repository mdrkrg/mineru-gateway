import type { MineruTier } from '@/api/schemas/mineru-options';
import type { TaskStatus } from '@/api/schemas/tasks';
import { t, type DictKey } from '@/i18n';

/**
 * Typed label helpers for enum display values. They route static
 * enum→label lookups through i18n with compile-time-checked keys.
 */

/** Display label for a task status. */
export function taskStatusLabel(status: TaskStatus): string {
  return t(`status.${status}`);
}

const MINERU_TIER_LABEL_KEYS: Record<MineruTier, DictKey> = {
  flash: 'mineruTier.label.flash',
  basic: 'mineruTier.label.basic',
  standard: 'mineruTier.label.standard',
  advanced: 'mineruTier.label.advanced',
};

/** Display label for a MinerU 4.0 quality tier. */
export function mineruTierLabel(tier: MineruTier): string {
  return t(MINERU_TIER_LABEL_KEYS[tier]);
}

/** Display the resolved tier, or a placeholder while it is unavailable. */
export function taskTierLabel(tier: MineruTier | null): string {
  return tier ? mineruTierLabel(tier) : '-';
}
