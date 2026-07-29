import { createFileRoute } from '@tanstack/solid-router';

export const Route = createFileRoute('/_authenticated/tasks')({
  component: TaskListPage,
});

function TaskListPage() {
  return <p class="text-gray-500">任务列表页面即将上线。</p>;
}
