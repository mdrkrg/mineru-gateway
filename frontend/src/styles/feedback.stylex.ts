import * as stylex from '@stylexjs/stylex';
import { colors, fontSize, lineHeight, radius, space } from './tokens.stylex';

/** Shared success feedback surfaces and text. */
export const feedback = stylex.create({
  successBox: {
    backgroundColor: colors.green50,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colors.green300,
    borderRadius: radius.px8,
    padding: space.px16,
  },
  successTitle: {
    fontWeight: 600,
    color: colors.green800,
    marginBottom: space.px4,
  },
  successText: {
    fontSize: fontSize.px14,
    lineHeight: lineHeight.px20,
    color: colors.green700,
  },
});
