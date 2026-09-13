import { For, Show } from 'solid-js';
import { Trash2 } from 'lucide-solid';
import type { ApiKeyInfo } from '@/api/schemas/auth';
import { t } from '@/i18n';
import { formatDateTime } from '@/utils/format';

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

const th = 'py-2 pr-4 font-medium';
const td = 'py-2 pr-4';
const pill = 'text-xs rounded px-1.5 py-0.5';

/**
 * Revocable key list shared by `/api-keys` (own keys) and `/admin/keys` (all
 * keys). Renders revoked keys too, so a revoke only flips the row's status
 * instead of removing it.
 */
export default function ApiKeyTable(props: ApiKeyTableProps) {
  const isInUse = (prefix: string) =>
    props.activePrefix != null && props.activePrefix.startsWith(prefix);

  return (
    <Show when={!props.isLoading} fallback={<p class="text-gray-500">{t('common.loading')}</p>}>
      <Show
        when={props.keys.length > 0}
        fallback={<p class="text-gray-500">{props.emptyText}</p>}
      >
        <table class="w-full text-sm">
          <thead>
            <tr class="text-left text-gray-500 border-b">
              <th class={th}>{t('keyTable.prefix')}</th>
              <th class={th}>{t('keyTable.label')}</th>
              <th class={th}>{t('keyTable.createdAt')}</th>
              <th class={th}>{t('keyTable.lastUsed')}</th>
              <th class={th}>{t('keyTable.expiresAt')}</th>
              <th class={th}>{t('keyTable.status')}</th>
              <th class="py-2 font-medium">{t('keyTable.actions')}</th>
            </tr>
          </thead>
          <tbody>
            <For each={props.keys}>
              {(key) => (
                <tr class="border-b last:border-0">
                  <td class={td}>
                    <code class="text-xs">{key.apiKeyPrefix}…</code>
                    <Show when={isInUse(key.apiKeyPrefix)}>
                      <span class={`ml-2 ${pill} bg-blue-100 text-blue-700`}>
                        {t('keyTable.inUse')}
                      </span>
                    </Show>
                  </td>
                  <td class={td}>{key.label || '—'}</td>
                  <td class={td}>{formatDateTime(key.createdAt)}</td>
                  <td class={td}>{formatDateTime(key.lastUsedAt)}</td>
                  <td class={td}>{formatDateTime(key.expiresAt)}</td>
                  <td class={td}>
                    <span
                      class={`${pill} ${
                        key.isActive
                          ? 'bg-green-100 text-green-700'
                          : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {key.isActive ? t('keyTable.valid') : t('keyTable.revoked')}
                    </span>
                  </td>
                  <td class="py-2">
                    <Show when={key.isActive}>
                      <button
                        type="button"
                        disabled={props.revokingId === key.id}
                        onClick={() => props.onRevoke(key)}
                        class="flex items-center gap-1 text-red-600 hover:underline text-sm disabled:opacity-50 disabled:no-underline"
                      >
                        <Trash2 class="w-3.5 h-3.5" />
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
