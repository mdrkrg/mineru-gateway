import * as stylex from '@stylexjs/stylex';
import { Link } from '@tanstack/solid-router';
import { KeyRound } from 'lucide-solid';
import { t } from '@/i18n';
import { ROUTES } from '@/utils/constants';
import { controls } from '@/styles/controls.stylex';
import { icons } from '@/styles/icons.stylex';
import { colors, maxWidth, radius, space } from '@/styles/tokens.stylex';
import { typography } from '@/styles/typography.stylex';

const styles = stylex.create({
  card: {
    backgroundColor: colors.amber50,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colors.amber300,
    borderRadius: radius.px8,
    padding: space.px24,
    textAlign: 'center',
    maxWidth: maxWidth.px512,
    marginInline: 'auto',
    marginTop: space.px32,
  },
  icon: {
    color: colors.amber500,
    marginInline: 'auto',
    marginBottom: space.px12,
  },
  title: {
    fontWeight: 600,
    color: colors.amber800,
    marginBottom: space.px8,
  },
  text: {
    color: colors.amber700,
    marginBottom: space.px16,
  },
  cta: {
    display: 'inline-block',
  },
});

/**
 * Shown on pages that call task endpoints when no active API key is set.
 * Directs the user to the API Keys page to create or paste one.
 */
export default function NoActiveKey() {
  return (
    <div {...stylex.attrs(styles.card)}>
      <KeyRound class={stylex.attrs(icons.lg, styles.icon).class} />
      <h2 {...stylex.attrs(styles.title)}>{t('noActiveKey.title')}</h2>
      <p {...stylex.attrs(typography.body, styles.text)}>
        {t('noActiveKey.description')}
      </p>
      <Link
        to={ROUTES.apiKeys}
        class={stylex.attrs(controls.button, controls.buttonAmber, styles.cta).class}
      >
        {t('noActiveKey.goTo')}
      </Link>
    </div>
  );
}
