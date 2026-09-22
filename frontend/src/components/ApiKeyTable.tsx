import * as stylex from '@stylexjs/stylex';
import { For, Show } from 'solid-js';
import { Trash2 } from 'lucide-solid';
import type { ApiKeyInfo } from '@/api/schemas/auth';
import { t } from '@/i18n';
import { formatDateTime } from '@/utils/format';
import { colors, fontSize, lineHeight, radius, space } from '@/styles/tokens.stylex';

interface ApiKeyTableProps {
  keys: ApiKeyInfo[];
  isLoading: boolean;
  /** Message shown when `keys` is empty. */
  emptyText: string;
  /**
   * Prefix of the key this browser currently uses, if any. The matching row
   * gets an "In Use" badge; omit it on pages without an active-key concept.
   */
  activePrefix?: string | null;
  /** Id of the key whose revoke request is in flight, if any. */
  revokingId: string | null;
  onRevoke: (key: ApiKeyInfo) => void;
}

const styles = stylex.create({
  table: {
    width: '100%',
    fontSize: fontSize.px14,
    lineHeight: lineHeight.px20,
  },
  headRow: {
    textAlign: 'left',
    color: colors.gray500,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: 'currentColor',
  },
  th: {
    paddingBlock: space.px8,
    paddingInlineEnd: space.px16,
    fontWeight: 500,
  },
  thActions: {
    paddingBlock: space.px8,
    fontWeight: 500,
  },
  row: {
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: 'currentColor',
  },
  lastRow: {
    borderBottomWidth: 0,
  },
  td: {
    paddingBlock: space.px8,
    paddingInlineEnd: space.px16,
  },
  tdActions: {
    paddingBlock: space.px8,
  },
  code: {
    fontSize: fontSize.px12,
    lineHeight: lineHeight.px16,
  },
  pill: {
    fontSize: fontSize.px12,
    lineHeight: lineHeight.px16,
    borderRadius: radius.px4,
    paddingInline: space.px6,
    paddingBlock: space.px2,
  },
  inUse: {
    marginLeft: space.px8,
    backgroundColor: colors.blue100,
    color: colors.blue700,
  },
  valid: {
    backgroundColor: colors.green100,
    color: colors.green700,
  },
  revoked: {
    backgroundColor: colors.gray100,
    color: colors.gray500,
  },
  revoke: {
    display: 'flex',
    alignItems: 'center',
    gap: space.px4,
    fontSize: fontSize.px14,
    lineHeight: lineHeight.px20,
    color: colors.red600,
    backgroundColor: 'transparent',
    borderWidth: 0,
    padding: 0,
    cursor: {
      default: 'pointer',
      ':disabled': 'not-allowed',
    },
    textDecorationLine: {
      default: 'none',
      ':enabled:hover': 'underline',
    },
    opacity: {
      ':disabled': 0.5,
    },
  },
  trashIcon: {
    width: space.px14,
    height: space.px14,
  },
  muted: {
    color: colors.gray500,
  },
});

/**
 * Revocable key list shared by `/api-keys` (own keys) and `/admin/keys` (all
 * keys). Renders revoked keys too, so a revoke only flips the row's status
 * instead of removing it.
 */
export default function ApiKeyTable(props: ApiKeyTableProps) {
  const isInUse = (prefix: string) =>
    props.activePrefix != null && props.activePrefix.startsWith(prefix);

  return (
    <Show
      when={!props.isLoading}
      fallback={<p {...stylex.attrs(styles.muted)}>{t('common.loading')}</p>}
    >
      <Show
        when={props.keys.length > 0}
        fallback={<p {...stylex.attrs(styles.muted)}>{props.emptyText}</p>}
      >
        <table {...stylex.attrs(styles.table)}>
          <thead>
            <tr {...stylex.attrs(styles.headRow)}>
              <th {...stylex.attrs(styles.th)}>{t('keyTable.prefix')}</th>
              <th {...stylex.attrs(styles.th)}>{t('keyTable.label')}</th>
              <th {...stylex.attrs(styles.th)}>{t('keyTable.createdAt')}</th>
              <th {...stylex.attrs(styles.th)}>{t('keyTable.lastUsed')}</th>
              <th {...stylex.attrs(styles.th)}>{t('keyTable.expiresAt')}</th>
              <th {...stylex.attrs(styles.th)}>{t('keyTable.status')}</th>
              <th {...stylex.attrs(styles.thActions)}>{t('keyTable.actions')}</th>
            </tr>
          </thead>
          <tbody>
            <For each={props.keys}>
              {(key, index) => (
                <tr
                  {...stylex.attrs(
                    styles.row,
                    index() === props.keys.length - 1 && styles.lastRow,
                  )}
                >
                  <td {...stylex.attrs(styles.td)}>
                    <code {...stylex.attrs(styles.code)}>{key.apiKeyPrefix}…</code>
                    <Show when={isInUse(key.apiKeyPrefix)}>
                      <span {...stylex.attrs(styles.pill, styles.inUse)}>
                        {t('keyTable.inUse')}
                      </span>
                    </Show>
                  </td>
                  <td {...stylex.attrs(styles.td)}>{key.label || '—'}</td>
                  <td {...stylex.attrs(styles.td)}>{formatDateTime(key.createdAt)}</td>
                  <td {...stylex.attrs(styles.td)}>{formatDateTime(key.lastUsedAt)}</td>
                  <td {...stylex.attrs(styles.td)}>{formatDateTime(key.expiresAt)}</td>
                  <td {...stylex.attrs(styles.td)}>
                    <span
                      {...stylex.attrs(
                        styles.pill,
                        key.isActive ? styles.valid : styles.revoked,
                      )}
                    >
                      {key.isActive ? t('keyTable.valid') : t('keyTable.revoked')}
                    </span>
                  </td>
                  <td {...stylex.attrs(styles.tdActions)}>
                    <Show when={key.isActive}>
                      <button
                        type="button"
                        disabled={props.revokingId === key.id}
                        onClick={() => props.onRevoke(key)}
                        {...stylex.attrs(styles.revoke)}
                      >
                        <Trash2 class={stylex.attrs(styles.trashIcon).class} />
                        {props.revokingId === key.id
                          ? t('keyTable.revoking')
                          : t('keyTable.revoke')}
                      </button>
                    </Show>
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </Show>
    </Show>
  );
}
