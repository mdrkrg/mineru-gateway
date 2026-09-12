import type { MineruBackend, MineruLanguage } from '@/api/schemas/mineru-options';
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

const MINERU_BACKEND_LABEL_KEYS: Partial<Record<MineruBackend, DictKey>> = {
  pipeline: 'mineruBackend.label.pipeline',
  'vlm-engine': 'mineruBackend.label.vlm-engine',
  'hybrid-engine': 'mineruBackend.label.hybrid-engine',
};

/**
 * Display label for a MinerU backend.
 */
export function mineruBackendLabel(backend: MineruBackend): string {
  const key = MINERU_BACKEND_LABEL_KEYS[backend];
  return key ? t(key) : backend;
}

/** Display label for a MinerU language code. */
export function mineruLanguageLabel(lang: MineruLanguage): string {
  return t(`mineruLang.label.${lang}`);
}

/** Coverage description for a MinerU language code. */
export function mineruLanguageCoverage(lang: MineruLanguage): string {
  return t(`mineruLang.coverage.${lang}`);
}
