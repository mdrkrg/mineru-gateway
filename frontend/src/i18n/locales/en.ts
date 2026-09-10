/**
 * English dictionary — the reference dictionary.
 *
 * Every other locale must implement `Dict` (i.e. provide exactly these
 * keys), which is enforced at compile time by the `Dict` type and at
 * runtime by `tests/i18n/dictionaries.test.ts`.
 *
 * Values may contain `{{ name }}` placeholders resolved by `resolveTemplate`
 * (see `../translator.ts`).
 */
export const en = {
  'common.loading': 'Loading…',
  'errors.httpDetail': 'HTTP {{status}}: {{detail}}',
  'errors.unknown': 'Unknown error',
} as const;

/** Every dictionary key (literal union derived from the reference dict). */
export type DictKey = keyof typeof en;

/** Shape every locale dictionary must implement. */
export type Dict = Record<DictKey, string>;
