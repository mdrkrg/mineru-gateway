import { createFileRoute } from '@tanstack/solid-router';
import type { AuthStore } from '../../../stores/auth';
import { requireSuperuser } from '../../../stores/guard';

export const Route = createFileRoute('/_authenticated/admin/users')({
  beforeLoad: ({ context }) => {
    requireSuperuser((context as { auth: AuthStore }).auth);
  },
  component: AdminUsersPage,
});

function AdminUsersPage() {
  return <p class="text-gray-500">用户管理页面即将上线。</p>;
}
