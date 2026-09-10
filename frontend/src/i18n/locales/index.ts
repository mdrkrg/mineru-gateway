import { en, type Dict } from './en';
import { zhCN } from './zh-CN';

/** All supported locales (BCP-47 tags). */
export type Locale = 'en' | 'zh-CN';

/** All supported locale codes, for detection and matching. */
export const LOCALES: readonly Locale[] = ['en', 'zh-CN'];

/** Locale used when detection fails. */
export const DEFAULT_LOCALE: Locale = 'zh-CN';

/** Registry of dictionaries by locale. */
export const DICTIONARIES: Record<Locale, Dict> = { en, 'zh-CN': zhCN };
