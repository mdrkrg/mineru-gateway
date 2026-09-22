import * as stylex from '@stylexjs/stylex';
import { colors, fontSize, lineHeight, radius, shadow, space } from './tokens.stylex';

export const controls = stylex.create({
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.px8,
    boxShadow: shadow.base,
    padding: space.px24,
  },
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
  button: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.px6,
    borderWidth: 0,
    borderStyle: 'solid',
    borderRadius: radius.px4,
    paddingInline: space.px16,
    paddingBlock: space.px8,
    fontSize: fontSize.px14,
    lineHeight: lineHeight.px20,
    fontWeight: 500,
    cursor: {
      default: 'pointer',
      ':disabled': 'not-allowed',
    },
    outlineStyle: 'none',
    textDecorationLine: 'none',
    transitionProperty:
      'color, background-color, border-color, text-decoration-color, fill, stroke',
    transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
    transitionDuration: '150ms',
    opacity: {
      ':disabled': 0.5,
    },
    boxShadow: {
      default: null,
      ':focus-visible': `0 0 0 2px ${colors.blue500}`,
    },
  },
  buttonPrimary: {
    backgroundColor: {
      default: colors.blue600,
      ':enabled:hover': colors.blue700,
    },
    color: colors.white,
  },
  buttonAmber: {
    backgroundColor: {
      default: colors.amber600,
      ':enabled:hover': colors.amber700,
    },
    color: colors.white,
  },
  buttonDanger: {
    backgroundColor: {
      default: colors.red600,
      ':enabled:hover': colors.red700,
    },
    color: colors.white,
  },
  buttonOutline: {
    borderWidth: 1,
    borderColor: colors.gray300,
    backgroundColor: {
      default: colors.white,
      ':enabled:hover': colors.gray50,
    },
    color: colors.gray700,
  },
  buttonLarge: {
    fontSize: fontSize.px16,
    lineHeight: lineHeight.px24,
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: space.px16,
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: space.px4,
  },
  fieldLabel: {
    fontSize: fontSize.px14,
    lineHeight: lineHeight.px20,
    fontWeight: 500,
    color: colors.gray700,
  },
  errorText: {
    fontSize: fontSize.px14,
    lineHeight: lineHeight.px20,
    color: colors.red600,
  },
  alertError: {
    fontSize: fontSize.px14,
    lineHeight: lineHeight.px20,
    color: colors.red600,
    backgroundColor: colors.red50,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colors.red200,
    borderRadius: radius.px4,
    paddingInline: space.px12,
    paddingBlock: space.px8,
  },
  alertSuccess: {
    fontSize: fontSize.px14,
    lineHeight: lineHeight.px20,
    color: colors.green600,
    backgroundColor: colors.green50,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colors.green200,
    borderRadius: radius.px4,
    paddingInline: space.px12,
    paddingBlock: space.px8,
  },
});
