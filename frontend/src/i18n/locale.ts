import { createSignal } from 'solid-js';
import { DEFAULT_LOCALE, LOCALES, type Locale } from './locales';

const STORAGE_KEY = 'gateway_locale';

function isLocale(value: string | null): value is Locale {
  return value !== null && (LOCALES as readonly string[]).includes(value);
}

/**
 * Best-effort locale match for a navigator language tag: exact code first,
 * then base-language prefix (`en-US` -> `en`, `zh-TW` -> `zh-CN`).
 */
function matchLanguage(language: string): Locale | null {
  const lang = language.toLowerCase();
  const exact = LOCALES.find((code) => code.toLowerCase() === lang);
  if (exact) return exact;
  const base = lang.split('-')[0] ?? lang;
  return LOCALES.find((code) => code.toLowerCase().split('-')[0] === base) ?? null;
}

function fromNavigator(): Locale | null {
  if (typeof navigator === 'undefined' || !navigator.language) return null;
  return matchLanguage(navigator.language);
}

/**
 * Resolution order: persisted choice (`localStorage["gateway_locale"]`)
 * -> navigator language -> `DEFAULT_LOCALE`.
 *
 * All storage access is guarded so the module also works in non-browser
 * environments (tests run in plain node).
 */
function detectLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isLocale(stored)) return stored;
  } catch {
    // localStorage unavailable — fall through to navigator detection.
  }
  return fromNavigator() ?? DEFAULT_LOCALE;
}

const [localeSignal, setLocaleSignal] = createSignal<Locale>(detectLocale());

/**
 * Reactive current locale. Track it inside JSX/effects for automatic
 * re-translation; reading it anywhere else returns the latest value.
 */
export const locale: () => Locale = localeSignal;

/**
 * Switch the active locale and persist the choice. Persistence is
 * best-effort; failure to store never blocks the switch.
 */
export function setLocale(next: Locale): void {
  setLocaleSignal(next);
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // persistence is best-effort
  }
}
