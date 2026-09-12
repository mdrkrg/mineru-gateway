import { For } from 'solid-js';
import { CircleAlert, CircleCheck, Info, X } from 'lucide-solid';
import { useToast } from '@/stores/toast-context';
import type { ToastVariant } from '@/stores/toast';

const VARIANT_CLS: Record<ToastVariant, string> = {
  success: 'border-green-300 bg-green-50 text-green-800',
  error: 'border-red-300 bg-red-50 text-red-700',
  info: 'border-gray-300 bg-white text-gray-700',
};

const VARIANT_ICON = {
  success: CircleCheck,
  error: CircleAlert,
  info: Info,
} as const;

/**
 * Renders the active toasts as a fixed bottom-right overlay. Mounted once
 * near the router root so feedback is visible on every route.
 */
export default function ToastHost() {
  const toast = useToast();

  return (
    <div
      class="fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2"
      role="status"
      aria-live="polite"
    >
      <For each={toast.toasts()}>
        {(t) => {
          const Icon = VARIANT_ICON[t.variant];
          return (
            <div
              class={`flex items-start gap-2 rounded-lg border px-4 py-3 text-sm shadow-lg ${VARIANT_CLS[t.variant]}`}
            >
              <Icon class="mt-0.5 h-4 w-4 shrink-0" />
              <span class="flex-1 break-words">{t.message}</span>
              <button
                type="button"
                onClick={() => toast.dismiss(t.id)}
                aria-label="关闭提示"
                class="text-gray-400 hover:text-gray-600"
              >
                <X class="h-4 w-4" />
              </button>
            </div>
          );
        }}
      </For>
    </div>
  );
}
