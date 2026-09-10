import { resolveTemplate, translator } from '@solid-primitives/i18n';
import { locale } from './locale';
import { DICTIONARIES } from './locales';

/**
 * Translate a dictionary key.
 *
 * - Unknown keys are a compile-time error (`DictKey` union).
 * - `{{ name }}` placeholders in the value are replaced by the args object.
 * - Reactive when used inside JSX/effects (tracks the locale signal);
 *   safe to call outside components (stores, utils) where it returns the
 *   current locale's value.
 */
export const t = translator(() => DICTIONARIES[locale()], resolveTemplate);

/** Type of the translator function (useful for DI seams in tests). */
export type Translate = typeof t;
