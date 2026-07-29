import { createFileRoute } from '@tanstack/solid-router';
import type { AuthStore } from '../../../stores/auth';
import { requireSuperuser } from '../../../stores/guard';

export const Route = createFileRoute('/_authenticated/admin/keys')({
  beforeLoad: ({ context }) => {
    requireSuperuser((context as { auth: AuthStore }).auth);
  },
  component: AdminKeysPage,
});

function AdminKeysPage() {
  return <p class="text-gray-500">API Key 管理页面即将上线。</p>;
}
