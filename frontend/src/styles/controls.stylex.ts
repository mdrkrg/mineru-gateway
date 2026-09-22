import * as stylex from '@stylexjs/stylex';
import { colors, radius, space } from './tokens.stylex';

export const controls = stylex.create({
  input: {
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colors.gray300,
    borderRadius: radius.px4,
    paddingInline: space.px12,
    paddingBlock: space.px8,
    outlineStyle: 'none',
    boxShadow: {
      default: null,
      ':focus-visible': `0 0 0 2px ${colors.blue500}`,
    },
  },
  link: {
    color: colors.blue600,
    textDecorationLine: 'none',
    ':hover': {
      textDecorationLine: 'underline',
    },
  },
});
