import * as stylex from '@stylexjs/stylex';
import { colors } from './tokens.stylex';

/** Shared auth-page and OAuth-callback typography/layout. */
export const auth = stylex.create({
  oauthLoading: {
    color: colors.gray600,
  },
  dividerLine: {
    flex: 1,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: colors.gray200,
  },
});
