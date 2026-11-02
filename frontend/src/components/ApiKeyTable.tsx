import * as stylex from '@stylexjs/stylex';
import { For, Show } from 'solid-js';
import { Trash2 } from 'lucide-solid';
import type { ApiKeyInfo } from '@/api/schemas/auth';
import { t } from '@/i18n';
import { formatDateTime } from '@/utils/format';
import { groupKeysByOwner } from '@/utils/group-keys';
import { actions } from '@/styles/actions.stylex';
import { badges } from '@/styles/badges.stylex';
import { icons } from '@/styles/icons.stylex';
import { table } from '@/styles/table.stylex';
import { colors, space } from '@/styles/tokens.stylex';
import { typography } from '@/styles/typography.stylex';

interface ApiKeyTableProps {
  keys: ApiKeyInfo[];
  isLoading: boolean;
  /** Message shown when `keys` is empty. */
  emptyText: string;
  /** Id of the key whose revoke request is in flight, if any. */
  revokingId: string | null;
  onRevoke: (key: ApiKeyInfo) => void;
  /** Admin view: group rows under their owner instead of a flat list. */
  groupByOwner?: boolean;
}

const styles = stylex.create({
  groupRowFill: {
    backgroundColor: colors.gray50,
  },
  groupCell: {
    paddingInlineStart: space.px16,
    textAlign: 'left',
  },
  groupHeader: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space.px8,
  },
  owner: {
    color: colors.gray800,
    fontWeight: 600,
  },
});

function KeyRow(props: {
  apiKey: ApiKeyInfo;
  isLast: boolean;
  revokingId: string | null;
  onRevoke: (key: ApiKeyInfo) => void;
}) {
  return (
    <tr {...stylex.attrs(table.rowStatic, props.isLast && table.lastRow)}>
      <td {...stylex.attrs(table.td)}>
        <code {...stylex.attrs(typography.meta)}>{props.apiKey.apiKeyPrefix}…</code>
      </td>
      <td {...stylex.attrs(table.td)}>{props.apiKey.label || '—'}</td>
      <td {...stylex.attrs(table.td)}>{formatDateTime(props.apiKey.createdAt)}</td>
      <td {...stylex.attrs(table.td)}>{formatDateTime(props.apiKey.lastUsedAt)}</td>
      <td {...stylex.attrs(table.td)}>{formatDateTime(props.apiKey.expiresAt)}</td>
      <td {...stylex.attrs(table.td)}>
        <span
          {...stylex.attrs(badges.pill, props.apiKey.isActive ? badges.green : badges.gray)}
        >
          {props.apiKey.isActive ? t('keyTable.valid') : t('keyTable.revoked')}
        </span>
      </td>
      <td {...stylex.attrs(table.tdEnd)}>
        <Show when={props.apiKey.isActive}>
          <button
            type="button"
            disabled={props.revokingId === props.apiKey.id}
            onClick={() => props.onRevoke(props.apiKey)}
            {...stylex.attrs(actions.text, actions.textDanger, actions.disabled50)}
          >
            <Trash2 class={stylex.attrs(icons.xs).class} />
            {props.revokingId === props.apiKey.id
              ? t('keyTable.revoking')
              : t('keyTable.revoke')}
          </button>
        </Show>
      </td>
    </tr>
  );
}

/**
 * Revocable key list shared by `/api-keys` (own keys) and `/admin/keys` (all
 * keys). Renders revoked keys too, so a revoke only flips the row's status
 * instead of removing it. The admin view groups keys by their owner, so one
 * tenant's credentials stay together.
 */
export default function ApiKeyTable(props: ApiKeyTableProps) {
  const groups = () => groupKeysByOwner(props.keys);
  // Groups and the flat list keep server order, so the last key renders last.
  const lastKeyId = () => props.keys.at(-1)?.id;

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
            <Show
              when={props.groupByOwner}
              fallback={
                <For each={props.keys}>
                  {(apiKey) => (
                    <KeyRow
                      apiKey={apiKey}
                      isLast={apiKey.id === lastKeyId()}
                      revokingId={props.revokingId}
                      onRevoke={props.onRevoke}
                    />
                  )}
                </For>
              }
            >
              <For each={groups()}>
                {(group) => (
                  <>
                    <tr {...stylex.attrs(table.rowStatic, styles.groupRowFill)}>
                      <th colSpan={7} {...stylex.attrs(table.th, styles.groupCell)}>
                        <div {...stylex.attrs(styles.groupHeader)}>
                          <span {...stylex.attrs(styles.owner)}>{group.ownerEmail}</span>
                          <span {...stylex.attrs(badges.pill, badges.gray)}>
                            {t('keyTable.activeCount', { count: group.activeCount })}
                          </span>
                          <Show when={group.activeCount > 1}>
                            <span {...stylex.attrs(badges.pill, badges.retryPending)}>
                              {t('keyTable.multipleActive')}
                            </span>
                          </Show>
                        </div>
                      </th>
                    </tr>
                    <For each={group.keys}>
                      {(apiKey) => (
                        <KeyRow
                          apiKey={apiKey}
                          isLast={apiKey.id === lastKeyId()}
                          revokingId={props.revokingId}
                          onRevoke={props.onRevoke}
                        />
                      )}
                    </For>
                  </>
                )}
              </For>
            </Show>
          </tbody>
        </table>
      </Show>
    </Show>
  );
}
