import { createFileRoute } from '@tanstack/solid-router';

export const Route = createFileRoute('/_authenticated/upload')({
  component: UploadPage,
});

function UploadPage() {
  return <p class="text-gray-500">上传解析页面即将上线。</p>;
}
