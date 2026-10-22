import * as stylex from '@stylexjs/stylex';
import { For, Show } from 'solid-js';
import { Trash2 } from 'lucide-solid';
import type { ApiKeyInfo } from '@/api/schemas/auth';
import { t } from '@/i18n';
import { formatDateTime } from '@/utils/format';
import { actions } from '@/styles/actions.stylex';
import { badges } from '@/styles/badges.stylex';
import { icons } from '@/styles/icons.stylex';
import { table } from '@/styles/table.stylex';
import { typography } from '@/styles/typography.stylex';

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
      fallback={<p {...stylex.attrs(typography.muted)}>{t('common.loading')}</p>}
    >
      <Show
        when={props.keys.length > 0}
        fallback={<p {...stylex.attrs(typography.muted)}>{props.emptyText}</p>}
      >
        <table {...stylex.attrs(table.root)}>
          <thead>
            <tr {...stylex.attrs(table.headRow)}>
              <th {...stylex.attrs(table.th)}>{t('keyTable.prefix')}</th>
              <th {...stylex.attrs(table.th)}>{t('keyTable.label')}</th>
              <th {...stylex.attrs(table.th)}>{t('keyTable.createdAt')}</th>
              <th {...stylex.attrs(table.th)}>{t('keyTable.lastUsed')}</th>
              <th {...stylex.attrs(table.th)}>{t('keyTable.expiresAt')}</th>
              <th {...stylex.attrs(table.th)}>{t('keyTable.status')}</th>
              <th {...stylex.attrs(table.thEnd)}>{t('keyTable.actions')}</th>
            </tr>
          </thead>
          <tbody>
            <For each={props.keys}>
              {(key, index) => (
                <tr
                  {...stylex.attrs(
                    table.rowStatic,
                    index() === props.keys.length - 1 && table.lastRow,
                  )}
                >
                  <td {...stylex.attrs(table.td)}>
                    <code {...stylex.attrs(typography.meta)}>{key.apiKeyPrefix}…</code>
                    <Show when={isInUse(key.apiKeyPrefix)}>
                      <span {...stylex.attrs(badges.pill, badges.blue, badges.inUse)}>
                        {t('keyTable.inUse')}
                      </span>
                    </Show>
                  </td>
                  <td {...stylex.attrs(table.td)}>{key.label || '—'}</td>
                  <td {...stylex.attrs(table.td)}>{formatDateTime(key.createdAt)}</td>
                  <td {...stylex.attrs(table.td)}>{formatDateTime(key.lastUsedAt)}</td>
                  <td {...stylex.attrs(table.td)}>{formatDateTime(key.expiresAt)}</td>
                  <td {...stylex.attrs(table.td)}>
                    <span
                      {...stylex.attrs(
                        badges.pill,
                        key.isActive ? badges.green : badges.gray,
                      )}
                    >
                      {key.isActive ? t('keyTable.valid') : t('keyTable.revoked')}
                    </span>
                  </td>
                  <td {...stylex.attrs(table.tdEnd)}>
                    <Show when={key.isActive}>
                      <button
                        type="button"
                        disabled={props.revokingId === key.id}
                        onClick={() => props.onRevoke(key)}
                        {...stylex.attrs(
                          actions.text,
                          actions.textDanger,
                          actions.disabled50,
                        )}
                      >
                        <Trash2 class={stylex.attrs(icons.xs).class} />
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
