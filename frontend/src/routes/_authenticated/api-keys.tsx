import { createFileRoute } from '@tanstack/solid-router';

export const Route = createFileRoute('/_authenticated/api-keys')({
  component: ApiKeysPage,
});

function ApiKeysPage() {
  return <p class="text-gray-500">API Keys 页面即将上线。</p>;
}
