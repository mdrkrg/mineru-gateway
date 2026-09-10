/**
 * Frontend i18n — dictionary-based translation built on
 * `@solid-primitives/i18n` (pure-function API, no provider needed).
 *
 * Usage in components (reactive):
 *   const text = () => t('login.title');
 *   <h1>{text()}</h1>
 *
 * Usage outside components (stores, utils — current value):
 *   window.confirm(t('tasks.confirmCancel', { shortId }));
 */

export { locale, setLocale } from './locale';
export { t, type Translate } from './translator';
export { DEFAULT_LOCALE, LOCALES } from './locales';
export type { Locale } from './locales';
export type { Dict, DictKey } from './locales/en';
