import type { Dict } from './en';

/**
 * Simplified Chinese dictionary (default locale).
 *
 * Key parity with `en` is enforced by the `Dict` type: a missing or extra
 * key fails `pnpm typecheck`.
 */
export const zhCN: Dict = {
  'common.loading': '加载中…',
  'errors.httpDetail': 'HTTP {{status}}: {{detail}}',
  'errors.unknown': 'Unknown error',
};
