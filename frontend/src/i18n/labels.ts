import type { MineruOutputFormat, MineruTier } from '@/api/schemas/mineru-options';
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

const MINERU_OUTPUT_FORMAT_LABEL_KEYS: Record<MineruOutputFormat, DictKey> = {
  markdown: 'mineruOutputFormat.markdown',
  middle_json: 'mineruOutputFormat.middle_json',
  structured_content: 'mineruOutputFormat.structured_content',
  zip: 'mineruOutputFormat.zip',
};

/** Display label for a MinerU 4.0 output artifact format. */
export function mineruOutputFormatLabel(format: MineruOutputFormat): string {
  return t(MINERU_OUTPUT_FORMAT_LABEL_KEYS[format]);
}

const MINERU_OUTPUT_FORMAT_DESCRIPTION_KEYS: Partial<
  Record<MineruOutputFormat, DictKey>
> = {
  middle_json: 'mineruOutputFormat.middle_json.description',
  structured_content: 'mineruOutputFormat.structured_content.description',
};

/** Optional tooltip explaining an output artifact format. */
export function mineruOutputFormatDescription(
  format: MineruOutputFormat,
): string | undefined {
  const key = MINERU_OUTPUT_FORMAT_DESCRIPTION_KEYS[format];
  return key ? t(key) : undefined;
}
