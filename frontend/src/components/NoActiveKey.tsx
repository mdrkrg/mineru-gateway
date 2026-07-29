import { Link } from '@tanstack/solid-router';
import { KeyRound } from 'lucide-solid';
import { ROUTES } from '@/utils/constants';

/**
 * Shown on pages that call task endpoints when no active API key is set.
 * Directs the user to the API Keys page to create or paste one.
 */
export default function NoActiveKey() {
  return (
    <div class="bg-amber-50 border border-amber-300 rounded-lg p-6 text-center max-w-lg mx-auto mt-8">
      <KeyRound class="w-8 h-8 text-amber-500 mx-auto mb-3" />
      <h2 class="font-semibold text-amber-800 mb-2">需要先设置 API Key</h2>
      <p class="text-sm text-amber-700 mb-4">
        任务相关接口通过 API Key 鉴权。请先在 API Keys 页面创建一个 Key 并在此浏览器中使用,
        或粘贴已有 Key。
      </p>
      <Link
        to={ROUTES.apiKeys}
        class="inline-block bg-amber-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-amber-700"
      >
        前往 API Keys
      </Link>
    </div>
  );
}
