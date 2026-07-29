import { Show, createSignal } from 'solid-js';
import { Check, Copy } from 'lucide-solid';
import type { ApiKeyCreatedResponse } from '../api/schemas/auth';

/**
 * One-time reveal of a freshly created API key. The full key is only
 * returned at creation time, so this block pushes the user to copy it
 * immediately. Optionally offers an action to mark it active locally.
 */
export default function ApiKeyReveal(props: {
  created: ApiKeyCreatedResponse;
  onUseKey?: (key: string) => void;
}) {
  const [copied, setCopied] = createSignal(false);

  async function copy() {
    await navigator.clipboard.writeText(props.created.apiKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div class="bg-green-50 border border-green-300 rounded-lg p-4">
      <h3 class="font-semibold text-green-800 mb-2">
        Key 创建成功 — 请立即保存,完整 Key 只显示这一次
      </h3>
      <div class="flex items-center gap-2 mb-3">
        <code class="flex-1 bg-white border border-green-200 rounded px-3 py-2 text-sm break-all">
          {props.created.apiKey}
        </code>
        <button
          type="button"
          onClick={copy}
          class="flex items-center gap-1 border border-gray-300 rounded px-3 py-2 text-sm hover:bg-gray-50"
        >
          {copied() ? <Check class="w-4 h-4 text-green-600" /> : <Copy class="w-4 h-4" />}
          {copied() ? '已复制' : '复制'}
        </button>
      </div>
      <Show when={props.onUseKey}>
        {(use) => (
          <button
            type="button"
            onClick={() => use()(props.created.apiKey)}
            class="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-blue-700"
          >
            在此浏览器中使用此 Key
          </button>
        )}
      </Show>
    </div>
  );
}
