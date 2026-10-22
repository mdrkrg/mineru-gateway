import * as stylex from '@stylexjs/stylex';
import { colors, fontSize, lineHeight, space } from './tokens.stylex';

/** Shared auth-page and OAuth-callback typography/layout. */
export const auth = stylex.create({
  heroSubtitle: {
    fontSize: fontSize.px14,
    lineHeight: lineHeight.px20,
    color: colors.gray500,
    textAlign: 'center',
    marginBottom: space.px24,
  },
  footer: {
    fontSize: fontSize.px14,
    lineHeight: lineHeight.px20,
    color: colors.gray500,
    textAlign: 'center',
    marginTop: space.px16,
  },
  successBody: {
    fontSize: fontSize.px14,
    lineHeight: lineHeight.px20,
    color: colors.gray600,
    marginBottom: space.px24,
  },
  oauthTitle: {
    fontSize: fontSize.px20,
    lineHeight: lineHeight.px28,
    fontWeight: 700,
    marginBottom: space.px8,
  },
  oauthText: {
    fontSize: fontSize.px14,
    lineHeight: lineHeight.px20,
    color: colors.gray600,
    marginBottom: space.px16,
  },
  oauthError: {
    fontSize: fontSize.px14,
    lineHeight: lineHeight.px20,
    color: colors.red600,
    marginBottom: space.px16,
  },
  oauthLoading: {
    color: colors.gray600,
  },
  divider: {
    display: 'flex',
    alignItems: 'center',
    gap: space.px8,
    marginBottom: space.px12,
  },
  dividerLine: {
    flex: 1,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: colors.gray200,
  },
});
