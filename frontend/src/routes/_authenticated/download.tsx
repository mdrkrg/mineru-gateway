import { createFileRoute } from '@tanstack/solid-router';

export const Route = createFileRoute('/_authenticated/download')({
  component: ResultDownloadPage,
});

function ResultDownloadPage() {
  return <p class="text-gray-500">结果下载页面即将上线。</p>;
}
