import { createFileRoute } from '@tanstack/solid-router';

export const Route = createFileRoute('/_authenticated/profile')({
  component: ProfilePage,
});

function ProfilePage() {
  return <p class="text-gray-500">个人资料页面即将上线。</p>;
}
