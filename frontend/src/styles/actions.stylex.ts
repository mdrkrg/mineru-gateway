import * as stylex from '@stylexjs/stylex';
import { colors, fontSize, lineHeight, space } from './tokens.stylex';

/** Shared text-action and compact outline-button variants. */
export const actions = stylex.create({
  text: {
    display: 'flex',
    alignItems: 'center',
    gap: space.px4,
    fontSize: fontSize.px14,
    lineHeight: lineHeight.px20,
    backgroundColor: 'transparent',
    borderWidth: 0,
    padding: 0,
    cursor: {
      default: 'pointer',
      ':disabled': 'not-allowed',
    },
    textDecorationLine: {
      default: 'none',
      ':hover:not(:disabled)': 'underline',
    },
  },
  weightNormal: {
    fontWeight: 400,
  },
  textDanger: {
    color: colors.red600,
  },
  textPrimary: {
    color: colors.blue600,
  },
  disabled40: {
    opacity: {
      ':disabled': 0.4,
    },
  },
  disabled50: {
    opacity: {
      ':disabled': 0.5,
    },
  },
  outlineCompact: {
    gap: space.px4,
    paddingInline: space.px12,
    paddingBlock: space.px6,
    fontWeight: 400,
    opacity: {
      ':disabled': 0.4,
    },
  },
  outlineDanger: {
    borderColor: colors.red300,
    color: colors.red600,
    backgroundColor: {
      default: 'transparent',
      ':hover:not(:disabled)': colors.red50,
    },
    fontWeight: 400,
    opacity: {
      ':disabled': 0.4,
    },
  },
});
